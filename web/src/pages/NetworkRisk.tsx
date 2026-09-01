import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { TriangleAlert, Ban, CornerUpRight, Plane } from 'lucide-react';
import type { AppContext } from '../App';
import { getJson } from '../lib/api';
import type { Alert, Corridor, Isolation, NetNode, Summary } from '../lib/types';
import { Card, StatTile, StatusChip, Empty, Spinner } from '../components/ui';
import { MapView, MapLegend, LegendDot, LegendSwatch } from '../components/MapView';
import {
  num, pct, compactPop, RISK_COLOR, RISK_LABEL, MODE_DASH, MODE_LABEL, MODE_COLOR,
} from '../lib/format';

const AXIS = { fontSize: 11, fill: '#8a93a3' };

export function NetworkRisk({ ctx }: { ctx: AppContext }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [network, setNetwork] = useState<{ nodes: NetNode[]; corridors: Corridor[] } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isolation, setIsolation] = useState<Isolation | null>(null);
  const [threshold, setThreshold] = useState(0.6);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = `?scenario=${ctx.scenario}`;
    Promise.all([
      getJson<Summary>(`/summary${q}`),
      getJson<{ nodes: NetNode[]; corridors: Corridor[] }>(`/network${q}`),
      getJson<{ alerts: Alert[] }>(`/alerts${q}`),
    ]).then(([s, n, a]) => {
      if (s.data) setSummary(s.data);
      if (n.data) setNetwork(n.data);
      if (a.data) setAlerts(a.data.alerts);
      setLoading(false);
    });
  }, [ctx.scenario]);

  useEffect(() => {
    getJson<Isolation>(`/isolation?scenario=${ctx.scenario}&threshold=${threshold}`)
      .then((r) => r.data && setIsolation(r.data));
  }, [ctx.scenario, threshold]);

  const lines = useMemo(
    () =>
      (network?.corridors ?? []).map((c) => ({
        id: c.id,
        coords: [[c.from.lat, c.from.lon], [c.to.lat, c.to.lon]] as [number, number][],
        color: RISK_COLOR[c.risk.band],
        weight: c.risk.band === 'severe' || c.risk.band === 'high' ? 3.5 : 2,
        opacity: c.risk.band === 'low' ? 0.5 : 0.95,
        dash: MODE_DASH[c.mode],
        popup: (
          <div>
            <strong>{c.name ?? `${c.from.name} – ${c.to.name}`}</strong>
            <br />{c.ref ?? ''} · {c.modeLabel} · {c.km} km
            <br />{RISK_LABEL[c.risk.band]} risk · {pct(c.risk.disruptionProbability)} disruption
            <br />3-day rain {c.risk.inputs.rain3DayMm} mm
            {!c.allWeather && <><br /><em>Not all-weather</em></>}
          </div>
        ),
      })),
    [network],
  );

  const cutOffIds = useMemo(() => new Set((isolation?.cutOff ?? []).map((c) => c.nodeId)), [isolation]);

  const points = useMemo(
    () =>
      (network?.nodes ?? []).map((n) => ({
        id: n.id,
        lat: n.lat,
        lon: n.lon,
        color: cutOffIds.has(n.id) ? '#d03b3b' : n.terminals.air ? '#c3c2b7' : '#4a5566',
        radius: cutOffIds.has(n.id) ? 6 : n.category === 'metro' || n.category === 'city' ? 4.5 : 3,
        popup: (
          <div>
            <strong>{n.name}</strong>, {n.state}
            <br />Serves ~{compactPop(n.populationServed)} people
            {n.weather && <><br />3-day rain {n.weather.rain3DayMm} mm</>}
            {cutOffIds.has(n.id) && <><br /><strong style={{ color: '#d03b3b' }}>Surface-cut off</strong></>}
          </div>
        ),
      })),
    [network, cutOffIds],
  );

  const stateChart = useMemo(
    () => (summary?.stateRisk ?? []).map((s) => ({ ...s, risk: Math.round(s.meanRisk * 100) })),
    [summary],
  );

  const modeChart = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.byMode).map(([mode, count]) => ({
      mode: MODE_LABEL[mode], count, fill: MODE_COLOR[mode],
    }));
  }, [summary]);

  if (loading && !summary) {
    return <div className="h-full grid place-items-center"><Spinner label="Assessing the network…" /></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatTile label="Corridors" value={num(summary?.corridors ?? 0)} hint={`${num(summary?.networkKm ?? 0)} km modelled`} />
        <StatTile label="Settlements" value={num(summary?.settlements ?? 0)} hint="Across 8 NE states + gateways" />
        <StatTile
          label="Mean disruption risk"
          value={pct(summary?.meanDisruptionRisk ?? 0)}
          tone={RISK_COLOR[bandOf(summary?.meanDisruptionRisk ?? 0)]}
          hint={`${RISK_LABEL[bandOf(summary?.meanDisruptionRisk ?? 0)]} network-wide`}
        />
        <StatTile
          label="Corridors at high risk"
          value={num((summary?.riskBands.high ?? 0) + (summary?.riskBands.severe ?? 0))}
          tone="var(--status-serious)"
          hint={`${summary?.riskBands.severe ?? 0} severe · ${summary?.riskBands.high ?? 0} high`}
        />
        <StatTile
          label="Settlements cut off"
          value={num(isolation?.cutOff.length ?? 0)}
          tone={isolation?.cutOff.length ? 'var(--status-critical)' : 'var(--status-good)'}
          hint="By surface modes (road / rail / water)"
        />
        <StatTile
          label="Population affected"
          value={compactPop(isolation?.cutOffPopulation ?? 0)}
          tone={isolation?.cutOffPopulation ? 'var(--status-critical)' : undefined}
          hint="In surface-cut-off settlements"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-3">
        <Card
          title="Corridor risk map"
          subtitle="Colour is current disruption risk; dash pattern is transport mode"
          className="h-[540px]"
          bodyClass="!p-0"
        >
          <MapView lines={lines} points={points}>
            <MapLegend title="Disruption risk">
              {(['severe', 'high', 'moderate', 'low'] as const).map((b) => (
                <LegendDot key={b} color={RISK_COLOR[b]} label={RISK_LABEL[b]} />
              ))}
              <div className="h-px my-1" style={{ background: 'var(--border)' }} />
              {Object.keys(MODE_DASH).map((m) => (
                <LegendSwatch key={m} color="var(--text-muted)" dash={MODE_DASH[m]} label={MODE_LABEL[m]} />
              ))}
            </MapLegend>
          </MapView>
        </Card>

        <div className="space-y-3">
          <Card
            title="Active alerts"
            subtitle="Generated from current conditions — nothing is hand-written"
            right={<StatusChip color={alerts.length ? 'var(--status-critical)' : 'var(--status-good)'} label={`${alerts.length}`} />}
            className="max-h-[268px]"
            bodyClass="overflow-y-auto"
          >
            {alerts.length === 0 ? (
              <Empty>No corridor currently exceeds the alert threshold. Try a scenario from the header to stress the network.</Empty>
            ) : (
              <ul className="space-y-2">
                {alerts.slice(0, 40).map((a) => (
                  <li key={a.id} className="rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                    <div className="flex items-start gap-2">
                      <TriangleAlert size={13} className="mt-0.5 shrink-0" style={{ color: a.severity === 'critical' ? 'var(--status-critical)' : 'var(--status-warning)' }} />
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-medium leading-snug">{a.headline}</p>
                        <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>{a.detail}</p>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{a.states.join(' · ')}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Mean corridor risk by state"
            subtitle="Share of corridors expected to be disrupted"
            className="h-[260px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stateChart} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 4 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} stroke="#252c38" />
                <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="state"
                  width={116}
                  interval={0}
                  tick={{ ...AXIS, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#222834', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#fff' }}
                  formatter={(v: number, _n, p) => [`${v}% — ${RISK_LABEL[(p.payload as { band: string }).band]}`, 'Mean risk']}
                />
                <Bar dataKey="risk" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {stateChart.map((s) => <Cell key={s.state} fill={RISK_COLOR[s.band]} />)}
                  <LabelList dataKey="risk" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fill: '#c3c2b7' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      {/* isolation analysis */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_400px] gap-3">
        <Card
          title="Who gets stranded"
          subtitle={`Settlements unreachable from ${isolation?.hubName ?? 'the hub'} by road, rail or water when corridors above the threshold are treated as cut`}
          right={
            <label className="flex items-center gap-2 text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
              cut at {pct(threshold)}
              <input
                type="range" min={0.2} max={0.9} step={0.05} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-24"
              />
            </label>
          }
          className="max-h-[330px]"
          bodyClass="overflow-y-auto"
        >
          {!isolation?.cutOff.length ? (
            <Empty>Every settlement is still reachable over surface modes at this threshold.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {isolation.cutOff.map((c) => (
                <li key={c.nodeId} className="flex items-center gap-2 text-[11.5px]">
                  <Ban size={12} className="shrink-0" style={{ color: 'var(--status-critical)' }} />
                  <span className="font-medium">{c.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{c.state}</span>
                  <span className="flex-1" />
                  {c.hasAirport && (
                    <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--accent)' }}>
                      <Plane size={10} /> air only
                    </span>
                  )}
                  <span className="tabular" style={{ color: 'var(--text-muted)' }}>{compactPop(c.populationServed)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Forced detours"
          subtitle="Still reachable, but only the long way round"
          className="max-h-[330px]"
          bodyClass="overflow-y-auto"
        >
          {!isolation?.atRisk.length ? (
            <Empty>No settlement faces a detour longer than 40 km at this threshold.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {isolation.atRisk.map((c) => (
                <li key={c.nodeId} className="flex items-center gap-2 text-[11.5px]">
                  <CornerUpRight size={12} className="shrink-0" style={{ color: 'var(--status-warning)' }} />
                  <span className="font-medium">{c.name}</span>
                  <span className="flex-1" />
                  <span className="tabular" style={{ color: 'var(--text-muted)' }}>
                    {num(c.normalKm)} → {num(c.degradedKm)} km
                  </span>
                  <span className="tabular font-medium" style={{ color: 'var(--status-warning)' }}>+{num(c.detourKm)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Network composition" subtitle="Corridors by transport mode" className="h-[330px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={modeChart} margin={{ top: 16, right: 8, bottom: 0, left: -18 }} barCategoryGap={10}>
              <CartesianGrid vertical={false} stroke="#252c38" />
              <XAxis dataKey="mode" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{ background: '#222834', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v} corridors`, '']}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {modeChart.map((m) => <Cell key={m.mode} fill={m.fill} />)}
                <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: '#c3c2b7' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function bandOf(p: number) {
  if (p >= 0.7) return 'severe';
  if (p >= 0.45) return 'high';
  if (p >= 0.22) return 'moderate';
  return 'low';
}
