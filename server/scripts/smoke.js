/**
 * End-to-end smoke test. Runs the real engines - no mocks - and asserts the
 * properties that must hold for the platform to be trustworthy. Run with
 * `npm run smoke` (no server needed).
 */
import assert from 'node:assert/strict';
import { validateNetwork } from '../src/services/graph.js';
import { trainRiskModel } from '../src/services/risk.js';
import { planRoute, PROFILES } from '../src/services/routing.js';
import { networkSummary, generateAlerts, isolationRisk } from '../src/services/alerts.js';
import { allSettlementIndices, stateAccessibilityRollup } from '../src/services/accessibility.js';
import { toTextBulletin, explainRoute } from '../src/services/explain.js';
import { NODES } from '../src/data/nodes.js';
import { EDGES } from '../src/data/edges.js';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

console.log('\nNetwork');
check('every corridor joins known nodes with the right terminals', () => {
  assert.deepEqual(validateNetwork(), []);
});
check('covers all eight NE states', () => {
  const states = new Set(NODES.map((n) => n.state));
  for (const s of ['Assam', 'Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura']) {
    assert.ok(states.has(s), `missing ${s}`);
  }
});
check('carries all four transport modes', () => {
  const modes = new Set(EDGES.map((e) => e.mode));
  assert.deepEqual([...modes].sort(), ['air', 'rail', 'road', 'water']);
});

console.log('\nModel');
const card = trainRiskModel();
check('classifier beats chance by a clear margin on held-out data', () => {
  assert.ok(card.heldOut.rocAuc > 0.75, `ROC-AUC ${card.heldOut.rocAuc}`);
});
check('learns that rain matters most on unstable slopes', () => {
  assert.ok(
    card.weights.landslide_x_rain > card.weights.flood_susceptibility,
    'landslide-rain interaction should outweigh a bare flood prior',
  );
});

console.log('\nRouting');
const base = planRoute({ origin: 'GHY', destination: 'IMF', tonnes: 12, alternatives: 2 });
check('returns a ranked, recommended routing', () => {
  assert.ok(base.routes.length >= 1);
  assert.equal(base.routes[0].recommended, true);
  assert.equal(base.routes[0].rank, 1);
});
check('no routing revisits a settlement', () => {
  for (const r of base.routes) {
    const visited = [r.segments[0].from.id, ...r.segments.map((s) => s.to.id)];
    assert.equal(new Set(visited).size, visited.length, `${r.id} revisits a node`);
  }
});
check('legs are contiguous from origin to destination', () => {
  for (const r of base.routes) {
    assert.equal(r.segments[0].from.id, base.request.origin.id);
    assert.equal(r.segments.at(-1).to.id, base.request.destination.id);
    for (let i = 1; i < r.segments.length; i++) {
      assert.equal(r.segments[i].from.id, r.segments[i - 1].to.id);
    }
  }
});
check('totals equal the sum of the legs', () => {
  for (const r of base.routes) {
    const km = r.segments.reduce((s, x) => s + x.km, 0);
    assert.equal(Math.round(km), r.totals.distanceKm);
    const legCost = r.legs.reduce((s, x) => s + x.costInr, 0);
    assert.ok(Math.abs(legCost - r.totals.costInr) <= r.legs.length + 1, 'cost drift');
  }
});
check('arrival probability is the product of link survivals', () => {
  for (const r of base.routes) {
    const p = r.segments.reduce((acc, s) => acc * (1 - Math.min(s.risk.disruptionProbability, 0.985)), 1);
    assert.ok(Math.abs(p - r.reliability.arrivalProbability) < 0.02, 'reliability mismatch');
  }
});
check('every cargo profile plans successfully', () => {
  for (const profile of Object.keys(PROFILES)) {
    const p = planRoute({ origin: 'GHY', destination: 'IMF', tonnes: 12, profile, alternatives: 1 });
    assert.ok(p.routes.length >= 1, `${profile} produced nothing`);
  }
});
check('bulk freight is cheaper per tonne than emergency medical', () => {
  const bulk = planRoute({ origin: 'GHY', destination: 'IMF', tonnes: 20, profile: 'bulk_freight', alternatives: 0 });
  const med = planRoute({ origin: 'GHY', destination: 'IMF', tonnes: 20, profile: 'emergency_medical', alternatives: 0 });
  assert.ok(
    bulk.routes[0].totals.costPerTonneInr < med.routes[0].totals.costPerTonneInr,
    'profiles are not differentiating on cost',
  );
});
check('emergency medical is not slower than bulk freight', () => {
  const bulk = planRoute({ origin: 'GHY', destination: 'IMF', tonnes: 20, profile: 'bulk_freight', alternatives: 0 });
  const med = planRoute({ origin: 'GHY', destination: 'IMF', tonnes: 20, profile: 'emergency_medical', alternatives: 0 });
  assert.ok(med.routes[0].totals.hours <= bulk.routes[0].totals.hours);
});
check('rejects an unknown destination', () => {
  assert.throws(() => planRoute({ origin: 'GHY', destination: 'NOPE' }), /Unknown destination/);
});
check('rejects a mode with no terminal at the origin', () => {
  assert.throws(() => planRoute({ origin: 'TAW', destination: 'GHY', modes: ['air'] }), /no terminal/);
});

