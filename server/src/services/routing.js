/**
 * Route planning.
 *
 * Turns a shipment request into a ranked set of multimodal routings. The search
 * minimises one scalar cost built from five normalised terms - time, money,
 * risk, emissions and accessibility - re-weighted per cargo profile, so a
 * medical consignment and a cement consignment genuinely take different roads
 * rather than the same road with different labels.
 *
 * Risk enters the objective as -ln(1 - p). That is the only additive form whose
 * path total corresponds to the real quantity of interest: the probability the
 * whole routing survives is the product of its links' survival probabilities.
 */
import { MODES } from '../data/edges.js';
import { NODE_BY_ID } from '../data/nodes.js';
import {
  buildGraph, attachEndpoints, dijkstra, yenKShortest, SOURCE, SINK, unkey, supportsMode,
} from './graph.js';
import { assessEdge, riskBand } from './risk.js';
import { scoreRouteAccessibility, edgeAccessibility, gradeFor } from './accessibility.js';
import { clamp, round } from './geo.js';

/** Per-profile objective weights. */
export const PROFILES = {
  general: {
    label: 'General freight',
    description: 'Balanced trade-off across time, cost, reliability and access.',
    weights: { time: 1.0, money: 1.0, risk: 0.8, co2: 0.3, access: 0.4 },
  },
  emergency_medical: {
    label: 'Emergency medical',
    description: 'Speed and reliability dominate; cost is close to irrelevant.',
    weights: { time: 2.4, money: 0.2, risk: 1.8, co2: 0.05, access: 1.2 },
  },
  perishable: {
    label: 'Perishable / agri-produce',
    description: 'Time-critical but cost-aware - spoilage is the real cost.',
    weights: { time: 1.8, money: 0.7, risk: 1.2, co2: 0.2, access: 0.4 },
  },
  bulk_freight: {
    label: 'Bulk freight',
    description: 'Cost per tonne rules; a slower rail or river leg is welcome.',
    weights: { time: 0.25, money: 2.6, risk: 0.9, co2: 0.7, access: 0.2 },
  },
  relief_supplies: {
    label: 'Disaster relief',
    description: 'Must arrive - reliability and last-mile access outrank speed.',
    weights: { time: 1.4, money: 0.4, risk: 2.0, co2: 0.1, access: 1.6 },
  },
  low_emission: {
    label: 'Low-emission',
    description: 'Minimise CO2 per tonne-km, favouring rail and inland waterways.',
    weights: { time: 0.3, money: 0.7, risk: 0.8, co2: 3.0, access: 0.3 },
  },
};

const TERRAIN_SPEED = { plain: 1, hill: 0.72, high_hill: 0.55 };

/**
 * Above this disruption probability a corridor is treated as CLOSED rather than
 * merely expensive. Without this gate the -ln(1 - p) risk term saturates, and a
 * cheap corridor that is all but certainly cut can still out-score a sound one
 * on price alone - the planner would cheerfully route a consignment down a road
 * it has just predicted is washed out. If gating leaves no route at all, the
 * planner re-runs ungated and flags the answer as least-bad.
 */
const IMPASSABLE_P = 0.97;

// Normalisation constants: roughly one "unit" of each term for a typical NER
// movement (~500 km, ~15 h, ~1,600 INR/t, ~31 kg CO2/t by road), so the profile
// weights compare like with like instead of one term silently dominating.
const SCALE = { hours: 12, inrPerTonne: 2000, co2KgPerTonne: 50 };

/** Physical + economic outcome of traversing one corridor. */
function travelMetrics(edge, km, tonnes, assessment) {
  const mode = MODES[edge.mode];
  const terrain = edge.mode === 'road' || edge.mode === 'rail' ? TERRAIN_SPEED[edge.terrain] ?? 1 : 1;
  const surface = edge.mode === 'road' ? 0.6 + 0.4 * edge.surface : 1;
  const hazardDrag = 1 - 0.45 * assessment.disruptionProbability;
  const congestionDrag = 1 - 0.6 * assessment.components.congestion;

  const speed = Math.max(4, mode.baseSpeedKmph * terrain * surface * hazardDrag * congestionDrag);
  return {
    hours: km / speed,
    effectiveSpeedKmph: round(speed, 1),
    inr: km * mode.ratePerTonneKm * tonnes,
    co2Kg: (km * mode.co2GramsPerTonneKm * tonnes) / 1000,
  };
}

