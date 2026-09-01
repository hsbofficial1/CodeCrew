import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { Ruler, HeartPulse, CloudRain, Accessibility as AccIcon, Network, Signal } from 'lucide-react';
import { getJson } from '../lib/api';
import type { Settlement, StateRollup } from '../lib/types';
import { Card, StatTile, Empty, Spinner, Meter } from '../components/ui';
import { MapView, MapLegend, LegendDot } from '../components/MapView';
import { num, compactPop, accessColor, ACCESS_LEGEND } from '../lib/format';

const AXIS = { fontSize: 11, fill: '#8a93a3' };

const SUB_META: Record<string, { label: string; icon: typeof Ruler; hint: string }> = {
  lastMile: { label: 'Last-mile gap', icon: Ruler, hint: 'Distance beyond the motorable road head' },
  healthAccess: { label: 'Health access', icon: HeartPulse, hint: 'Distance to the nearest health facility' },
  allWeatherApproach: { label: 'All-weather approach', icon: CloudRain, hint: 'Reachable through the monsoon' },
  terminalAccess: { label: 'Terminal access', icon: AccIcon, hint: 'Ramp, step-free and assisted boarding' },
  networkConnectivity: { label: 'Network connectivity', icon: Network, hint: 'Corridor count, quality and mode mix' },
  digitalCoverage: { label: 'Digital coverage', icon: Signal, hint: 'Mobile data availability for the app itself' },
};

