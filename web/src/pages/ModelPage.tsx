import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { getJson } from '../lib/api';
import type { ModelCard } from '../lib/types';
import { Card, StatTile, Spinner } from '../components/ui';
import { num } from '../lib/format';

const AXIS = { fontSize: 11, fill: '#8a93a3' };

/**
 * The honesty page. A judge or an operator should be able to see exactly what
 * the "AI" is, what it was fitted on, and how well it actually does - including
 * the parts that are synthesised for the demo.
 */
export function ModelPage() {
  const [card, setCard] = useState<ModelCard | null>(null);

  useEffect(() => {
    getJson<ModelCard>('/model').then((r) => r.data && setCard(r.data));
  }, []);

  if (!card) return <div className="h-full grid place-items-center"><Spinner label="Loading model card…" /></div>;

  const weights = card.features
    .map((f) => ({ feature: f.replace(/_/g, ' '), weight: card.weights[f] }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatTile label="Held-out ROC-AUC" value={card.heldOut.rocAuc.toFixed(3)} hint="Ranking quality, 0.5 = chance" />
          <StatTile label="Held-out accuracy" value={card.heldOut.accuracy.toFixed(3)} hint={`Base rate ${card.heldOut.positiveRate.toFixed(3)}`} />
          <StatTile label="Training records" value={num(card.samples.train)} hint={`${num(card.samples.test)} held out`} />
          <StatTile label="Fit time" value={num(card.trainingMs)} unit="ms" hint="Refitted on every server start" />
        </div>

        <Card title={card.name} subtitle={card.kind}>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The platform combines two independent estimates of corridor disruption. A{' '}
            <strong style={{ color: 'var(--text-primary)' }}>physical rainfall-threshold model</strong>{' '}
            compares 24-hour and 3-day rainfall against a critical line that falls as a corridor's own
            landslide susceptibility rises — the same antecedent-accumulation logic regional landslide
            early-warning systems use. A{' '}
            <strong style={{ color: 'var(--text-primary)' }}>learned classifier</strong>, the logistic
            regression described here, is fitted at start-up on the bundled historical record. The final
            risk is a 45/55 blend, and both components are reported separately on every corridor so the
            number can be argued with rather than taken on faith.
          </p>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 items-stretch">
          <Card
            title="Learned feature weights"
            subtitle="Standardised coefficients — larger means more influence on predicted disruption"
            className="min-h-[340px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weights} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 4 }} barCategoryGap={3}>
                <CartesianGrid horizontal={false} stroke="#252c38" />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="feature" width={150} tick={AXIS} axisLine={false} tickLine={false} />
                <ReferenceLine x={0} stroke="#333c4a" />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#222834', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#fff' }}
                  formatter={(v: number) => [v.toFixed(4), 'Coefficient']}
                />
                <Bar dataKey="weight" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {weights.map((w) => <Cell key={w.feature} fill={w.weight >= 0 ? '#3987e5' : '#d95926'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Held-out metrics" subtitle="20% stride split across every corridor">
            <dl className="space-y-2 text-[12px]">
              {([
                ['ROC-AUC', card.heldOut.rocAuc, 'Probability a disrupted case outranks an undisrupted one'],
                ['Accuracy', card.heldOut.accuracy, 'At the 0.5 decision threshold'],
                ['Precision', card.heldOut.precision, 'Of predicted disruptions, how many were real'],
                ['Recall', card.heldOut.recall, 'Of real disruptions, how many were caught at 0.5'],
                ['Base rate', card.heldOut.positiveRate, 'Share of records that were disruptions'],
                ['Train log-loss', card.finalTrainLogLoss, 'Final objective value'],
              ] as const).map(([label, value, hint]) => (
                <div key={label} className="border-b pb-2 last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex justify-between items-baseline">
                    <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
                    <dd className="tabular font-semibold">{Number(value).toFixed(4)}</dd>
                  </div>
                  <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{hint}</p>
                </div>
              ))}
            </dl>
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Recall at the 0.5 threshold is low because disruptions are the minority class. The platform
              never uses that hard decision — it consumes the probability directly, where ranking quality
              (ROC-AUC) is the metric that matters.
            </p>
          </Card>
        </div>

        <Card title="Data provenance" subtitle="What is real, and what is synthesised for the demo">
          <div className="space-y-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <Provenance
              tone="var(--status-good)"
              label="Real"
              items={[
                'Settlement coordinates, elevations and state assignments for 59 places across the eight NE states plus the Siliguri and Kolkata gateways.',
                'Corridor topology: National Highway numbers and routings, the NF Railway network, NW-2 (Brahmaputra) and NW-16 (Barak) waterways, and scheduled + UDAN-RCS air sectors.',
                'Live weather — current and forecast precipitation for every node from the Open-Meteo API, refreshed every 15 minutes, with a climatology fallback when offline.',
                'Mode economics: indicative freight rates, average speeds and CO₂ intensity per tonne-km by mode.',
              ]}
            />
            <Provenance
              tone="var(--status-warning)"
              label="Demo layer"
              items={[
                'Per-corridor landslide and flood susceptibility priors, pavement condition, bridge load class and gradient — plausible and internally consistent, not an official survey.',
                'Settlement accessibility attributes (ramp, step-free, assisted boarding, last-mile gap, nearest health facility, coverage).',
                'The historical disruption record the classifier is fitted on, synthesised from NE-India monsoon climatology and the corridor priors above. Swapping in real NHAI / NDMA / state-PWD incident data means replacing one file.',
              ]}
            />
            <p className="pt-1" style={{ color: 'var(--text-muted)' }}>{card.trainingData}</p>
            <p style={{ color: 'var(--text-muted)' }}>
              The route explanations are generated by a grounded template engine, not a language model:
              every clause is derived from a computed value, so the system cannot state something the
              data does not support — and it runs with no network and no inference cost.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Provenance({ tone, label, items }: { tone: string; label: string; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: tone }} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <ul className="space-y-1 pl-3.5">
        {items.map((it, i) => (
          <li key={i} className="list-disc list-outside">{it}</li>
        ))}
      </ul>
    </div>
  );
}