/** Handling outcome at an origin, transfer or destination point. */
function handlingMetrics(mode, tonnes, kind) {
  const m = MODES[mode];
  const share = kind === 'transfer' ? 1 : 0.5;
  return { hours: m.handlingHours * share, inr: m.handlingCostPerTonne * tonnes * share, co2Kg: 0 };
}

/**
 * Build the Dijkstra weight function for one request. Assessments are computed
 * once per corridor and memoised - the search revisits corridors constantly.
 */
function makeWeightFn({ weights, tonnes, assessments, gateImpassable = true }) {
  return (arc) => {
    if (arc.type === 'travel') {
      const a = assessments.get(arc.edge);
      if (a.seasonalClosure) return Infinity; // hard-closed, not merely risky
      if (gateImpassable && a.disruptionProbability >= IMPASSABLE_P) return Infinity;
      const m = travelMetrics(arc.edge, arc.km, tonnes, a);
      const p = Math.min(a.disruptionProbability, 0.999);
      const reliabilityCost = -Math.log(1 - p);
      const accessDeficit = 1 - edgeAccessibility(arc.edge);
      return (
        weights.time * (m.hours / SCALE.hours) +
        weights.money * (m.inr / (tonnes * SCALE.inrPerTonne)) +
        weights.risk * reliabilityCost +
        weights.co2 * (m.co2Kg / (tonnes * SCALE.co2KgPerTonne)) +
        weights.access * accessDeficit
      );
    }
    const kind = arc.type === 'transfer' ? 'transfer' : 'endpoint';
    const h = handlingMetrics(arc.mode, tonnes, kind);
    return (
      weights.time * (h.hours / SCALE.hours) +
      weights.money * (h.inr / (tonnes * SCALE.inrPerTonne)) +
      (kind === 'transfer' ? 0.05 : 0) // small bias against gratuitous transshipment
    );
  };
}

/** Expand a raw arc path into the reported itinerary. */
function describePath(path, { tonnes, assessments, consignment }) {
  const legs = [];
  const segments = [];
  const terminals = [];
  let totalKm = 0, totalHours = 0, totalInr = 0, totalCo2 = 0;
  let survival = 1;
  let transshipments = 0;

  for (let i = 0; i < path.arcs.length; i++) {
    const arc = path.arcs[i];

    if (arc.type === 'travel') {
      const a = assessments.get(arc.edge);
      const m = travelMetrics(arc.edge, arc.km, tonnes, a);
      const from = NODE_BY_ID[arc.fromNode];
      const to = NODE_BY_ID[arc.toNode];
      const label = `${from.name} - ${to.name}`;

      totalKm += arc.km;
      totalHours += m.hours;
      totalInr += m.inr;
      totalCo2 += m.co2Kg;
      survival *= 1 - Math.min(a.disruptionProbability, 0.985);

      const seg = {
        kind: 'travel',
        mode: arc.mode,
        modeLabel: MODES[arc.mode].label,
        label,
        ref: arc.edge.ref,
        corridorName: arc.edge.name,
        from: { id: from.id, name: from.name, lat: from.lat, lon: from.lon },
        to: { id: to.id, name: to.name, lat: to.lat, lon: to.lon },
        km: arc.km,
        hours: round(m.hours, 2),
        effectiveSpeedKmph: m.effectiveSpeedKmph,
        costInr: Math.round(m.inr),
        co2Kg: round(m.co2Kg, 1),
        terrain: arc.edge.terrain,
        allWeather: arc.edge.allWeather,
        accessibility: Math.round(edgeAccessibility(arc.edge) * 100),
        risk: a,
        edge: arc.edge,
      };
      segments.push(seg);
      legs.push(seg);
    } else if (arc.type === 'transfer') {
      const node = NODE_BY_ID[arc.fromNode];
      const h = handlingMetrics(arc.mode, tonnes, 'transfer');
      totalHours += h.hours;
      totalInr += h.inr;
      transshipments++;
      terminals.push(node.id);
      legs.push({
        kind: 'transfer',
        at: { id: node.id, name: node.name, lat: node.lat, lon: node.lon },
        fromMode: arc.fromMode,
        toMode: arc.mode,
        label: `Transship ${MODES[arc.fromMode].label} to ${MODES[arc.mode].label} at ${node.name}`,
        hours: round(h.hours, 2),
        costInr: Math.round(h.inr),
      });
    } else {
      // Origin loading and destination delivery handling. These are real time
      // and real money, so they are emitted as legs too - otherwise the
      // itinerary an operator reads would not add up to the quoted total.
      const node = NODE_BY_ID[arc.fromNode];
      const h = handlingMetrics(arc.mode, tonnes, 'endpoint');
      totalHours += h.hours;
      totalInr += h.inr;
      terminals.push(node.id);
      legs.push({
        kind: 'handling',
        at: { id: node.id, name: node.name, lat: node.lat, lon: node.lon },
        mode: arc.mode,
        label:
          arc.type === 'enter'
            ? `Load ${tonnes} t for ${MODES[arc.mode].label.toLowerCase()} at ${node.name}`
            : `Unload and hand over at ${node.name}`,
        hours: round(h.hours, 2),
        costInr: Math.round(h.inr),
      });
    }
  }

  const access = scoreRouteAccessibility(segments, terminals, consignment);
  const riskiest = segments.reduce(
    (worst, s) => (!worst || s.risk.disruptionProbability > worst.risk.disruptionProbability ? s : worst),
    null,
  );
  const modesUsed = [...new Set(segments.map((s) => s.mode))];

  return {
    legs,
    segments,
    modesUsed,
    modeLabel: modesUsed.map((m) => MODES[m].label).join(' + '),
    transshipments,
    totals: {
      distanceKm: Math.round(totalKm),
      hours: round(totalHours, 1),
      etaText: formatDuration(totalHours),
      costInr: Math.round(totalInr),
      costPerTonneInr: Math.round(totalInr / tonnes),
      co2Kg: round(totalCo2, 1),
      co2PerTonneKg: round(totalCo2 / tonnes, 2),
    },
    reliability: {
      arrivalProbability: round(survival, 4),
      worstLinkProbability: riskiest ? riskiest.risk.disruptionProbability : 0,
      worstLink: riskiest ? { label: riskiest.label, ref: riskiest.ref, band: riskiest.risk.band } : null,
      band: riskBand(1 - survival),
    },
    accessibility: access,
    geometry: buildGeometry(segments),
  };
}

