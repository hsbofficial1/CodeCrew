/**
 * Corridor risk engine.
 *
 * Two independent estimators are combined for every corridor:
 *
 *  1. A PHYSICAL rainfall-threshold model. Regional landslide early-warning
 *     systems trigger on antecedent accumulation rather than instantaneous
 *     intensity, so we compare 24-hour and 3-day rainfall against a critical
 *     line that is lowered as the corridor's own susceptibility rises, then map
 *     the exceedance ratio through a logistic curve.
 *
 *  2. A LEARNED model - the logistic regression in logreg.js, fitted at start-up
 *     on the bundled historical disruption records.
 *
 * Blending them means a corridor with no historical signal still gets a sane
 * physical estimate, and the API can show both numbers side by side instead of
 * asking anyone to trust a single opaque score.
 */
import { LogisticRegression } from './logreg.js';
import {
  buildHistoricalDataset,
  featureVector,
  FEATURE_NAMES,
  monsoonIndex,
} from './history.js';
import { getWeather } from './weather.js';
import { NODE_BY_ID } from '../data/nodes.js';
import { clamp, sigmoid, round } from './geo.js';

const PHYSICAL_WEIGHT = 0.45;
const LEARNED_WEIGHT = 0.55;

// ---------------------------------------------------------------- model fit

let model = null;
let modelCard = null;

export function trainRiskModel() {
  const t0 = Date.now();
  const records = buildHistoricalDataset();

  // Deterministic 80/20 split by stride so the held-out set spans all corridors.
  const train = [];
  const test = [];
  records.forEach((r, i) => (i % 5 === 4 ? test : train).push(r));

  const m = new LogisticRegression({ lr: 0.35, epochs: 900, l2: 1e-3 });
  m.fit(train.map((r) => r.x), train.map((r) => r.disrupted));

  const metrics = m.evaluate(test.map((r) => r.x), test.map((r) => r.disrupted));

  model = m;
  modelCard = {
    name: 'Corridor disruption classifier',
    kind: 'L2-regularised logistic regression (batch gradient descent)',
    trainedAt: new Date().toISOString(),
    trainingMs: Date.now() - t0,
    samples: { total: records.length, train: train.length, test: test.length },
    features: FEATURE_NAMES,
    weights: Object.fromEntries(
      FEATURE_NAMES.map((n, i) => [n, round(m.w[i], 4)]),
    ),
    intercept: round(m.b, 4),
    finalTrainLogLoss: round(m.finalLoss, 4),
    heldOut: {
      accuracy: round(metrics.accuracy, 4),
      precision: round(metrics.precision, 4),
      recall: round(metrics.recall, 4),
      rocAuc: round(metrics.rocAuc, 4),
      positiveRate: round(metrics.positiveRate, 4),
    },
    trainingData:
      'Synthesised from NE-India monsoon climatology and per-corridor terrain / ' +
      'susceptibility priors - see server/src/data/history.js. Replace with real ' +
      'NHAI / NDMA / state-PWD incident records for production use.',
  };
  return modelCard;
}

export const getModelCard = () => modelCard;

// ------------------------------------------------------------ physical model

/**
 * Rainfall-threshold landslide probability.
 * Critical thresholds shrink as susceptibility rises: a highly unstable slope
 * fails at rainfall a stable one shrugs off.
 */
export function landslideProbability({ rain24h, rain3day, susceptibility, terrain }) {
  if (susceptibility <= 0.02) return 0;
  const r1Critical = 55 * (1 - 0.6 * susceptibility);
  const r3Critical = 120 * (1 - 0.6 * susceptibility);
  const exceedance = Math.max(rain24h / r1Critical, rain3day / r3Critical);
  const terrainGain = terrain === 'high_hill' ? 1.25 : terrain === 'hill' ? 1.1 : 0.7;
  return clamp(sigmoid(4 * (exceedance - 1)) * terrainGain * (0.3 + 0.7 * susceptibility));
}

/** Basin-accumulation flood probability. */
export function floodProbability({ rain3day, rain7day, susceptibility, elevationM }) {
  if (susceptibility <= 0.02) return 0;
  const critical = 180 * (1 - 0.55 * susceptibility);
  const accumulation = Math.max(rain3day, rain7day * 0.55);
  const exceedance = accumulation / critical;
  // Water pools on the valley floor; above ~600 m it drains away.
  const reliefFactor = elevationM > 600 ? 0.35 : elevationM > 200 ? 0.7 : 1;
  return clamp(sigmoid(3.5 * (exceedance - 1)) * reliefFactor * (0.25 + 0.75 * susceptibility));
}

