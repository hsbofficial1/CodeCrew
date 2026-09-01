/**
 * What-if scenarios.
 *
 * A scenario does not fake results - it substitutes the rainfall inputs and then
 * runs the same risk, routing and accessibility models. That makes it a genuine
 * stress test ("if the Barak valley takes a 400 mm week, what gets stranded and
 * where do we re-route?") rather than a scripted demo, and it is how an operator
 * would actually use the platform ahead of a forecast event.
 *
 * Rainfall figures are chosen to match documented NER events: the June 2022
 * Barak valley floods, the October 2023 South Lhonak glacial-lake outburst in
 * Sikkim, and typical July peak-monsoon accumulation.
 */
import { NODE_BY_ID } from '../data/nodes.js';

/** @typedef {{ rain24hMm:number, rain3DayMm:number, rain7DayMm:number }} RainOverride */

export const SCENARIOS = {
  live: {
    id: 'live',
    label: 'Live conditions',
    description: 'Current observed and forecast rainfall from Open-Meteo.',
    severity: 'baseline',
  },
  monsoon_peak: {
    id: 'monsoon_peak',
    label: 'Peak monsoon',
    description: 'Region-wide July-intensity monsoon: sustained rain across all eight states.',
    severity: 'high',
    region: 'all',
    rain: { rain24hMm: 48, rain3DayMm: 135, rain7DayMm: 290 },
    orographic: true,
  },
  barak_flood: {
    id: 'barak_flood',
    label: 'Barak valley flood',
    description:
      'Extreme accumulation over the Barak basin and the Lumding-Badarpur hill section, ' +
      'as in the June 2022 floods that cut Silchar off by road and rail.',
    severity: 'critical',
    region: ['SCL', 'KRM', 'JIR', 'DMR', 'KLS', 'LMG', 'AMB', 'VRG', 'JOW', 'IMF', 'AJL'],
    rain: { rain24hMm: 165, rain3DayMm: 395, rain7DayMm: 540 },
  },
  sikkim_cloudburst: {
    id: 'sikkim_cloudburst',
    label: 'Sikkim cloudburst / NH-10 washout',
    description:
      'Intense rain over the Teesta basin taking out NH-10, Sikkim\'s single road lifeline, ' +
      'as in the October 2023 South Lhonak outburst flood.',
    severity: 'critical',
    region: ['GTK', 'RGP', 'MNG', 'PYG', 'NAM_SK', 'SLG'],
    rain: { rain24hMm: 210, rain3DayMm: 340, rain7DayMm: 420 },
  },
  arunachal_landslides: {
    id: 'arunachal_landslides',
    label: 'Arunachal frontier landslides',
    description:
      'Sustained rain across the Trans-Arunachal Highway corridor, where single-lane ' +
      'high-hill sections fail first and detours run to hundreds of kilometres.',
    severity: 'high',
    region: ['ITA', 'ZRO', 'IXV', 'IXT', 'ROI', 'TEI', 'BOM', 'TAW', 'NAM'],
    rain: { rain24hMm: 95, rain3DayMm: 245, rain7DayMm: 360 },
  },
  dry_season: {
    id: 'dry_season',
    label: 'Dry season',
    description: 'January conditions: negligible rain, but waterway draft falls in the lean season.',
    severity: 'low',
    region: 'all',
    rain: { rain24hMm: 0.3, rain3DayMm: 1.2, rain7DayMm: 3 },
  },
};

export const listScenarios = () => Object.values(SCENARIOS);

/**
 * Apply a scenario's rainfall to one node's weather record.
 * Returns the record unchanged when the scenario does not cover that node.
 */
export function applyScenario(weather, nodeId, scenarioId) {
  const s = SCENARIOS[scenarioId];
  if (!s || !s.rain) return weather;
  const covered = s.region === 'all' || (Array.isArray(s.region) && s.region.includes(nodeId));
  if (!covered) return weather;

  let { rain24hMm, rain3DayMm, rain7DayMm } = s.rain;
  if (s.orographic) {
    // Hills wring far more out of the same system than the valley floor does.
    const elev = NODE_BY_ID[nodeId]?.elevationM ?? 0;
    const gain = 1 + Math.min(elev, 2000) / 2000;
    rain24hMm *= gain;
    rain3DayMm *= gain;
    rain7DayMm *= gain;
  }

  return {
    ...weather,
    precipitationMm: Number(rain24hMm.toFixed(1)),
    rain3DayMm: Number(rain3DayMm.toFixed(1)),
    rain7DayMm: Number(rain7DayMm.toFixed(1)),
    source: `scenario:${s.id}`,
  };
}