function buildGeometry(segments) {
  return segments.map((s) => ({
    mode: s.mode,
    risk: s.risk.disruptionProbability,
    band: s.risk.band,
    label: s.label,
    coords: [
      [s.from.lat, s.from.lon],
      [s.to.lat, s.to.lon],
    ],
  }));
}

export function formatDuration(hours) {
  if (!Number.isFinite(hours)) return 'n/a';
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  if (d && h) return `${d}d ${h}h`;
  if (d) return `${d}d`;
  return `${Math.round(hours * 10) / 10}h`;
}

/**
 * Plan a shipment.
 *
 * @param {{
 *   origin:string, destination:string, tonnes?:number, profile?:string,
 *   modes?:string[], alternatives?:number, vehicleGrossWeightT?:number,
 *   nightDeparture?:boolean, needsStepFree?:boolean, date?:Date
 * }} req
 */
export function planRoute(req) {
  const {
    origin, destination,
    tonnes = 10,
    profile = 'general',
    modes = ['road', 'rail', 'water', 'air'],
    alternatives = 3,
    vehicleGrossWeightT = 16,
    nightDeparture = false,
    needsStepFree = false,
    scenario = 'live',
    date = new Date(),
  } = req;

  const originNode = NODE_BY_ID[origin];
  const destNode = NODE_BY_ID[destination];
  if (!originNode) throw Object.assign(new Error(`Unknown origin '${origin}'`), { status: 400 });
  if (!destNode) throw Object.assign(new Error(`Unknown destination '${destination}'`), { status: 400 });
  if (origin === destination) throw Object.assign(new Error('Origin and destination are the same'), { status: 400 });

  const prof = PROFILES[profile];
  if (!prof) throw Object.assign(new Error(`Unknown profile '${profile}'`), { status: 400 });

  const allowedModes = modes.filter((m) => MODES[m]);
  if (!allowedModes.length) throw Object.assign(new Error('No valid transport modes selected'), { status: 400 });
  if (!allowedModes.some((m) => supportsMode(originNode, m))) {
    throw Object.assign(new Error(`${originNode.name} has no terminal for the selected modes`), { status: 400 });
  }
  if (!allowedModes.some((m) => supportsMode(destNode, m))) {
    throw Object.assign(new Error(`${destNode.name} has no terminal for the selected modes`), { status: 400 });
  }

  // Assess every corridor once for this request.
  const assessments = new Map();
  const { adj } = buildGraph({ allowedModes });
  for (const arcs of adj.values()) {
    for (const arc of arcs) {
      if (arc.type === 'travel' && !assessments.has(arc.edge)) {
        assessments.set(arc.edge, assessEdge(arc.edge, date, scenario));
      }
    }
  }

  attachEndpoints(adj, origin, destination, allowedModes);
  const consignment = { vehicleGrossWeightT, nightDeparture, needsStepFree };

  // Yen guarantees loopless paths over the EXPANDED graph, where GHY::road and
  // GHY::air are different vertices - so it can legally return "drive Guwahati
  // to Shillong, then fly Shillong-Guwahati-Imphal", which revisits Guwahati and
  // is nonsense on the ground. Over-fetch and drop any path that revisits a
  // physical node.
  const wanted = alternatives + 1;
  const search = (gateImpassable) =>
    yenKShortest(
      adj,
      SOURCE,
      SINK,
      makeWeightFn({ weights: prof.weights, tonnes, assessments, gateImpassable }),
      Math.max(1, wanted * 4 + 4),
    );

  let raw = search(true);
  let degraded = false;
  if (!raw.length) {
    // Every corridor out of here is predicted closed. Say so, and still show the
    // least-bad option rather than an error - the consignment still has to move.
    raw = search(false);
    degraded = true;
  }
  if (!raw.length) {
    throw Object.assign(
      new Error(`No route exists from ${originNode.name} to ${destNode.name} with the selected modes`),
      { status: 404 },
    );
  }

  const seen = new Set();
  const routes = [];
  for (const p of raw) {
    const described = describePath(p, { tonnes, assessments, consignment });

    const visited = described.segments.length
      ? [described.segments[0].from.id, ...described.segments.map((s) => s.to.id)]
      : [];
    if (new Set(visited).size !== visited.length) continue;

    // Collapse routings whose physical corridor sequence is identical.
    const sig = described.segments.map((s) => `${s.from.id}-${s.to.id}-${s.mode}`).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);

    routes.push({ ...described, objectiveCost: round(p.cost, 4) });
    if (routes.length >= wanted) break;
  }

  // Compare each routing against the best value on each axis.
  const best = {
    hours: Math.min(...routes.map((r) => r.totals.hours)),
    costInr: Math.min(...routes.map((r) => r.totals.costInr)),
    co2Kg: Math.min(...routes.map((r) => r.totals.co2Kg)),
    arrival: Math.max(...routes.map((r) => r.reliability.arrivalProbability)),
    access: Math.max(...routes.map((r) => r.accessibility.score)),
  };
  routes.forEach((r, i) => {
    r.rank = i + 1;
    r.recommended = i === 0;
    r.id = `R${i + 1}`;
    r.scorecard = {
      speed: Math.round(100 * (best.hours / Math.max(r.totals.hours, 0.01))),
      cost: Math.round(100 * (best.costInr / Math.max(r.totals.costInr, 1))),
      emissions: Math.round(100 * (best.co2Kg / Math.max(r.totals.co2Kg, 0.01))),
      reliability: Math.round(100 * r.reliability.arrivalProbability),
      accessibility: r.accessibility.score,
    };
    r.overallGrade = gradeFor(r.accessibility.score);
  });

  return {
    degraded,
    degradedNote: degraded
      ? `Every routing from ${originNode.name} to ${destNode.name} crosses at least one corridor ` +
        `that the model expects to be closed (disruption probability above ${Math.round(IMPASSABLE_P * 100)}%). ` +
        'The least-bad option is shown - treat dispatch as conditional on ground confirmation.'
      : null,
    request: {
      origin: { id: originNode.id, name: originNode.name, state: originNode.state, lat: originNode.lat, lon: originNode.lon },
      destination: { id: destNode.id, name: destNode.name, state: destNode.state, lat: destNode.lat, lon: destNode.lon },
      tonnes,
      profile,
      profileLabel: prof.label,
      weights: prof.weights,
      modes: allowedModes,
      vehicleGrossWeightT,
      nightDeparture,
      needsStepFree,
      scenario,
      plannedAt: date.toISOString(),
    },
    routes,
  };
}