console.log('\nScenarios');
check('a flood scenario raises network risk and strands settlements', () => {
  const calm = networkSummary(new Date(), 'live');
  const flood = networkSummary(new Date(), 'barak_flood');
  assert.ok(flood.meanDisruptionRisk > calm.meanDisruptionRisk, 'flood did not raise risk');
  const iso = isolationRisk(0.6, 'GHY', new Date(), 'barak_flood');
  assert.ok(iso.cutOff.length > 0, 'flood stranded nobody');
  assert.ok(iso.cutOff.some((c) => c.name === 'Silchar'), 'Silchar should be surface-cut off');
});
check('alerts are generated from conditions, not hard-coded', () => {
  assert.equal(generateAlerts(new Date(), 'dry_season').length, 0);
  assert.ok(generateAlerts(new Date(), 'monsoon_peak').length > 10);
});
check('a closed corridor is never recommended when a sound one exists', () => {
  const p = planRoute({ origin: 'GHY', destination: 'SCL', tonnes: 12, scenario: 'barak_flood', alternatives: 1 });
  assert.equal(p.degraded, false);
  assert.ok(p.routes[0].reliability.arrivalProbability > 0.4, 'recommended a route that will not arrive');
});
check('a genuinely cut-off pair degrades loudly instead of lying', () => {
  const p = planRoute({
    origin: 'GHY', destination: 'SCL', tonnes: 12,
    scenario: 'barak_flood', modes: ['road', 'rail', 'water'], alternatives: 0,
  });
  assert.equal(p.degraded, true);
  assert.match(p.degradedNote, /expects to be closed/);
});

console.log('\nAccessibility');
check('scores every settlement in 0-100', () => {
  const all = allSettlementIndices();
  assert.equal(all.length, NODES.length);
  for (const s of all) assert.ok(s.index >= 0 && s.index <= 100, `${s.name} out of range`);
});
check('ranks remote hill settlements below metros', () => {
  const all = allSettlementIndices();
  const mon = all.find((s) => s.name === 'Mon');
  const ghy = all.find((s) => s.name === 'Guwahati');
  assert.ok(mon.index < ghy.index - 30, 'remote settlement not penalised');
});
check('state roll-up covers every state and is ordered worst-first', () => {
  const roll = stateAccessibilityRollup();
  assert.ok(roll.length >= 8);
  for (let i = 1; i < roll.length; i++) {
    assert.ok(roll[i - 1].populationWeightedIndex <= roll[i].populationWeightedIndex);
  }
});
check('flags a bridge too weak for the consignment', () => {
  const p = planRoute({ origin: 'GHY', destination: 'TAW', tonnes: 40, vehicleGrossWeightT: 60, alternatives: 0 });
  const blocking = p.routes[0].accessibility.barriers.filter((b) => b.severity === 'blocking');
  assert.ok(blocking.length > 0, 'a 60 t vehicle crossed a light bridge unremarked');
});

console.log('\nExplanation & field channel');
check('explanation is grounded and non-trivial', () => {
  const lines = explainRoute(base.routes[0], base.request);
  assert.ok(lines.length >= 3);
  assert.ok(lines.join(' ').includes(String(base.routes[0].totals.distanceKm)), 'does not cite computed distance');
});
check('SMS pages fit inside a single message', () => {
  const pages = toTextBulletin(base);
  assert.ok(pages.length >= 3);
  for (const pg of pages) assert.ok(pg.chars <= 160, `page ${pg.page} is ${pg.chars} chars`);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' — WITH FAILURES' : ''}\n`);
