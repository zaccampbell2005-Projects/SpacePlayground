import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Panel({
  title,
  icon,
  onClose,
  children,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass animate-float-in pointer-events-auto flex flex-col ${className}`}>
      <header className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          {icon && <span className="text-neon-cyan">{icon}</span>}
          <h2 className="font-display text-sm font-bold tracking-wide">{title}</h2>
        </div>
        {onClose && (
          <button aria-label={`Close ${title}`} onClick={onClose} className="rounded-md p-1 text-muted-foreground transition hover:text-foreground">
            <X size={14} />
          </button>
        )}
      </header>
      <div className="panel-scroll flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="readout text-[11px]">{display ?? value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className="cosmic-range"
        style={{ ["--fill" as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 py-1.5 text-left">
      <span>
        <span className="block text-[12px] font-semibold">{label}</span>
        {hint && <span className="block text-[10.5px] text-muted-foreground">{hint}</span>}
      </span>
      <span className="switch" data-on={on} role="switch" aria-checked={on} />
    </button>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between py-1.5">
      <span className="label-mono">{label}</span>
      <span className="flex items-center gap-2">
        <span className="readout text-[11px] text-muted-foreground">{value}</span>
        <input type="color" className="color-well" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "cyan" | "pink" | "amber" }) {
  const toneClass = tone === "cyan" ? "text-neon-cyan" : tone === "pink" ? "text-neon-pink" : tone === "amber" ? "text-neon-amber" : "";
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="label-mono">{label}</span>
      <span className={`readout ${toneClass}`}>{value}</span>
    </div>
  );
}

export function fmt(n: number, d = 2) {
  if (!isFinite(n)) return "∞";
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return n.toExponential(2);
  return n.toFixed(d);
}
