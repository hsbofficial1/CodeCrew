/**
 * Bundled historical corridor-disruption dataset.
 *
 * Open, per-corridor incident records for the NER are not publicly downloadable,
 * so this module SYNTHESISES a training set from a documented generating process:
 * NE India monsoon climatology (Jun-Sep peak), the corridor's own landslide and
 * flood susceptibility, terrain class, pavement condition and all-weather status.
 *
 * This is stated plainly rather than hidden: the model in risk.js genuinely
 * learns from these records (it is not handed the coefficients), and the API
 * publishes both the learned weights and held-out metrics at /api/model. Swapping
 * in real NHAI / NDMA / state-PWD incident records means replacing only this file.
 */
import { EDGES } from '../data/edges.js';
import { sigmoid } from './geo.js';

/** Deterministic PRNG so every run of the demo trains on identical data. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mean daily rainfall (mm) by month for the NE India region - the south-west
 * monsoon runs June-September with a pre-monsoon build-up from April.
 */
export const MONTHLY_RAIN_MM_PER_DAY = [
  0.4, 0.9, 2.1, 5.6, 9.2, 14.1, 13.2, 10.6, 7.4, 3.4, 0.9, 0.4,
];

/** 0..1 index of how deep into the monsoon a given month sits. */
export function monsoonIndex(month1to12) {
  const r = MONTHLY_RAIN_MM_PER_DAY[month1to12 - 1];
  const max = Math.max(...MONTHLY_RAIN_MM_PER_DAY);
  return r / max;
}

export const TERRAIN_SCORE = { plain: 0, hill: 0.6, high_hill: 1 };

/**
 * Feature vector shared by the training set and live inference, so the model
 * never sees a different representation at serve time than it was fitted on.
 */
export function featureVector({ rain3day, landslide, flood, terrain, surface, allWeather, month }) {
  const rainNorm = Math.min(rain3day / 150, 1.5);
  const terrainScore = TERRAIN_SCORE[terrain] ?? 0;
  return [
    rainNorm,
    landslide,
    flood,
    landslide * rainNorm,
    flood * rainNorm,
    terrainScore,
    1 - surface,
    allWeather ? 0 : 1,
    monsoonIndex(month),
  ];
}

export const FEATURE_NAMES = [
  'rain_3day_normalised',
  'landslide_susceptibility',
  'flood_susceptibility',
  'landslide_x_rain',
  'flood_x_rain',
  'terrain_score',
  'pavement_deficit',
  'not_all_weather',
  'monsoon_index',
];

/**
 * Draw a 3-day antecedent rainfall total for a month, gamma-ish so that heavy
 * spells are rare but fat-tailed rather than symmetric around the mean.
 */
function sampleRain3Day(month, rnd) {
  const mean = MONTHLY_RAIN_MM_PER_DAY[month - 1] * 3;
  // Sum of three exponential draws approximates a Gamma(3, mean/3).
  let s = 0;
  for (let i = 0; i < 3; i++) s += -Math.log(1 - rnd()) * (mean / 3);
  return s;
}

/**
 * Build the labelled dataset. The latent process below is the "ground truth"
 * the model has to recover; it is never exposed to the learner.
 */
export function buildHistoricalDataset({ years = 6, samplesPerMonth = 2, seed = 20260101 } = {}) {
  const rnd = mulberry32(seed);
  const records = [];

  for (const edge of EDGES) {
    // Rail and road are the modes whose disruption history we model; air and
    // water disruptions are driven by different mechanisms (visibility, draft).
    if (edge.mode === 'air' || edge.mode === 'water') continue;

    for (let y = 0; y < years; y++) {
      for (let month = 1; month <= 12; month++) {
        for (let s = 0; s < samplesPerMonth; s++) {
          const rain3day = sampleRain3Day(month, rnd);
          const ctx = {
            rain3day,
            landslide: edge.landslideSusceptibility,
            flood: edge.floodSusceptibility,
            terrain: edge.terrain,
            surface: edge.surface,
            allWeather: edge.allWeather,
            month,
          };
          const rainNorm = Math.min(rain3day / 150, 1.5);
          const latent =
            -4.2 +
            3.6 * edge.landslideSusceptibility * rainNorm +
            2.8 * edge.floodSusceptibility * rainNorm +
            1.2 * (TERRAIN_SCORE[edge.terrain] ?? 0) +
            1.6 * (1 - edge.surface) +
            0.9 * (edge.allWeather ? 0 : 1) +
            0.5 * monsoonIndex(month);
          const disrupted = rnd() < sigmoid(latent) ? 1 : 0;
          records.push({
            corridor: `${edge.from}-${edge.to}`,
            mode: edge.mode,
            year: 2020 + y,
            month,
            rain3day,
            disrupted,
            x: featureVector(ctx),
          });
        }
      }
    }
  }
  return records;
}
