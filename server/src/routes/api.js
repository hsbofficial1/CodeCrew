import { Router } from 'express';
import { NODES, NODE_BY_ID, NER_STATES } from '../data/nodes.js';
import { EDGES, MODES } from '../data/edges.js';
import { planRoute, PROFILES } from '../services/routing.js';
import { explainRoute, explainComparison, toTextBulletin } from '../services/explain.js';
import { assessNetwork, generateAlerts, isolationRisk, networkSummary } from '../services/alerts.js';
import { allSettlementIndices, settlementIndex, stateAccessibilityRollup } from '../services/accessibility.js';
import { getModelCard } from '../services/risk.js';
import { weatherStatus, allWeather, refreshWeather, getWeather } from '../services/weather.js';
import { listScenarios, SCENARIOS } from '../services/scenarios.js';
import { edgeLengthKm } from '../services/graph.js';

export const api = Router();

/** Reject an unknown scenario rather than silently falling back to `live`. */
function readScenario(req) {
  const s = req.query.scenario ?? req.body?.scenario ?? 'live';
  if (!SCENARIOS[s]) {
    throw Object.assign(new Error(`Unknown scenario '${s}'`), { status: 400 });
  }
  return s;
}

api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'NER Smart Logistics & Accessibility Intelligence Platform',
    problemStatement: 'SIH26002',
    time: new Date().toISOString(),
    weather: weatherStatus(),
    model: getModelCard() ? { trainedAt: getModelCard().trainedAt, rocAuc: getModelCard().heldOut.rocAuc } : null,
  });
});

api.get('/meta', (_req, res) => {
  res.json({
    states: NER_STATES,
    modes: Object.entries(MODES).map(([id, m]) => ({
      id,
      label: m.label,
      baseSpeedKmph: m.baseSpeedKmph,
      ratePerTonneKm: m.ratePerTonneKm,
      co2GramsPerTonneKm: m.co2GramsPerTonneKm,
    })),
    profiles: Object.entries(PROFILES).map(([id, p]) => ({ id, ...p })),
    scenarios: listScenarios(),
  });
});

api.get('/nodes', (_req, res) => {
  res.json(
    NODES.map((n) => ({
      id: n.id, name: n.name, state: n.state, lat: n.lat, lon: n.lon,
      elevationM: n.elevationM, category: n.category,
      populationServed: n.populationServed, terminals: n.terminals,
    })),
  );
});

/** Full base network with live per-corridor risk - drives the dashboard map. */
api.get('/network', (req, res) => {
  const scenario = readScenario(req);
  res.json({
    scenario,
    weather: weatherStatus(),
    nodes: NODES.map((n) => ({
      id: n.id, name: n.name, state: n.state, lat: n.lat, lon: n.lon,
      category: n.category, terminals: n.terminals, populationServed: n.populationServed,
      weather: getWeather(n.id, scenario),
    })),
    corridors: assessNetwork(new Date(), scenario),
  });
});

api.get('/summary', (req, res) => {
  const scenario = readScenario(req);
  res.json({ scenario, ...networkSummary(new Date(), scenario), weather: weatherStatus() });
});

api.get('/alerts', (req, res) => {
  const scenario = readScenario(req);
  res.json({ scenario, generatedAt: new Date().toISOString(), alerts: generateAlerts(new Date(), scenario) });
});

api.get('/isolation', (req, res) => {
  const scenario = readScenario(req);
  const threshold = Math.min(0.99, Math.max(0.1, Number(req.query.threshold ?? 0.6)));
  const hub = req.query.hub ?? 'GHY';
  if (!NODE_BY_ID[hub]) throw Object.assign(new Error(`Unknown hub '${hub}'`), { status: 400 });
  const modes = req.query.modes
    ? String(req.query.modes).split(',').filter((m) => MODES[m])
    : ['road', 'rail', 'water'];
  res.json(isolationRisk(threshold, hub, new Date(), scenario, modes));
});

/** Plan a shipment. Returns ranked routings plus a grounded explanation. */
api.post('/plan', (req, res) => {
  const scenario = readScenario(req);
  const body = req.body ?? {};
  const plan = planRoute({
    origin: body.origin,
    destination: body.destination,
    tonnes: clampNumber(body.tonnes, 0.1, 5000, 10),
    profile: body.profile ?? 'general',
    modes: Array.isArray(body.modes) && body.modes.length ? body.modes : ['road', 'rail', 'water', 'air'],
    alternatives: clampNumber(body.alternatives, 0, 5, 2),
    vehicleGrossWeightT: clampNumber(body.vehicleGrossWeightT, 1, 120, 16),
    nightDeparture: Boolean(body.nightDeparture),
    needsStepFree: Boolean(body.needsStepFree),
    scenario,
  });

  plan.explanations = plan.routes.map((r) => ({
    routeId: r.id,
    lines: explainRoute(r, plan.request),
  }));
  plan.comparison = explainComparison(plan.routes, plan.request);
  plan.bulletin = toTextBulletin(plan);
  // The full edge object on each segment is internal - strip it from the wire.
  for (const r of plan.routes) for (const s of r.segments) delete s.edge;
  for (const r of plan.routes) for (const l of r.legs) delete l.edge;
  res.json(plan);
});

api.get('/accessibility', (_req, res) => {
  res.json({ settlements: allSettlementIndices(), states: stateAccessibilityRollup() });
});

api.get('/accessibility/states', (_req, res) => res.json(stateAccessibilityRollup()));

api.get('/accessibility/:nodeId', (req, res) => {
  const node = NODE_BY_ID[req.params.nodeId];
  if (!node) throw Object.assign(new Error(`Unknown settlement '${req.params.nodeId}'`), { status: 404 });
  const incident = EDGES.filter((e) => e.from === node.id || e.to === node.id).map((e) => ({
    ref: e.ref, name: e.name, mode: e.mode, km: edgeLengthKm(e),
    allWeather: e.allWeather, terrain: e.terrain,
    other: NODE_BY_ID[e.from === node.id ? e.to : e.from].name,
  }));
  res.json({ ...settlementIndex(node), corridors: incident });
});

api.get('/model', (_req, res) => {
  const card = getModelCard();
  if (!card) throw Object.assign(new Error('Model has not finished training'), { status: 503 });
  res.json(card);
});

api.get('/weather', (req, res) => {
  const scenario = readScenario(req);
  res.json({
    status: weatherStatus(),
    scenario,
    byNode: scenario === 'live'
      ? allWeather()
      : Object.fromEntries(NODES.map((n) => [n.id, getWeather(n.id, scenario)])),
  });
});

api.post('/weather/refresh', async (_req, res) => {
  await refreshWeather();
  res.json(weatherStatus());
});

function clampNumber(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
