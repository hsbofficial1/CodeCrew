/**
 * Accessibility intelligence.
 *
 * Two related but distinct questions:
 *
 *  1. Is this ROUTE physically usable for this consignment and these people?
 *     Bridge load class against vehicle weight, gradient, all-weather status,
 *     night-travel safety, and step-free / ramped / assisted handling at every
 *     terminal the consignment passes through.
 *
 *  2. How well-served is this SETTLEMENT? A 0-100 index over last-mile gap,
 *     distance to the nearest health facility, all-weather approach, terminal
 *     accessibility, network connectivity and mobile coverage.
 *
 * Every score returns its own sub-scores and a list of concrete barriers, so the
 * number is auditable instead of being a black box.
 */
import { NODE_BY_ID, NODES } from '../data/nodes.js';
import { EDGES } from '../data/edges.js';
import { clamp, round } from './geo.js';

const LANE_SCORE = { 1: 0.3, 2: 0.7, 4: 1.0 };

/** Physical usability of a corridor, 0..1. */
export function edgeAccessibility(edge) {
  if (edge.mode === 'air') return 0.92;
  if (edge.mode === 'water') return 0.7;

  const gradient = 1 - clamp((edge.maxGradientPct - 4) / 10);
  const bridge = clamp(edge.bridgeLoadClassT / 60);
  const parts = {
    allWeather: edge.allWeather ? 1 : 0,
    surface: edge.surface,
    lanes: edge.mode === 'rail' ? 0.85 : LANE_SCORE[edge.lanes] ?? 0.5,
    gradient: edge.mode === 'rail' ? 0.9 : gradient,
    bridge: edge.mode === 'rail' ? 0.9 : bridge,
    nightSafe: edge.nightTravelSafe ? 1 : 0,
  };
  const w = { allWeather: 0.25, surface: 0.2, lanes: 0.15, gradient: 0.15, bridge: 0.15, nightSafe: 0.1 };
  return clamp(Object.entries(w).reduce((s, [k, wk]) => s + wk * parts[k], 0));
}

/** Terminal handling accessibility at a node, 0..1. */
export function terminalAccessibility(node) {
  const a = node.access;
  return clamp(0.35 * (a.rampAccess ? 1 : 0) + 0.35 * (a.stepFreeAccess ? 1 : 0) + 0.3 * (a.assistedBoarding ? 1 : 0));
}

/**
 * Score a planned route and enumerate what would actually stop it.
 *
 * @param {Array<object>} segments  travel segments from routing.js
 * @param {Array<string>} terminalNodeIds nodes where the load is handled
 * @param {{ vehicleGrossWeightT:number, nightDeparture:boolean, needsStepFree:boolean }} consignment
 */
export function scoreRouteAccessibility(segments, terminalNodeIds, consignment) {
  const barriers = [];
  const totalKm = segments.reduce((s, x) => s + x.km, 0) || 1;

  let corridorScore = 0;
  for (const seg of segments) {
    const e = seg.edge;
    corridorScore += (edgeAccessibility(e) * seg.km) / totalKm;
    if (!e) continue;

    if (e.mode === 'road' && e.bridgeLoadClassT < consignment.vehicleGrossWeightT) {
      barriers.push({
        severity: 'blocking',
        where: seg.label,
        issue: `Bridge load class ${e.bridgeLoadClassT} t is below the ${consignment.vehicleGrossWeightT} t vehicle gross weight`,
        mitigation: 'Split the consignment across lighter vehicles or divert to a rail leg',
      });
    }
    if (!e.allWeather) {
      barriers.push({
        severity: 'major',
        where: seg.label,
        issue: 'Not an all-weather corridor - liable to close during sustained rain',
        mitigation: 'Confirm the corridor is open before dispatch and keep the alternative routing live',
      });
    }
    if (e.mode === 'road' && e.maxGradientPct >= 10) {
      barriers.push({
        severity: 'minor',
        where: seg.label,
        issue: `Sustained gradient up to ${e.maxGradientPct}% - restricts heavy and low-power vehicles`,
        mitigation: 'Use a lower-tonnage vehicle with adequate power-to-weight',
      });
    }
    if (!e.nightTravelSafe && consignment.nightDeparture) {
      barriers.push({
        severity: 'major',
        where: seg.label,
        issue: 'Night travel is not advised on this corridor',
        mitigation: 'Shift departure to first light, or halt at the last safe town',
      });
    }
  }

  let terminalScore = 0;
  const uniqueTerminals = [...new Set(terminalNodeIds)];
  for (const id of uniqueTerminals) {
    const node = NODE_BY_ID[id];
    if (!node) continue;
    terminalScore += terminalAccessibility(node) / uniqueTerminals.length;
    if (consignment.needsStepFree && !node.access.stepFreeAccess) {
      barriers.push({
        severity: 'major',
        where: node.name,
        issue: 'No step-free handling at this terminal',
        mitigation: 'Arrange a portable ramp and assisted handling in advance',
      });
    }
    if (node.access.lastMileGapKm > 10) {
      barriers.push({
        severity: 'major',
        where: node.name,
        issue: `${node.access.lastMileGapKm} km last-mile gap beyond the motorable road head`,
        mitigation: 'Plan a porter / small-vehicle relay for the final leg',
      });
    }
  }

  const score = clamp(0.6 * corridorScore + 0.4 * terminalScore);
  const order = { blocking: 0, major: 1, minor: 2 };
  barriers.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    score: Math.round(score * 100),
    corridorScore: Math.round(corridorScore * 100),
    terminalScore: Math.round(terminalScore * 100),
    grade: gradeFor(score * 100),
    barriers,
    blocking: barriers.filter((b) => b.severity === 'blocking').length,
  };
}

