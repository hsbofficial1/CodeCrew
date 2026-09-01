/**
 * Network-wide situational picture.
 *
 * Everything here is derived on demand from the current weather cache and the
 * risk engine - there is no hand-written alert list. If the rain stops, the
 * alerts clear on their own.
 */
import { EDGES, MODES } from '../data/edges.js';
import { NODE_BY_ID, NODES, NER_STATES } from '../data/nodes.js';
import { assessEdge, riskBand } from './risk.js';
import { edgeLengthKm, buildGraph, dijkstraFrom, supportsMode, vkey, unkey, SOURCE } from './graph.js';
import { round } from './geo.js';

/** Assess every corridor once. */
export function assessNetwork(date = new Date(), scenario = 'live') {
  return EDGES.map((edge) => {
    const risk = assessEdge(edge, date, scenario);
    const from = NODE_BY_ID[edge.from];
    const to = NODE_BY_ID[edge.to];
    return {
      id: `${edge.from}-${edge.to}-${edge.mode}`,
      from: { id: from.id, name: from.name, lat: from.lat, lon: from.lon, state: from.state },
      to: { id: to.id, name: to.name, lat: to.lat, lon: to.lon, state: to.state },
      mode: edge.mode,
      modeLabel: MODES[edge.mode].label,
      ref: edge.ref,
      name: edge.name,
      km: edgeLengthKm(edge),
      terrain: edge.terrain,
      allWeather: edge.allWeather,
      states: [...new Set([from.state, to.state])],
      risk,
    };
  });
}

/** Corridors whose current risk warrants an operator alert. */
export function generateAlerts(date = new Date(), scenario = 'live') {
  const corridors = assessNetwork(date, scenario);
  const alerts = [];

  for (const c of corridors) {
    const p = c.risk.disruptionProbability;
    if (c.risk.seasonalClosure) {
      alerts.push({
        id: `closure-${c.id}`,
        severity: 'critical',
        type: 'seasonal-closure',
        corridor: c.name ?? c.id,
        ref: c.ref,
        states: c.states,
        headline: `${c.name ?? c.id} is closed: ${c.risk.seasonalClosure.reason}`,
        detail: 'Plan around this corridor for the whole closure window; no re-routing on the link itself is possible.',
        probability: 1,
        geometry: [[c.from.lat, c.from.lon], [c.to.lat, c.to.lon]],
      });
      continue;
    }
    if (p < 0.45) continue;

    const cmp = c.risk.components;
    const cause =
      cmp.landslide >= cmp.flood
        ? `landslide risk ${Math.round(cmp.landslide * 100)}% after ${c.risk.inputs.rain3DayMm} mm in 3 days`
        : `flood risk ${Math.round(cmp.flood * 100)}% on ${c.risk.inputs.rain7DayMm} mm accumulation`;

    alerts.push({
      id: `risk-${c.id}`,
      severity: p >= 0.7 ? 'critical' : 'warning',
      type: 'disruption-risk',
      corridor: c.name ?? c.id,
      ref: c.ref,
      states: c.states,
      headline: `${Math.round(p * 100)}% disruption risk on ${c.name ?? `${c.from.name} - ${c.to.name}`}`,
      detail: `Driven by ${cause}.${c.allWeather ? '' : ' This is not an all-weather corridor.'}`,
      probability: round(p, 3),
      geometry: [[c.from.lat, c.from.lon], [c.to.lat, c.to.lon]],
    });
  }

  const rank = { critical: 0, warning: 1 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.probability - a.probability);
  return alerts;
}

/**
 * Reachability under degraded conditions.
 *
 * Treat every corridor above `threshold` disruption risk as cut, then ask which
 * settlements can still be reached from the hub and how far the detour is.
 *
 * Air is excluded by default and that is deliberate: relief consignments, farm
 * produce and routine resupply move over surface modes, and an air bridge that
 * exists on paper hides exactly the isolation this view is meant to expose. The
 * caller can add it back to see what an air bridge would recover.
 */