export function Atlas() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [states, setStates] = useState<StateRollup[]>([]);
  const [selected, setSelected] = useState<Settlement | null>(null);
  const [detail, setDetail] = useState<Settlement | null>(null);
  const [stateFilter, setStateFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getJson<{ settlements: Settlement[]; states: StateRollup[] }>('/accessibility').then((r) => {
      if (r.data) {
        setSettlements(r.data.settlements);
        setStates(r.data.states);
        setSelected(r.data.settlements[0] ?? null);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    getJson<Settlement>(`/accessibility/${selected.nodeId}`).then((r) => r.data && setDetail(r.data));
  }, [selected]);

  const filtered = useMemo(
    () => (stateFilter === 'all' ? settlements : settlements.filter((s) => s.state === stateFilter)),
    [settlements, stateFilter],
  );

  const points = useMemo(
    () =>
      settlements.map((s) => ({
        id: s.nodeId,
        lat: s.lat,
        lon: s.lon,
        color: accessColor(s.index),
        radius: s.nodeId === selected?.nodeId ? 9 : 4 + Math.min(4, s.populationServed / 120000),
        ring: s.nodeId === selected?.nodeId ? '#ffffff' : '#5b6879',
        popup: (
          <div>
            <strong>{s.name}</strong>, {s.state}
            <br />Accessibility index <strong>{s.index}/100</strong>
            <br />{s.grade}
            <br />Serves ~{compactPop(s.populationServed)} people
          </div>
        ),
      })),
    [settlements, selected],
  );

  const underserved = settlements.filter((s) => s.index < 50);
  const underservedPop = underserved.reduce((t, s) => t + s.populationServed, 0);

  if (loading) return <div className="h-full grid place-items-center"><Spinner label="Scoring settlements…" /></div>;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="Settlements scored" value={num(settlements.length)} hint="8 NE states plus gateway hubs" />
        <StatTile
          label="Under-served (index < 50)"
          value={num(underserved.length)}
          tone="var(--status-serious)"
          hint="Restricted access or worse"
        />
        <StatTile label="People affected" value={compactPop(underservedPop)} tone="var(--status-serious)" hint="Living in under-served settlements" />
        <StatTile
          label="Worst-served state"
          value={states[0]?.state ?? '—'}
          hint={states[0] ? `Population-weighted index ${states[0].populationWeightedIndex}/100` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-3">
        <Card
          title="Accessibility atlas"
          subtitle="Lighter marks are worse-served — index runs 0 (cut off) to 100 (fully accessible)"
          className="h-[480px]"
          bodyClass="!p-0"
        >
          <MapView points={points}>
            <MapLegend title="Accessibility index">
              {ACCESS_LEGEND.map((l) => <LegendDot key={l.label} color={l.color} label={l.label} />)}
            </MapLegend>
          </MapView>
        </Card>

        <Card
          title="Population-weighted index by state"
          subtitle="Weighted by the population each settlement serves"
          className="h-[480px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={states} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 4 }} barCategoryGap={4}>
              <CartesianGrid horizontal={false} stroke="#252c38" />
              <XAxis type="number" domain={[0, 100]} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="state" width={116} interval={0} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{ background: '#222834', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#fff' }}
                formatter={(v: number, _n, p) => {
                  const d = p.payload as StateRollup;
                  return [`${v}/100 · ${d.underservedCount} of ${d.settlements} under-served`, 'Index'];
                }}
              />
              <Bar dataKey="populationWeightedIndex" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {states.map((s) => <Cell key={s.state} fill={accessColor(s.populationWeightedIndex)} />)}
                <LabelList dataKey="populationWeightedIndex" position="right" style={{ fontSize: 11, fill: '#c3c2b7' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-3">
        <Card
          title="Settlement ranking"
          subtitle="Worst-served first — this is the queue for intervention"
          right={
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="rounded-md border px-2 py-1 text-[11px] outline-none"
              style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="all">All states</option>
              {states.map((s) => <option key={s.state} value={s.state}>{s.state}</option>)}
            </select>
          }
          className="max-h-[440px]"
          bodyClass="overflow-y-auto !p-0"
        >
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0" style={{ background: 'var(--surface-1)' }}>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-medium px-3 py-2">Settlement</th>
                <th className="text-left font-medium px-2 py-2">State</th>
                <th className="text-right font-medium px-2 py-2">Pop.</th>
                <th className="text-right font-medium px-2 py-2">Last mile</th>
                <th className="text-right font-medium px-3 py-2">Index</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.nodeId}
                  onClick={() => setSelected(s)}
                  className="cursor-pointer border-t"
                  style={{
                    borderColor: 'var(--border)',
                    background: s.nodeId === selected?.nodeId ? 'var(--surface-3)' : undefined,
                  }}
                >
                  <td className="px-3 py-1.5 font-medium">{s.name}</td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{s.state}</td>
                  <td className="px-2 py-1.5 text-right tabular" style={{ color: 'var(--text-muted)' }}>{compactPop(s.populationServed)}</td>
                  <td className="px-2 py-1.5 text-right tabular" style={{ color: 'var(--text-muted)' }}>{s.access.lastMileGapKm} km</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1.5 tabular font-semibold">
                      <span className="w-2 h-2 rounded-full" style={{ background: accessColor(s.index) }} aria-hidden />
                      {s.index}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title={detail ? `${detail.name}, ${detail.state}` : 'Settlement detail'}
          subtitle={detail ? `${detail.index}/100 · ${detail.grade}` : 'Select a settlement'}
          className="max-h-[440px]"
          bodyClass="overflow-y-auto"
        >
          {!detail ? (
            <Empty>Pick a settlement from the ranking or the map.</Empty>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2.5">
                {Object.entries(detail.subScores).map(([key, v]) => {
                  const meta = SUB_META[key];
                  if (!meta) return null;
                  const Icon = meta.icon;
                  return (
                    <div key={key}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon size={12} style={{ color: 'var(--text-muted)' }} />
                        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{meta.label}</span>
                        <span className="flex-1" />
                        <span className="text-[11px] tabular font-semibold">{v}</span>
                      </div>
                      <Meter value={v} color={accessColor(v)} />
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{meta.hint}</p>
                    </div>
                  );
                })}
              </div>

              <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <h3 className="text-[11px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Facilities</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
                  <Row label="Ramp access" value={detail.access.rampAccess} />
                  <Row label="Step-free" value={detail.access.stepFreeAccess} />
                  <Row label="Assisted boarding" value={detail.access.assistedBoarding} />
                  <Row label="All-weather approach" value={detail.access.allWeatherApproach} />
                  <Row label="Last-mile gap" value={`${detail.access.lastMileGapKm} km`} />
                  <Row label="Nearest health facility" value={`${detail.access.nearestHealthFacilityKm} km`} />
                  <Row label="Mobile coverage" value={detail.access.coverage.toUpperCase()} />
                  <Row label="Population served" value={compactPop(detail.populationServed)} />
                </dl>
              </div>

              {detail.corridors && detail.corridors.length > 0 && (
                <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <h3 className="text-[11px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                    Connecting corridors ({detail.corridors.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {detail.corridors.map((c, i) => (
                      <li key={i} className="text-[11.5px] flex items-baseline gap-2">
                        <span className="font-medium">{c.other}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{c.ref ?? c.mode}</span>
                        <span className="flex-1" />
                        <span className="tabular" style={{ color: 'var(--text-muted)' }}>{c.km} km</span>
                        {!c.allWeather && <span className="text-[10px]" style={{ color: 'var(--status-warning)' }}>seasonal</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: boolean | string }) {
  const isBool = typeof value === 'boolean';
  return (
    <>
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd
        className="text-right font-medium tabular"
        style={{ color: isBool ? (value ? 'var(--status-good)' : 'var(--status-serious)') : 'var(--text-primary)' }}
      >
        {isBool ? (value ? 'Yes' : 'No') : value}
      </dd>
    </>
  );
}
