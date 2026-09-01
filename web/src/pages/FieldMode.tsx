import { useEffect, useState } from 'react';
import { Signal, BatteryMedium, ChevronLeft, ChevronRight, WifiOff, Database } from 'lucide-react';
import type { AppContext } from '../App';
import { cachedPlanCount, getJson, postJson } from '../lib/api';
import type { NetNode, Plan } from '../lib/types';
import { Card, Field, Select, Spinner, StatTile } from '../components/ui';
import { num } from '../lib/format';

/**
 * The low-bandwidth channel.
 *
 * Most of the region this platform serves has 2G or no coverage at all, so the
 * same plan has to survive as ~160-character pages deliverable over SMS or a
 * USSD session. This screen renders exactly the payload the API returns for
 * that channel, on a feature-phone frame, with the byte count per page.
 */
export function FieldMode({ ctx }: { ctx: AppContext }) {
  const [nodes, setNodes] = useState<NetNode[]>([]);
  const [origin, setOrigin] = useState('GHY');
  const [destination, setDestination] = useState('AJL');
  const [profile, setProfile] = useState('relief_supplies');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(0);

  useEffect(() => {
    getJson<NetNode[]>('/nodes').then((r) => r.data && setNodes(r.data));
    setCached(cachedPlanCount());
  }, []);

  async function send() {
    setLoading(true);
    const res = await postJson<Plan>('/plan', {
      origin, destination, tonnes: 5, profile, alternatives: 1, scenario: ctx.scenario,
    });
    setLoading(false);
    setPage(0);
    setPlan(res.data);
    setCached(cachedPlanCount());
  }

  const bulletin = plan?.bulletin ?? [];
  const current = bulletin[page];
  const totalBytes = bulletin.reduce((t, b) => t + b.chars, 0);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="max-w-5xl mx-auto space-y-3">
        <Card
          title="Low-bandwidth field channel"
          subtitle="The same plan, reduced to SMS / USSD pages for 2G and no-coverage districts"
        >
          <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
            A dashboard is useless to a driver on the Kohima–Imphal road with one bar of 2G. The
            planner therefore emits a text bulletin alongside the rich response: numbered pages, each
            inside a single SMS, carrying the route, the risk, the accessibility score and the fallback.
            The same bytes work as a USSD menu response or a printed dispatch slip.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="From">
                  <Select value={origin} onChange={setOrigin}>
                    {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </Select>
                </Field>
                <Field label="To">
                  <Select value={destination} onChange={setDestination}>
                    {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Cargo profile">
                <Select value={profile} onChange={setProfile}>
                  {(ctx.meta?.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <button
                onClick={send}
                disabled={loading}
                className="w-full rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {loading ? <Spinner label="Sending…" /> : 'Request bulletin'}
              </button>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <StatTile label="Pages" value={num(bulletin.length)} hint="One SMS each" />
                <StatTile label="Total payload" value={num(totalBytes)} unit="bytes" hint="Whole plan, all pages" />
                <StatTile label="Cached plans" value={num(cached)} hint="Readable with no network" />
              </div>

              <div
                className="rounded-lg border px-3 py-2.5 text-[11.5px] flex items-start gap-2"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
              >
                {ctx.online ? <Database size={14} className="mt-px shrink-0" style={{ color: 'var(--accent)' }} />
                            : <WifiOff size={14} className="mt-px shrink-0" style={{ color: 'var(--status-serious)' }} />}
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>Offline-first.</strong>{' '}
                  Every plan and dataset is mirrored to local storage as it loads. Pull the network cable
                  and the app keeps serving the last good copy, labelled as cached — it does not show an
                  error page to someone standing at a road head.
                </span>
              </div>
            </div>

            {/* feature-phone frame */}
            <div className="mx-auto">
              <div
                className="rounded-[22px] border-4 p-2.5 w-[260px]"
                style={{ borderColor: '#2b323f', background: '#11151c' }}
              >
                <div className="rounded-[10px] p-3 h-[300px] flex flex-col" style={{ background: '#0c2318' }}>
                  <div
                    className="flex items-center justify-between text-[10px] pb-1.5 mb-2 border-b"
                    style={{ color: '#7dd3a0', borderColor: 'rgba(125,211,160,0.25)' }}
                  >
                    <span className="flex items-center gap-1"><Signal size={10} /> 2G</span>
                    <span>NER-LOGISTICS</span>
                    <BatteryMedium size={11} />
                  </div>

                  <pre
                    className="flex-1 text-[11.5px] leading-[1.55] whitespace-pre-wrap font-mono m-0 overflow-hidden"
                    style={{ color: '#8ef0b4' }}
                  >
{current ? current.text : 'No message.\n\nRequest a bulletin to\nsee the field payload.'}
                  </pre>

                  {current && (
                    <div
                      className="flex items-center justify-between text-[10px] pt-1.5 mt-2 border-t"
                      style={{ color: '#7dd3a0', borderColor: 'rgba(125,211,160,0.25)' }}
                    >
                      <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="disabled:opacity-30">
                        <ChevronLeft size={13} />
                      </button>
                      <span>{current.page}/{current.of} · {current.chars} ch</span>
                      <button
                        onClick={() => setPage((p) => Math.min(bulletin.length - 1, p + 1))}
                        disabled={page >= bulletin.length - 1}
                        className="disabled:opacity-30"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                Rendered from the API's own bulletin payload
              </p>
            </div>
          </div>
        </Card>

        {bulletin.length > 0 && (
          <Card title="Raw payload" subtitle="Exactly the bytes that would go over the air">
            <div className="space-y-2">
              {bulletin.map((b) => (
                <div key={b.page} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <div
                    className="px-2.5 py-1 text-[10px] flex justify-between"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
                  >
                    <span>SMS {b.page} of {b.of}</span>
                    <span className="tabular">{b.chars} characters {b.chars <= 160 ? '· fits one SMS' : '· splits'}</span>
                  </div>
                  <pre
                    className="px-2.5 py-2 text-[11.5px] font-mono whitespace-pre-wrap m-0"
                    style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
                  >{b.text}</pre>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
