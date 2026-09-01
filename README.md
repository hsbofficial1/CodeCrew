# NER Smart Logistics & Accessibility Intelligence Platform

**Smart India Hackathon 2026 · Problem statement SIH26002 · Team CodeCrew**
Ministry of Development of North Eastern Region (MDoNER)

A working MVP of a multimodal logistics and accessibility platform for the eight
North Eastern states. It plans road / rail / inland-waterway / air-cargo movements
across a real corridor network, scores every corridor for landslide and flood
disruption risk against **live weather**, scores every route and settlement for
**physical accessibility**, and explains each recommendation in terms of the
numbers it actually computed.

---

## Quick start

```bash
npm install
npm run dev
```

- Web UI — http://localhost:5173
- API — http://localhost:5174/api/health

Single-process build (API serves the built SPA):

```bash
npm run build && npm start   # http://localhost:5174
```

Run the end-to-end checks (no server required):

```bash
npm run smoke
```

No API keys, no database, no external services beyond the free
[Open-Meteo](https://open-meteo.com) forecast API — and the platform degrades to
monsoon climatology when that is unreachable, so it runs fully offline.

---

## What it does

### 1. Route Planner
Plans a consignment across a **59-node, 114-corridor multimodal network**. The
search runs Dijkstra over an expanded `(settlement, mode)` graph — so switching
road to rail at Dimapur costs the real handling time and money, and is only
possible because Dimapur actually has a rail terminal — and **Yen's k-shortest-paths**
produces genuinely distinct alternatives rather than cosmetic variants.

One scalar objective, five normalised terms — time, cost, reliability, emissions,
accessibility — re-weighted per cargo profile. A medical consignment and a cement
consignment take different roads because the objective differs, not because the
labels do.

Reliability enters as `-ln(1 - p)`, the only additive form whose path total
corresponds to the real quantity: the probability the whole routing survives is
the product of its links' survival probabilities.

### 2. Network Risk
Live risk for every corridor, alerts generated from current conditions (nothing
hand-written), mean risk by state, and a **reachability analysis**: treat every
corridor above a threshold as cut, then ask which settlements can no longer be
reached over surface modes, and how far the detours run for those that can.

Air is excluded from that analysis by default, deliberately — relief consignments
and routine resupply move over surface modes, and an air bridge that exists on
paper hides exactly the isolation the view is meant to expose.

### 3. Accessibility Atlas
A 0–100 index for every settlement over six auditable sub-scores: last-mile gap,
distance to the nearest health facility, all-weather approach, terminal
accessibility (ramp / step-free / assisted boarding), network connectivity and
mobile coverage. Rolled up per state, population-weighted, worst-served first —
the queue for intervention.

Route-level accessibility additionally checks the consignment against physical
reality: bridge load class against vehicle gross weight, sustained gradients,
night-travel safety, and step-free handling where it is required. Each barrier
comes with a severity and a mitigation.

### 4. Field Mode
The same plan reduced to **SMS / USSD pages under 160 characters**, rendered on a
feature-phone frame with the byte count per page. Much of this region is 2G or no
coverage; a dashboard is useless to a driver on the Kohima–Imphal road. Every
response is also mirrored to local storage, so the app keeps serving the last good
copy when the network is gone — labelled as cached, never an error page.

### 5. Model & Data
The honesty page: what the model is, what it was fitted on, how well it does on
held-out data, and which parts of the dataset are real versus synthesised.

### Scenarios
The header scenario control substitutes rainfall inputs and re-runs the same
models — a genuine stress test, not a scripted demo. Scenarios are drawn from
documented events: the June 2022 Barak valley floods (which cut Silchar off by
road and rail), the October 2023 South Lhonak outburst flood in Sikkim, and
typical July peak-monsoon accumulation.

---

## How risk is computed

Two independent estimators, blended 45/55 and **both reported separately** on
every corridor, so the number can be argued with rather than taken on faith:

**Physical — rainfall threshold.** Regional landslide early-warning systems
trigger on antecedent accumulation rather than instantaneous intensity. 24-hour
and 3-day rainfall are compared against a critical line that falls as the
corridor's own susceptibility rises, and the exceedance ratio is mapped through a
logistic curve. Flooding uses basin accumulation with a relief factor — water
pools on the Brahmaputra valley floor and drains off above ~600 m.

**Learned — logistic regression.** An L2-regularised classifier trained by batch
gradient descent at every server start, on the bundled historical record. It is
genuinely fitted, not handed its coefficients: it recovers the landslide×rainfall
interaction, terrain class and all-weather status as the dominant signals, and
scores **ROC-AUC ≈ 0.83** on a held-out 20% split. Weights and metrics are served
at `/api/model` and shown in the UI.

Above a 97% disruption probability a corridor is treated as **closed**, not merely
expensive — otherwise a cheap road the model has just predicted is washed out can
still out-score a sound one on price. If gating leaves no route at all, the
planner re-runs ungated and flags the answer as least-bad rather than pretending.

---

## Data provenance

Stated plainly, because a demo that blurs this is worth less than one that doesn't.

**Real**
- Settlement coordinates, elevations and states — 59 places across the eight NE
  states plus the Siliguri corridor and the Kolkata/Haldia gateway.
- Corridor topology: National Highway numbers and routings (NH-27, NH-2, NH-6,
  NH-10, NH-13, NH-306, NH-54 …), the NF Railway network including the
  Lumding–Badarpur hill section, NW-2 (Brahmaputra) and NW-16 (Barak) waterways,
  and scheduled + UDAN-RCS air sectors.
- Live weather — current and forecast precipitation for all 59 nodes from
  Open-Meteo, refreshed every 15 minutes, with a climatology fallback.
- Mode economics — indicative freight rates, average speeds and CO₂ intensity per
  tonne-km by mode.

**Demo layer** (plausible, internally consistent, not an official survey)
- Per-corridor landslide/flood susceptibility priors, pavement condition, bridge
  load class, gradient and night-travel safety.
- Settlement accessibility attributes (ramp, step-free, assisted boarding,
  last-mile gap, nearest health facility, mobile coverage).
- The historical disruption record the classifier is fitted on — synthesised from
  NE-India monsoon climatology and the corridor priors above, because open
  per-corridor incident data is not publicly downloadable. Swapping in real
  NHAI / NDMA / state-PWD records means replacing `server/src/data/history.js`.

**Not implemented** (in the concept deck, out of scope for this MVP)
- Reinforcement learning. The planner is a deterministic multi-objective shortest
  path; calling that RL would be a lie. RL would be the natural upgrade once real
  outcome data exists to learn from.
- Live sensor, satellite and vehicle-telematics ingestion.
- The route explanations come from a grounded template engine, not a language
  model — every clause is derived from a computed value, so the system cannot
  state something the data does not support, and it runs offline at zero cost.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness, weather source, model summary |
| `GET` | `/api/meta` | States, modes, cargo profiles, scenarios |
| `GET` | `/api/nodes` | All settlements |
| `GET` | `/api/network?scenario=` | Nodes + corridors with current risk |
| `GET` | `/api/summary?scenario=` | Headline network statistics |
| `GET` | `/api/alerts?scenario=` | Condition-derived alerts |
| `GET` | `/api/isolation?scenario=&threshold=&hub=&modes=` | Who gets stranded |
| `POST` | `/api/plan` | Plan a shipment (see below) |
| `GET` | `/api/accessibility` | Settlement indices + state roll-up |
| `GET` | `/api/accessibility/:nodeId` | One settlement in detail |
| `GET` | `/api/model` | Model card: weights, metrics, provenance |
| `GET` | `/api/weather?scenario=` | Per-node weather |

```bash
curl -X POST localhost:5174/api/plan -H 'content-type: application/json' -d '{
  "origin": "GHY", "destination": "IMF", "tonnes": 12,
  "profile": "emergency_medical", "alternatives": 2,
  "vehicleGrossWeightT": 16, "needsStepFree": true,
  "scenario": "barak_flood"
}'
```

Cargo profiles: `general`, `emergency_medical`, `perishable`, `bulk_freight`,
`relief_supplies`, `low_emission`.
Scenarios: `live`, `monsoon_peak`, `barak_flood`, `sikkim_cloudburst`,
`arunachal_landslides`, `dry_season`.

---

## Layout

```
server/
  src/
    data/      nodes.js  edges.js  history.js        the network and its history
    services/  graph.js       (Dijkstra, Yen k-shortest, mode-expanded graph)
               routing.js     (multi-objective planning and scoring)
               risk.js        (rainfall-threshold + learned classifier)
               logreg.js      (the classifier itself)
               accessibility.js
               alerts.js  scenarios.js  weather.js  explain.js  geo.js
    routes/api.js
  scripts/smoke.js                                   25 end-to-end checks
web/
  src/pages/   Planner  NetworkRisk  Atlas  FieldMode  ModelPage
  src/lib/     api.ts (offline-first cache)  format.ts (palette)  types.ts
```

## Stack

Node + Express (no build step, ES modules) · React 18 + TypeScript + Vite +
Tailwind v4 · Leaflet/OpenStreetMap · Recharts. The routing, risk and
accessibility engines are dependency-free and written to be read.

Chart colours are validated rather than eyeballed: risk uses a reserved status
palette and never appears without its label; route identity uses a categorical
set that clears the all-pairs colour-vision-deficiency gate; transport mode is
carried by **dash pattern** on maps because no four-hue set clears that gate.
