import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Route as RouteIcon, AlertTriangle, Accessibility, Smartphone, Brain,
  Wifi, WifiOff, CloudRain, Database,
} from 'lucide-react';
import { getJson } from './lib/api';
import type { Meta, WeatherStatus } from './lib/types';
import { Planner } from './pages/Planner';
import { NetworkRisk } from './pages/NetworkRisk';
import { Atlas } from './pages/Atlas';
import { FieldMode } from './pages/FieldMode';
import { ModelPage } from './pages/ModelPage';

const TABS = [
  { id: 'planner', label: 'Route Planner', icon: RouteIcon },
  { id: 'risk', label: 'Network Risk', icon: AlertTriangle },
  { id: 'atlas', label: 'Accessibility Atlas', icon: Accessibility },
  { id: 'field', label: 'Field Mode', icon: Smartphone },
  { id: 'model', label: 'Model & Data', icon: Brain },
] as const;

type TabId = (typeof TABS)[number]['id'];

export interface AppContext {
  scenario: string;
  meta: Meta | null;
  online: boolean;
}

export default function App() {
  const [tab, setTab] = useState<TabId>('planner');
  const [scenario, setScenario] = useState('live');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [weather, setWeather] = useState<WeatherStatus | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    getJson<Meta>('/meta').then((r) => r.data && setMeta(r.data));
  }, []);

  const pollHealth = useCallback(() => {
    getJson<{ weather: WeatherStatus }>('/health').then((r) => {
      if (r.data) setWeather(r.data.weather);
      setOnline(r.state === 'live' && navigator.onLine);
    });
  }, []);

  useEffect(() => {
    pollHealth();
    const t = setInterval(pollHealth, 60_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [pollHealth]);

  const activeScenario = useMemo(
    () => meta?.scenarios.find((s) => s.id === scenario) ?? null,
    [meta, scenario],
  );

  const ctx: AppContext = { scenario, meta, online };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--plane)' }}>
      <header className="border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
        <div className="px-4 py-2.5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg grid place-items-center shrink-0 font-bold text-[13px]"
              style={{ background: 'var(--accent)', color: '#fff' }}
              aria-hidden
            >
              NE
            </div>
            <div className="min-w-0">
              <h1 className="text-[13px] font-semibold leading-tight truncate">
                NER Smart Logistics &amp; Accessibility Intelligence
              </h1>
              <p className="text-[10.5px] leading-tight truncate" style={{ color: 'var(--text-muted)' }}>
                MDoNER · Smart India Hackathon 2026 · SIH26002 · Team CodeCrew
              </p>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Scenario
              </span>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="rounded-md border px-2 py-1 text-[12px] outline-none"
                style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {(meta?.scenarios ?? [{ id: 'live', label: 'Live conditions' }]).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>

            <StatusPill
              icon={weather?.source === 'live' ? <CloudRain size={12} /> : <Database size={12} />}
              label={weather?.source === 'live' ? 'Live weather' : 'Climatology'}
              tone={weather?.source === 'live' ? 'var(--status-good)' : 'var(--status-warning)'}
              title={
                weather
                  ? `${weather.provider}${weather.fetchedAt ? ` · fetched ${new Date(weather.fetchedAt).toLocaleTimeString()}` : ''}${weather.lastError ? ` · ${weather.lastError}` : ''}`
                  : undefined
              }
            />
            <StatusPill
              icon={online ? <Wifi size={12} /> : <WifiOff size={12} />}
              label={online ? 'Online' : 'Offline · cached'}
              tone={online ? 'var(--status-good)' : 'var(--status-serious)'}
            />
          </div>
        </div>

        {activeScenario && scenario !== 'live' && (
          <div
            className="px-4 py-1.5 text-[11.5px] border-t flex items-start gap-2"
            style={{ borderColor: 'var(--border)', background: 'rgba(250, 178, 25, 0.10)' }}
          >
            <AlertTriangle size={13} style={{ color: 'var(--status-warning)' }} className="mt-px shrink-0" />
            <span style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Scenario: {activeScenario.label}.</strong>{' '}
              {activeScenario.description} Rainfall inputs are overridden; every risk, routing and
              accessibility figure below is recomputed by the same models.
            </span>
          </div>
        )}

        <nav className="px-2 flex gap-0.5 overflow-x-auto" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className="px-3 py-2 text-[12px] font-medium flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors"
                style={{
                  borderColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        {tab === 'planner' && <Planner ctx={ctx} />}
        {tab === 'risk' && <NetworkRisk ctx={ctx} />}
        {tab === 'atlas' && <Atlas />}
        {tab === 'field' && <FieldMode ctx={ctx} />}
        {tab === 'model' && <ModelPage />}
      </main>
    </div>
  );
}

function StatusPill({
  icon, label, tone, title,
}: { icon: React.ReactNode; label: string; tone: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
    >
      <span style={{ color: tone }} className="flex">{icon}</span>
      {label}
    </span>
  );
}
