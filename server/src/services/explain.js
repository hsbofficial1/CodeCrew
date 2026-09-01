/**
 * Decision explanation.
 *
 * This is a grounded, template-driven generator, not a language model: every
 * clause it emits is derived from a number the planner actually computed, and
 * it cannot say anything the data does not support. For an operator deciding
 * whether to dispatch, a traceable explanation beats a fluent one - and it costs
 * nothing to run offline, which matters for the low-bandwidth deployment.
 */
import { MODES } from '../data/edges.js';
import { PROFILES, formatDuration } from './routing.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const inr = (v) => `Rs ${v.toLocaleString('en-IN')}`;

/** Human-readable reasons a corridor is risky right now. */
function hazardReasons(assessment) {
  const c = assessment.components;
  const out = [];
  if (assessment.seasonalClosure) {
    out.push(`seasonally closed (${assessment.seasonalClosure.reason})`);
  }
  if (c.landslide >= 0.25) {
    out.push(`landslide probability ${pct(c.landslide)} after ${assessment.inputs.rain3DayMm} mm of rain in three days`);
  }
  if (c.flood >= 0.25) {
    out.push(`flood probability ${pct(c.flood)} on ${assessment.inputs.rain7DayMm} mm of basin accumulation`);
  }
  if (c.congestion >= 0.3) {
    out.push(`heavy commercial traffic (congestion index ${c.congestion.toFixed(2)})`);
  }
  return out;
}

/** Explain one route on its own terms. */
export function explainRoute(route, request) {
  const profile = PROFILES[request.profile];
  const t = route.totals;
  const lines = [];

  const corridorNames = route.segments
    .map((s) => s.ref || s.modeLabel)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4)
    .join(', ');

  lines.push(
    `${route.recommended ? 'Recommended' : `Alternative ${route.rank - 1}`}: ` +
      `${route.modeLabel} via ${corridorNames} - ${t.distanceKm} km, ` +
      `${t.etaText} door to door, ${inr(t.costInr)} for ${request.tonnes} t ` +
      `(${inr(t.costPerTonneInr)}/t), ${t.co2Kg} kg CO2.`,
  );

  lines.push(
    `Chosen against the "${profile.label}" objective, which weights time ${profile.weights.time}, ` +
      `cost ${profile.weights.money}, reliability ${profile.weights.risk}, ` +
      `emissions ${profile.weights.co2} and accessibility ${profile.weights.access}.`,
  );

  // Reliability, anchored on the weakest link.
  const rel = route.reliability;
  if (rel.worstLink) {
    lines.push(
      `Probability the whole routing runs undisrupted is ${pct(rel.arrivalProbability)}. ` +
        `The weakest link is ${rel.worstLink.label}` +
        `${rel.worstLink.ref ? ` (${rel.worstLink.ref})` : ''} at ${rel.worstLink.band} risk.`,
    );
  }

  // Why the risky segments are risky.
  const risky = route.segments
    .filter((s) => s.risk.disruptionProbability >= 0.3)
    .sort((a, b) => b.risk.disruptionProbability - a.risk.disruptionProbability)
    .slice(0, 2);
  for (const s of risky) {
    const reasons = hazardReasons(s.risk);
    lines.push(
      `${s.label}: ${pct(s.risk.disruptionProbability)} disruption risk` +
        (reasons.length ? ` - driven by ${reasons.join('; ')}.` : '.') +
        ` Physical model says ${pct(s.risk.components.physicalModel)}, the trained classifier says ` +
        `${pct(s.risk.components.learnedModel)}.`,
    );
  }

  // Transshipment, if any.
  const transfers = route.legs.filter((l) => l.kind === 'transfer');
  if (transfers.length) {
    lines.push(
      `Includes ${transfers.length} transshipment${transfers.length > 1 ? 's' : ''}: ` +
        transfers.map((x) => x.label).join('; ') +
        ` - adding ${formatDuration(transfers.reduce((s, x) => s + x.hours, 0))} of handling.`,
    );
  }

  // Accessibility.
  const acc = route.accessibility;
  lines.push(
    `Accessibility ${acc.score}/100 (${acc.grade}) - corridor ${acc.corridorScore}, terminals ${acc.terminalScore}.`,
  );
  const blocking = acc.barriers.filter((b) => b.severity === 'blocking');
  if (blocking.length) {
    lines.push(
      `BLOCKING: ${blocking.map((b) => `${b.where} - ${b.issue}. ${b.mitigation}.`).join(' ')}`,
    );
  } else if (acc.barriers.length) {
    const b = acc.barriers[0];
    lines.push(`Main barrier: ${b.where} - ${b.issue}. Mitigation: ${b.mitigation}.`);
  }

  return lines;
}

