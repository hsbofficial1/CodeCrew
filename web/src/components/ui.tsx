import type { ReactNode, CSSProperties } from 'react';

export function Card({
  title, subtitle, right, children, className = '', bodyClass = '',
}: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode;
  children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section
      className={`rounded-xl border overflow-hidden flex flex-col ${className}`}
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      {(title || right) && (
        <header
          className="flex items-start justify-between gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-wide">{title}</h2>}
            {subtitle && (
              <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={`p-4 flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function StatTile({
  label, value, unit, hint, tone,
}: {
  label: string; value: ReactNode; unit?: string; hint?: string; tone?: string;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold leading-none" style={{ color: tone ?? 'var(--text-primary)' }}>
          {value}
        </span>
        {unit && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      {hint && (
        <div className="text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>{hint}</div>
      )}
    </div>
  );
}

/** A status colour is never shown alone - the label always travels with it. */
export function StatusChip({ color, label, sub }: { color: string; label: string; sub?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden />
      <span>{label}</span>
      {sub && <span style={{ color: 'var(--text-muted)' }}>{sub}</span>}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
      {hint && <span className="text-[10px] mt-1 block" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}

const controlStyle: CSSProperties = {
  background: 'var(--surface-3)',
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
};

export function Select({
  value, onChange, children, className = '',
}: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 ${className}`}
      style={{ ...controlStyle, '--tw-ring-color': 'var(--accent)' } as CSSProperties}
    >
      {children}
    </select>
  );
}

export function NumberInput({
  value, onChange, min, max, step = 1, suffix,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px] tabular outline-none focus:ring-2"
        style={{ ...controlStyle, '--tw-ring-color': 'var(--accent)' } as CSSProperties}
      />
      {suffix && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none"
          style={{ color: 'var(--text-muted)' }}>{suffix}</span>
      )}
    </div>
  );
}

export function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-[12px] w-full text-left"
      aria-pressed={checked}
    >
      <span
        className="w-8 h-[18px] rounded-full relative transition-colors shrink-0 border"
        style={{
          background: checked ? 'var(--accent)' : 'var(--surface-3)',
          borderColor: checked ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <span
          className="absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white transition-all"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
      <span style={{ color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="h-full grid place-items-center text-center px-6 py-10">
      <p className="text-[12px] max-w-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{children}</p>
    </div>
  );
}

export function Spinner({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
      <span
        className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin inline-block"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
      {label}
    </div>
  );
}

/** A horizontal magnitude bar with a 4px rounded data-end anchored at zero. */
export function Meter({
  value, max = 100, color, label, valueText,
}: { value: number; max?: number; color: string; label?: string; valueText?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="w-full">
      {(label || valueText) && (
        <div className="flex items-baseline justify-between mb-1">
          {label && <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>}
          {valueText && <span className="text-[11px] tabular" style={{ color: 'var(--text-secondary)' }}>{valueText}</span>}
        </div>
      )}
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--grid)' }}>
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}
