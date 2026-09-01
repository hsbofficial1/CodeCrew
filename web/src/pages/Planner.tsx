import { useEffect, useMemo, useState } from 'react';
import { Play, TriangleAlert, Info, Repeat, PackageOpen } from 'lucide-react';
import type { AppContext } from '../App';
import { getJson, postJson } from '../lib/api';
import type { NetNode, Plan, Route } from '../lib/types';
import {
  Card, Field, Select, NumberInput, Toggle, Empty, Spinner, StatusChip, Meter,
} from '../components/ui';
import { MapView, MapLegend, LegendSwatch, LegendDot } from '../components/MapView';
import {
  inr, num, pct, RISK_COLOR, RISK_LABEL, ROUTE_COLOR, MODE_DASH, MODE_LABEL,
} from '../lib/format';

const ALL_MODES = ['road', 'rail', 'water', 'air'];

export function Planner({ ctx }: { ctx: AppContext }) {
  const [nodes, setNodes] = useState<NetNode[]>([]);
  const [origin, setOrigin] = useState('GHY');
  const [destination, setDestination] = useState('IMF');
  const [tonnes, setTonnes] = useState(12);
  const [profile, setProfile] = useState('general');
  const [modes, setModes] = useState<string[]>(ALL_MODES);
  const [vehicleGrossWeightT, setVehicle] = useState(16);
  const [nightDeparture, setNight] = useState(false);
  const [needsStepFree, setStepFree] = useState(false);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    getJson<NetNode[]>('/nodes').then((r) => r.data && setNodes(r.data));
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await postJson<Plan>('/plan', {
      origin, destination, tonnes, profile, modes,
      alternatives: 2, vehicleGrossWeightT, nightDeparture, needsStepFree,
      scenario: ctx.scenario,
    });
    setLoading(false);
    setStale(res.state === 'cached');
    if (res.data) {
      setPlan(res.data);
      setSelected(res.data.routes[0]?.id ?? null);
      if (res.state === 'cached') setError(`Offline - showing a cached plan from ${new Date(res.cachedAt!).toLocaleString()}`);
    } else {
      setPlan(null);
      setError(res.error);
    }
  }

  // Re-plan whenever the scenario changes, so the header control is live.
  useEffect(() => {
    if (plan) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.scenario]);

  const grouped = useMemo(() => {
    const byState: Record<string, NetNode[]> = {};
    for (const n of nodes) (byState[n.state] ??= []).push(n);
    return Object.entries(byState).sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);

  const active = plan?.routes.find((r) => r.id === selected) ?? plan?.routes[0] ?? null;
  const explanation = plan?.explanations.find((e) => e.routeId === active?.id);

  const lines = useMemo(() => {
    if (!plan) return [];
    return plan.routes.flatMap((r, i) =>
      r.geometry.map((g, j) => ({
        id: `${r.id}-${j}`,
        coords: g.coords as [number, number][],
        color: ROUTE_COLOR[i % ROUTE_COLOR.length],
        weight: r.id === active?.id ? 4.5 : 2,
        opacity: r.id === active?.id ? 0.95 : 0.35,
        dash: MODE_DASH[g.mode],
        popup: (
          <div>
            <strong>{r.id} · {g.label}</strong>
            <br />{MODE_LABEL[g.mode]} · {RISK_LABEL[g.band]} risk ({pct(g.risk)})
          </div>
        ),
      })),
    );
  }, [plan, active]);

  const points = useMemo(() => {
    if (!active) return [];
    const seen = new Set<string>();
    const out = [];
    for (const s of active.segments) {
      for (const n of [s.from, s.to]) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        const isEnd = n.id === plan?.request.origin.id || n.id === plan?.request.destination.id;
        out.push({
          id: n.id, lat: n.lat, lon: n.lon,
          color: isEnd ? '#ffffff' : 'var(--surface-3)',
          radius: isEnd ? 7 : 4,
          popup: <strong>{n.name}</strong>,
        });
      }
    }
    return out;
  }, [active, plan]);

  const fitTo = useMemo(() => {
    if (!active?.segments.length) return null;
    const lats = active.segments.flatMap((s) => [s.from.lat, s.to.lat]);
    const lons = active.segments.flatMap((s) => [s.from.lon, s.to.lon]);
    return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]] as [[number, number], [number, number]];
  }, [active]);

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[300px_1fr_380px] gap-3 p-3 overflow-hidden">
      {/* ------------------------------------------------------- request form */}
      <div className="overflow-y-auto min-h-0 space-y-3">
        <Card title="Consignment" subtitle="What is moving, and what matters about it">
          <div className="space-y-3">
            <Field label="Origin">
              <Select value={origin} onChange={setOrigin}>
                {grouped.map(([state, list]) => (
                  <optgroup key={state} label={state}>
                    {list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Destination">
              <Select value={destination} onChange={setDestination}>
                {grouped.map(([state, list]) => (
                  <optgroup key={state} label={state}>
                    {list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Payload"><NumberInput value={tonnes} onChange={setTonnes} min={0.1} max={5000} suffix="t" /></Field>
              <Field label="Vehicle GVW" hint="Checked against bridge load class">
                <NumberInput value={vehicleGrossWeightT} onChange={setVehicle} min={1} max={120} suffix="t" />
              </Field>
            </div>
            <Field label="Cargo profile" hint={ctx.meta?.profiles.find((p) => p.id === profile)?.description}>
              <Select value={profile} onChange={setProfile}>
                {(ctx.meta?.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Modes available" subtitle="Terminals must exist at both ends of a leg">
          <div className="space-y-2">
            {ALL_MODES.map((m) => (
              <Toggle
                key={m}
                checked={modes.includes(m)}
                label={MODE_LABEL[m]}
                onChange={(on) => setModes((prev) => (on ? [...prev, m] : prev.filter((x) => x !== m)))}
              />
            ))}
          </div>
        </Card>

        <Card title="Accessibility requirements">
          <div className="space-y-2.5">
            <Toggle checked={needsStepFree} onChange={setStepFree} label="Needs step-free handling" />
            <Toggle checked={nightDeparture} onChange={setNight} label="Night departure" />
          </div>
        </Card>

        <button
          onClick={run}
          disabled={loading || modes.length === 0}
          className="w-full rounded-lg px-3 py-2.5 text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {loading ? <Spinner label="Planning…" /> : <><Play size={14} /> Plan route</>}
        </button>
        {modes.length === 0 && (
          <p className="text-[11px]" style={{ color: 'var(--status-warning)' }}>Select at least one mode.</p>
        )}
      </div>

      {/* ------------------------------------------------------------ the map */}
      <Card
        className="min-h-0"
        bodyClass="!p-0"
        title="Routing"
        subtitle={plan ? `${plan.request.origin.name} → ${plan.request.destination.name} · ${plan.request.tonnes} t · ${plan.request.profileLabel}` : 'Set a consignment and plan a route'}
        right={
          stale ? <StatusChip color="var(--status-serious)" label="Cached" /> : null
        }
      >
        <div className="h-full relative">
          <MapView lines={lines} points={points} fitTo={fitTo}>
            {plan && (
              <MapLegend title="Routes & modes">
                {plan.routes.map((r, i) => (
                  <LegendDot key={r.id} color={ROUTE_COLOR[i % ROUTE_COLOR.length]} label={`${r.id} ${r.modeLabel}`} />
                ))}
                <div className="h-px my-1" style={{ background: 'var(--border)' }} />
                {ALL_MODES.map((m) => (
                  <LegendSwatch key={m} color="var(--text-muted)" dash={MODE_DASH[m]} label={MODE_LABEL[m]} />
                ))}
              </MapLegend>
            )}
          </MapView>
          {!plan && !loading && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <p className="text-[12px] px-4 py-2 rounded-lg" style={{ background: 'rgba(26,31,40,0.9)', color: 'var(--text-muted)' }}>
                Plan a route to see it on the network.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* -------------------------------------------------------- the results */}
      <div className="overflow-y-auto min-h-0 space-y-3">
        {error && (
          <div
            className="rounded-lg border px-3 py-2 text-[12px] flex items-start gap-2"
            style={{ borderColor: 'var(--border)', background: 'rgba(208, 59, 59, 0.12)', color: 'var(--text-secondary)' }}
          >
            <TriangleAlert size={14} style={{ color: 'var(--status-critical)' }} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {plan?.degraded && plan.degradedNote && (
          <div
            className="rounded-lg border px-3 py-2.5 text-[12px] flex items-start gap-2 leading-relaxed"
            style={{ borderColor: 'var(--status-critical)', background: 'rgba(208, 59, 59, 0.12)', color: 'var(--text-secondary)' }}
          >
            <TriangleAlert size={14} style={{ color: 'var(--status-critical)' }} className="mt-px shrink-0" />
            <span>
              <strong style={{ color: 'var(--text-primary)' }}>No sound routing exists.</strong>{' '}
              {plan.degradedNote}
            </span>
          </div>
        )}

        {!plan && !error && <Card><Empty>Results appear here: ranked routings, why the top one won, and what would stop it.</Empty></Card>}

        {plan?.routes.map((r, i) => (
          <RouteCard
            key={r.id}
            route={r}
            color={ROUTE_COLOR[i % ROUTE_COLOR.length]}
            active={r.id === active?.id}
            onSelect={() => setSelected(r.id)}
          />
        ))}

        {explanation && (
          <Card title="Why this routing" subtitle="Every clause is derived from a computed value">
            <ul className="space-y-2">
              {explanation.lines.map((l, i) => (
                <li key={i} className="text-[12px] leading-relaxed flex gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)' }} aria-hidden>▸</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {plan && plan.comparison.length > 0 && (
          <Card title="Trade-offs" subtitle="How each alternative differs from the recommendation">
            <div className="space-y-2.5">
              {plan.comparison.map((c) => (
                <div key={c.routeId}>
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{c.summary}</p>
                  <p className="text-[11px] mt-0.5 flex gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Info size={12} className="mt-px shrink-0" />{c.preferWhen}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {active && active.accessibility.barriers.length > 0 && (
          <Card
            title="Accessibility barriers"
            subtitle={`${active.accessibility.score}/100 · ${active.accessibility.grade}`}
          >
            <div className="space-y-2.5">
              {active.accessibility.barriers.map((b, i) => (
                <div key={i} className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <StatusChip
                      color={b.severity === 'blocking' ? 'var(--status-critical)' : b.severity === 'major' ? 'var(--status-serious)' : 'var(--status-warning)'}
                      label={b.severity === 'blocking' ? 'Blocking' : b.severity === 'major' ? 'Major' : 'Minor'}
                    />
                    <span className="text-[11.5px] font-medium truncate">{b.where}</span>
                  </div>
                  <p className="text-[11.5px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{b.issue}</p>
                  <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>→ {b.mitigation}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {active && <Itinerary route={active} />}
      </div>
    </div>
  );
}

function RouteCard({ route: r, color, active, onSelect }: { route: Route; color: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-xl border overflow-hidden transition-all"
      style={{
        background: 'var(--surface-1)',
        borderColor: active ? color : 'var(--border)',
        boxShadow: active ? `0 0 0 1px ${color}` : 'none',
      }}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />
          <span className="text-[13px] font-semibold">{r.id}</span>
          {r.recommended && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
              style={{ background: 'var(--accent)', color: '#fff' }}>Recommended</span>
          )}
          <span className="text-[11.5px] truncate" style={{ color: 'var(--text-muted)' }}>{r.modeLabel}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-2.5">
          <Metric label="ETA" value={r.totals.etaText} />
          <Metric label="Cost" value={inr(r.totals.costInr)} />
          <Metric label="Distance" value={`${num(r.totals.distanceKm)} km`} />
          <Metric label="CO₂" value={`${num(r.totals.co2Kg)} kg`} />
        </div>

        <div className="space-y-1.5">
          <Meter
            value={r.reliability.arrivalProbability * 100}
            color={RISK_COLOR[r.reliability.band] ?? 'var(--accent)'}
            label="Arrives undisrupted"
            valueText={pct(r.reliability.arrivalProbability)}
          />
          <Meter
            value={r.accessibility.score}
            color="var(--accent)"
            label="Accessibility"
            valueText={`${r.accessibility.score}/100`}
          />
        </div>

        {r.reliability.worstLink && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <StatusChip
              color={RISK_COLOR[r.reliability.worstLink.band]}
              label={`${RISK_LABEL[r.reliability.worstLink.band]} risk`}
              sub={r.reliability.worstLink.label}
            />
            {r.transshipments > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                <Repeat size={11} />{r.transshipments} transship
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-[12.5px] font-semibold tabular mt-0.5">{value}</div>
    </div>
  );
}

function Itinerary({ route }: { route: Route }) {
  return (
    <Card title="Itinerary" subtitle={`${route.segments.length} legs · ${route.totals.etaText} door to door, handling included`}>
      <ol className="space-y-2">
        {route.legs.map((leg, i) => {
          if (leg.kind === 'handling') {
            return (
              <li key={i} className="flex gap-2.5 text-[11.5px]">
                <span className="w-5 shrink-0 grid place-items-center" style={{ color: 'var(--text-muted)' }}>
                  <PackageOpen size={13} />
                </span>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>{leg.label}</div>
                  <div style={{ color: 'var(--text-muted)' }} className="tabular">
                    +{leg.hours} h handling · {inr(leg.costInr)}
                  </div>
                </div>
              </li>
            );
          }
          if (leg.kind === 'transfer') {
            return (
              <li key={i} className="flex gap-2.5 text-[11.5px]">
                <span className="w-5 shrink-0 grid place-items-center" style={{ color: 'var(--text-muted)' }}>
                  <Repeat size={13} />
                </span>
                <div>
                  <div style={{ color: 'var(--text-secondary)' }}>{leg.label}</div>
                  <div style={{ color: 'var(--text-muted)' }} className="tabular">
                    +{leg.hours} h handling · {inr(leg.costInr)}
                  </div>
                </div>
              </li>
            );
          }
          const legNumber = route.legs.slice(0, i + 1).filter((l) => l.kind === 'travel').length;
          return (
            <li key={i} className="flex gap-2.5 text-[11.5px]">
              <span
                className="w-5 h-5 shrink-0 rounded grid place-items-center text-[10px] font-semibold tabular"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}
              >
                {legNumber}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium truncate">{leg.label}</span>
                  <span className="tabular shrink-0" style={{ color: 'var(--text-muted)' }}>{leg.km} km</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span style={{ color: 'var(--text-muted)' }}>
                    {leg.ref ?? MODE_LABEL[leg.mode]} · {leg.hours} h @ {leg.effectiveSpeedKmph} km/h
                  </span>
                  <StatusChip color={RISK_COLOR[leg.risk.band]} label={RISK_LABEL[leg.risk.band]} sub={pct(leg.risk.disruptionProbability)} />
                  {!leg.allWeather && (
                    <span className="text-[10px]" style={{ color: 'var(--status-warning)' }}>not all-weather</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