/** Explain why the recommendation beats each alternative, axis by axis. */
export function explainComparison(routes, request) {
  if (routes.length < 2) return [];
  const [best, ...rest] = routes;
  const out = [];

  for (const alt of rest) {
    const deltas = [];
    const dh = alt.totals.hours - best.totals.hours;
    const dc = alt.totals.costInr - best.totals.costInr;
    const de = alt.totals.co2Kg - best.totals.co2Kg;
    const dr = alt.reliability.arrivalProbability - best.reliability.arrivalProbability;
    const da = alt.accessibility.score - best.accessibility.score;

    if (Math.abs(dh) >= 0.5) deltas.push(`${formatDuration(Math.abs(dh))} ${dh > 0 ? 'slower' : 'faster'}`);
    if (Math.abs(dc) >= 1) deltas.push(`${inr(Math.abs(Math.round(dc)))} ${dc > 0 ? 'dearer' : 'cheaper'}`);
    if (Math.abs(de) >= 1) deltas.push(`${Math.abs(Math.round(de))} kg ${de > 0 ? 'more' : 'less'} CO2`);
    if (Math.abs(dr) >= 0.02) deltas.push(`${Math.abs(Math.round(dr * 100))} points ${dr > 0 ? 'more' : 'less'} likely to arrive undisrupted`);
    if (Math.abs(da) >= 3) deltas.push(`${Math.abs(da)} points ${da > 0 ? 'better' : 'worse'} on accessibility`);

    out.push({
      routeId: alt.id,
      summary: `${alt.id} (${alt.modeLabel}) is ${deltas.join(', ') || 'near-identical'} compared with ${best.id}.`,
      preferWhen: preferenceHint(alt, best),
    });
  }
  return out;
}

function preferenceHint(alt, best) {
  if (alt.totals.costInr < best.totals.costInr) return 'Prefer when the consignment is not time-critical and cost per tonne is the binding constraint.';
  if (alt.totals.hours < best.totals.hours) return 'Prefer when arrival time matters more than the extra spend.';
  if (alt.reliability.arrivalProbability > best.reliability.arrivalProbability) return 'Prefer when the consignment absolutely must not be stranded en route.';
  if (alt.accessibility.score > best.accessibility.score) return 'Prefer when handling accessibility at the terminals is the constraint.';
  if (alt.totals.co2Kg < best.totals.co2Kg) return 'Prefer when the emissions budget is the binding constraint.';
  return 'Keep as a live fallback if the recommended corridor closes.';
}

/** Compact multi-line text for the SMS / USSD channel (<=160 chars per page). */
export function toTextBulletin(plan, maxPages = 4) {
  const best = plan.routes[0];
  const r = plan.request;
  const pages = [];

  pages.push(
    `NER LOGISTICS\n${r.origin.name}>${r.destination.name} ${r.tonnes}t\n` +
      `${best.modeLabel} ${best.totals.distanceKm}km\nETA ${best.totals.etaText}\nRs${best.totals.costPerTonneInr}/t`,
  );
  pages.push(
    `RISK ${Math.round((1 - best.reliability.arrivalProbability) * 100)}%\n` +
      (best.reliability.worstLink ? `Worst: ${best.reliability.worstLink.label} (${best.reliability.worstLink.band})\n` : '') +
      `ACCESS ${best.accessibility.score}/100`,
  );
  const steps = best.segments
    .map((s, i) => `${i + 1}.${s.from.id}>${s.to.id} ${s.mode[0].toUpperCase()} ${s.km}km`)
    .join('\n');
  pages.push(`ROUTE\n${steps}`);

  const barrier = best.accessibility.barriers[0];
  if (barrier) pages.push(`ALERT\n${barrier.where}: ${barrier.issue}`.slice(0, 155));
  if (plan.routes[1]) {
    const alt = plan.routes[1];
    pages.push(`ALT ${alt.modeLabel}\n${alt.totals.etaText} Rs${alt.totals.costPerTonneInr}/t\nrisk ${Math.round((1 - alt.reliability.arrivalProbability) * 100)}%`);
  }

  return pages.slice(0, maxPages).map((body, i, a) => ({
    page: i + 1,
    of: Math.min(a.length, maxPages),
    text: body,
    chars: body.length,
  }));
}