export function gradeFor(score0to100) {
  if (score0to100 >= 80) return 'A - fully accessible';
  if (score0to100 >= 65) return 'B - accessible with planning';
  if (score0to100 >= 50) return 'C - restricted access';
  if (score0to100 >= 35) return 'D - severely restricted';
  return 'E - effectively cut off';
}

// ------------------------------------------------- settlement-level index

/** Degree and best-corridor quality for a node, used as a connectivity proxy. */
function connectivityFor(nodeId) {
  const incident = EDGES.filter((e) => e.from === nodeId || e.to === nodeId);
  if (!incident.length) return { score: 0, links: 0, modes: [] };
  const best = Math.max(...incident.map(edgeAccessibility));
  const modes = [...new Set(incident.map((e) => e.mode))];
  const degree = clamp(incident.length / 5);
  return { score: clamp(0.6 * best + 0.25 * degree + 0.15 * clamp(modes.length / 3)), links: incident.length, modes };
}

/** 0-100 accessibility index for one settlement, with its sub-scores. */
export function settlementIndex(node) {
  const a = node.access;
  const conn = connectivityFor(node.id);

  const sub = {
    lastMile: 100 * (1 - clamp(a.lastMileGapKm / 20)),
    healthAccess: 100 * (1 - clamp(a.nearestHealthFacilityKm / 40)),
    allWeatherApproach: a.allWeatherApproach ? 100 : 35,
    terminalAccess: 100 * terminalAccessibility(node),
    networkConnectivity: 100 * conn.score,
    digitalCoverage: a.coverage === '4g' ? 100 : a.coverage === '2g' ? 55 : 10,
  };
  const w = {
    lastMile: 0.22,
    healthAccess: 0.2,
    allWeatherApproach: 0.16,
    terminalAccess: 0.16,
    networkConnectivity: 0.16,
    digitalCoverage: 0.1,
  };
  const index = Object.entries(w).reduce((s, [k, wk]) => s + wk * sub[k], 0);

  return {
    nodeId: node.id,
    name: node.name,
    state: node.state,
    lat: node.lat,
    lon: node.lon,
    category: node.category,
    populationServed: node.populationServed,
    index: Math.round(index),
    grade: gradeFor(index),
    subScores: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, Math.round(v)])),
    connectivity: { links: conn.links, modes: conn.modes },
    access: a,
  };
}

export function allSettlementIndices() {
  return NODES.map(settlementIndex).sort((a, b) => a.index - b.index);
}

/** State roll-up: population-weighted mean index plus the worst-served places. */
export function stateAccessibilityRollup() {
  const byState = {};
  for (const s of allSettlementIndices()) {
    (byState[s.state] ??= []).push(s);
  }
  return Object.entries(byState)
    .map(([state, list]) => {
      const pop = list.reduce((t, s) => t + s.populationServed, 0);
      const weighted = list.reduce((t, s) => t + s.index * s.populationServed, 0) / (pop || 1);
      const underserved = list.filter((s) => s.index < 50);
      return {
        state,
        settlements: list.length,
        populationServed: pop,
        meanIndex: Math.round(list.reduce((t, s) => t + s.index, 0) / list.length),
        populationWeightedIndex: Math.round(weighted),
        underservedCount: underserved.length,
        underservedPopulation: underserved.reduce((t, s) => t + s.populationServed, 0),
        worst: list.slice(0, 3).map((s) => ({ name: s.name, index: s.index })),
      };
    })
    .sort((a, b) => a.populationWeightedIndex - b.populationWeightedIndex);
}