/** Time-of-day + corridor-volume congestion factor, 0..1. */
export function congestionFactor(edge, date = new Date()) {
  // IST is UTC+5:30 and the container clock is UTC.
  const istHour = (date.getUTCHours() + 5.5) % 24;
  const peak =
    istHour >= 8 && istHour <= 11 ? 1 : istHour >= 16 && istHour <= 20 ? 0.9 : istHour >= 22 || istHour <= 5 ? 0.15 : 0.5;
  const modeSensitivity = edge.mode === 'road' ? 1 : edge.mode === 'rail' ? 0.35 : 0.1;
  return clamp(edge.commercialVolume * peak * modeSensitivity * 0.55);
}

// -------------------------------------------------------------- combined API

/**
 * Full risk assessment for one corridor at the current (or given) time.
 * Rainfall is taken as the worse of the two endpoints - a slope failure
 * anywhere along the link blocks the whole link.
 */
export function assessEdge(edge, date = new Date(), scenario = 'live') {
  const a = getWeather(edge.from, scenario);
  const b = getWeather(edge.to, scenario);
  const rain24h = Math.max(a.precipitationMm ?? 0, b.precipitationMm ?? 0);
  const rain3day = Math.max(a.rain3DayMm ?? 0, b.rain3DayMm ?? 0);
  const rain7day = Math.max(a.rain7DayMm ?? 0, b.rain7DayMm ?? 0);
  const month = date.getUTCMonth() + 1;
  const elevationM = Math.max(
    NODE_BY_ID[edge.from]?.elevationM ?? 0,
    NODE_BY_ID[edge.to]?.elevationM ?? 0,
  );

  const pLandslide =
    edge.mode === 'air' || edge.mode === 'water'
      ? 0
      : landslideProbability({
          rain24h,
          rain3day,
          susceptibility: edge.landslideSusceptibility,
          terrain: edge.terrain,
        });

  const pFlood = floodProbability({
    rain3day,
    rain7day,
    susceptibility: edge.floodSusceptibility,
    elevationM: edge.mode === 'water' ? 9999 : elevationM,
  });

  // Independent-cause union: at least one hazard materialises.
  const pPhysical = clamp(1 - (1 - pLandslide) * (1 - pFlood));

  let pLearned = pPhysical;
  if (model && edge.mode !== 'air' && edge.mode !== 'water') {
    pLearned = model.predictProba(
      featureVector({
        rain3day,
        landslide: edge.landslideSusceptibility,
        flood: edge.floodSusceptibility,
        terrain: edge.terrain,
        surface: edge.surface,
        allWeather: edge.allWeather,
        month,
      }),
    );
  }

  let disruptionProbability = clamp(
    PHYSICAL_WEIGHT * pPhysical + LEARNED_WEIGHT * pLearned,
  );

  // Air cargo is grounded by weather rather than by slopes.
  if (edge.mode === 'air') {
    disruptionProbability = clamp(0.04 + Math.min(rain24h / 90, 0.35));
  }
  // Waterways lose navigability in the lean season and in extreme spate.
  if (edge.mode === 'water') {
    const lean = month <= 3 || month === 12 ? 0.28 : 0.05;
    disruptionProbability = clamp(lean + Math.min(rain7day / 700, 0.3));
  }

  const closed =
    edge.seasonalClosure?.months?.includes(month) ? edge.seasonalClosure : null;
  if (closed) disruptionProbability = 1;

  const congestion = congestionFactor(edge, date);

  return {
    disruptionProbability: round(disruptionProbability, 4),
    components: {
      landslide: round(pLandslide, 4),
      flood: round(pFlood, 4),
      physicalModel: round(pPhysical, 4),
      learnedModel: round(pLearned, 4),
      congestion: round(congestion, 4),
    },
    inputs: {
      rain24hMm: round(rain24h, 1),
      rain3DayMm: round(rain3day, 1),
      rain7DayMm: round(rain7day, 1),
      monsoonIndex: round(monsoonIndex(month), 3),
      weatherSource: a.source,
      scenario,
    },
    seasonalClosure: closed,
    band: riskBand(disruptionProbability),
  };
}

export function riskBand(p) {
  if (p >= 0.7) return 'severe';
  if (p >= 0.45) return 'high';
  if (p >= 0.22) return 'moderate';
  return 'low';
}