export function isolationRisk(
  threshold = 0.6,
  hub = 'GHY',
  date = new Date(),
  scenario = 'live',
  modes = ['road', 'rail', 'water'],
) {
  const measure = (weightFn) => {
    const { adj } = buildGraph({ allowedModes: modes });
    adj.set(
      SOURCE,
      modes
        .filter((m) => supportsMode(NODE_BY_ID[hub], m))
        .map((m) => ({ type: 'enter', to: vkey(hub, m), km: 0, fromNode: hub, toNode: hub, mode: m })),
    );
    const dist = dijkstraFrom(adj, SOURCE, weightFn);
    // Best arrival distance at a node across whichever mode reaches it.
    const best = new Map();
    for (const [v, d] of dist) {
      if (v === SOURCE) continue;
      const { nodeId } = unkey(v);
      if (d < (best.get(nodeId) ?? Infinity)) best.set(nodeId, d);
    }
    return best;
  };

  const assessments = new Map();
  const assessmentFor = (edge) => {
    if (!assessments.has(edge)) assessments.set(edge, assessEdge(edge, date, scenario));
    return assessments.get(edge);
  };

  const normal = measure((arc) => (arc.type === 'travel' ? arc.km : 0.01));
  const degraded = measure((arc) => {
    if (arc.type !== 'travel') return 0.01;
    const a = assessmentFor(arc.edge);
    if (a.seasonalClosure || a.disruptionProbability >= threshold) return Infinity;
    return arc.km;
  });

  const cutOff = [];
  const atRisk = [];
  for (const node of NODES) {
    if (node.id === hub || !NER_STATES.includes(node.state)) continue;
    const base = normal.get(node.id);
    if (base === undefined) continue; // unreachable even in fair weather
    const now = degraded.get(node.id);

    if (now === undefined) {
      cutOff.push({
        nodeId: node.id, name: node.name, state: node.state,
        lat: node.lat, lon: node.lon, populationServed: node.populationServed,
        normalKm: Math.round(base),
        hasAirport: node.terminals.air,
      });
      continue;
    }
    const detourKm = Math.round(now - base);
    if (detourKm > 40) {
      atRisk.push({
        nodeId: node.id, name: node.name, state: node.state,
        lat: node.lat, lon: node.lon, populationServed: node.populationServed,
        normalKm: Math.round(base), degradedKm: Math.round(now), detourKm,
      });
    }
  }

  cutOff.sort((a, b) => b.populationServed - a.populationServed);
  atRisk.sort((a, b) => b.detourKm - a.detourKm);
  return {
    hub,
    hubName: NODE_BY_ID[hub]?.name ?? hub,
    threshold,
    modes,
    scenario,
    cutOff,
    cutOffPopulation: cutOff.reduce((s, n) => s + n.populationServed, 0),
    reachableByAirOnly: cutOff.filter((n) => n.hasAirport).map((n) => n.name),
    atRisk: atRisk.slice(0, 12),
    detouredPopulation: atRisk.reduce((s, n) => s + n.populationServed, 0),
  };
}

/** Headline numbers for the dashboard. */
export function networkSummary(date = new Date(), scenario = 'live') {
  const corridors = assessNetwork(date, scenario);
  const byBand = { low: 0, moderate: 0, high: 0, severe: 0 };
  for (const c of corridors) byBand[c.risk.band]++;

  const byState = {};
  for (const c of corridors) {
    for (const s of c.states) {
      if (!NER_STATES.includes(s)) continue;
      (byState[s] ??= []).push(c.risk.disruptionProbability);
    }
  }

  return {
    corridors: corridors.length,
    settlements: NODES.length,
    states: NER_STATES.length,
    networkKm: corridors.reduce((s, c) => s + c.km, 0),
    byMode: Object.fromEntries(
      Object.keys(MODES).map((m) => [m, corridors.filter((c) => c.mode === m).length]),
    ),
    riskBands: byBand,
    meanDisruptionRisk: round(
      corridors.reduce((s, c) => s + c.risk.disruptionProbability, 0) / corridors.length, 3,
    ),
    stateRisk: Object.entries(byState)
      .map(([state, ps]) => ({
        state,
        corridors: ps.length,
        meanRisk: round(ps.reduce((a, b) => a + b, 0) / ps.length, 3),
        band: riskBand(ps.reduce((a, b) => a + b, 0) / ps.length),
      }))
      .sort((a, b) => b.meanRisk - a.meanRisk),
  };
}
