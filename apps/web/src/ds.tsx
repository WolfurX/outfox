/**
 * Outfox design system — React bindings.
 *
 * Ported from the "Outfox Design System" project in Claude Design. The CSS contract
 * lives in components.css; these components only compose class names, so the visual
 * layer stays owned by the design system and the app never invents styling.
 *
 * Rules that live HERE because code is the only place they can be enforced:
 *  - The result of a Call PRINTS on the row that was acted on, at a CONSTANT duration
 *    (--dur-reveal, 280ms). No suspense build, no near-miss framing, no celebration
 *    escalation. (DESIGN-SYSTEM-WEB §8.2 — a predatory-design bound, not a style.)
 *  - Unsettled Scrip is ALWAYS marked by hatch + dashed underline + the word
 *    "Unsettled" — never by color alone (WCAG, and the firewall must be legible).
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';

const cx = (...parts: unknown[]) =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');

// ---------- Button ----------

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type BtnSize = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'secondary', size = 'md', full, iconOnly, children, className, ...rest
}: {
  variant?: BtnVariant; size?: BtnSize; full?: boolean; iconOnly?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx('ofx-btn', `ofx-btn--${variant}`, `ofx-btn--${size}`,
        full && 'ofx-btn--full', iconOnly && 'ofx-btn--icononly', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Chip / ProvenanceChip ----------

type ChipTone = 'neutral' | 'accent' | 'up' | 'down' | 'warn' | 'unsettled';

export function Chip({ tone = 'neutral', hatch, dashed, children }: {
  tone?: ChipTone; hatch?: boolean; dashed?: boolean; children: ReactNode;
}) {
  return (
    <span className={cx('ofx-chip', `ofx-chip--${tone}`, hatch && 'ofx-chip--hatch',
      dashed && 'ofx-chip--dashed')}>
      <span className="ofx-chip__mark" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * The provenance chip. Settled vs Unsettled is the load-bearing distinction in the
 * whole economy (chance-won value can never be traded or cashed out), so it is marked
 * three ways at once: a hatched swatch, a dashed underline, and the word itself.
 * Never remove one and rely on the others.
 */
export function ProvenanceChip({ provenance }: { provenance: 'settled' | 'unsettled' }) {
  return provenance === 'unsettled'
    ? <Chip tone="unsettled" hatch dashed>Unsettled</Chip>
    : <Chip tone="up">Settled</Chip>;
}

// ---------- Amount ----------

type AmountSize = 'sm' | 'md' | 'lg' | 'xl' | 'hero';
type AmountTone = 'default' | 'up' | 'down' | 'unsettled' | 'muted';

/** Money is exact and never decorated: no animated count-ups, no fake precision. */
export function Amount({ value, unit, size = 'md', tone = 'default', signed }: {
  value: number | string; unit?: string; size?: AmountSize; tone?: AmountTone; signed?: boolean;
}) {
  const n = typeof value === 'number' ? value : Number(value);
  const body = typeof value === 'string' && Number.isNaN(n)
    ? value
    : `${signed && n > 0 ? '+' : ''}${n.toLocaleString()}`;
  return (
    <span className={cx('ofx-amount', `ofx-amount--${size}`, tone !== 'default' && `ofx-amount--${tone}`)}>
      {body}
      {unit && <span className="ofx-amount__unit">{unit}</span>}
    </span>
  );
}

// ---------- Meter ----------

export function Meter({ label, value, max, tone = 'accent', segments = 20, icon }: {
  label: string; value: number; max: number;
  tone?: 'accent' | 'warn' | 'unsettled' | 'neutral'; segments?: number; icon?: ReactNode;
}) {
  const filled = max > 0 ? Math.round((Math.max(0, Math.min(value, max)) / max) * segments) : 0;
  return (
    <div className={cx('ofx-meter', `ofx-meter--${tone}`)}>
      <div className="ofx-meter__head">
        <span className="ofx-meter__label">{icon}{label}</span>
        <span className="ofx-meter__value">{Math.floor(value)}/{max}</span>
      </div>
      <div
        className="ofx-meter__track"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.floor(value)}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={cx('ofx-meter__seg', i < filled && 'ofx-meter__seg--on')} />
        ))}
      </div>
    </div>
  );
}

// ---------- Ruled sections + rows ----------

export function RowGroup({ title, capless, children }: {
  title?: string; capless?: boolean; children: ReactNode;
}) {
  return (
    <section>
      {title && <h2 className="ofx-rowgroup__title">{title}</h2>}
      <div className={cx('ofx-rowgroup', capless && 'ofx-rowgroup--capless')}>{children}</div>
    </section>
  );
}

export function ListRow({ lead, title, sub, trail, onPress, disabled }: {
  lead?: ReactNode; title: ReactNode; sub?: ReactNode; trail?: ReactNode;
  onPress?: () => void; disabled?: boolean;
}) {
  const inner = (
    <>
      {lead && <span className="ofx-row__lead">{lead}</span>}
      <span>
        <span className="ofx-row__title">{title}</span>
        {sub && <span className="ofx-row__sub" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <span className="ofx-row__trail">{trail}</span>
    </>
  );
  const cls = cx('ofx-row', lead && 'ofx-row--lead', onPress && 'ofx-row--press');
  return onPress
    ? <button type="button" className={cls} onClick={onPress} disabled={disabled}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

/** The outcome of a Call/Gig. Constant-duration print — see the file header. */
export function ActionResult({ kind, text, note }: {
  kind: 'clean' | 'nicked'; text: string; note?: string;
}) {
  return (
    <div className={cx('ofx-result', `ofx-result--${kind}`)} role="status">
      <span>{text}</span>
      {note && <span className="ofx-result__note">{note}</span>}
    </div>
  );
}

export function ActionRow({ title, desc, meta, action, result }: {
  title: ReactNode; desc?: ReactNode; meta?: ReactNode; action: ReactNode; result?: ReactNode;
}) {
  return (
    <div className="ofx-action">
      <div className="ofx-action__main">
        <div className="ofx-action__body">
          <div className="ofx-action__title">{title}</div>
          {desc && <div className="ofx-action__desc">{desc}</div>}
          {meta && <div className="ofx-action__meta">{meta}</div>}
        </div>
        {action}
      </div>
      {result}
    </div>
  );
}

/** A Call's stated chance, quoted like market depth — never as "odds". */
export function SplitBar({ successPct }: { successPct: number }) {
  const p = Math.max(0, Math.min(100, Math.round(successPct)));
  return (
    <div className="ofx-split">
      <div className="ofx-split__labels">
        <span>Clean <b>{p}%</b></span>
        <span><b>{100 - p}%</b> Nicked</span>
      </div>
      <div className="ofx-split__track" aria-hidden="true">
        <span className="ofx-split__l" style={{ flex: p || 0.001 }} />
        <span className="ofx-split__r" style={{ flex: (100 - p) || 0.001 }} />
      </div>
    </div>
  );
}

// ---------- Spark ----------

/** Sparkline from a number array. Static, 1.5px stroke, last-point dot. Data graphic,
 * not decoration. (Ported from the design system's charts/Spark.) */
export function Spark({ data, width = 120, height = 32, tone = 'auto', fill, ariaLabel }: {
  data: number[]; width?: number; height?: number;
  tone?: 'auto' | 'up' | 'down' | 'accent' | 'neutral'; fill?: boolean; ariaLabel?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i): [number, number] => [
    pad + (i / (data.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const t = tone === 'auto' ? (data[data.length - 1] >= data[0] ? 'up' : 'down') : tone;
  const color = t === 'up' ? 'var(--c-up)' : t === 'down' ? 'var(--c-down)'
    : t === 'accent' ? 'var(--c-accent)' : 'var(--c-text-2)';
  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={{ display: 'block', color }}
    >
      {fill && (
        <polygon
          points={`${pad},${height - pad} ${line} ${last[0].toFixed(1)},${height - pad}`}
          fill="currentColor" opacity="0.08"
        />
      )}
      <polyline
        points={line} fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
    </svg>
  );
}

// ---------- Navigation ----------

export interface TabDef { id: string; label: string; icon: ReactNode }

export function TabBar({ tabs, active, onSelect, rail }: {
  tabs: TabDef[]; active: string; onSelect: (id: string) => void; rail?: boolean;
}) {
  return (
    <nav className={rail ? 'ofx-navrail' : 'ofx-tabbar ofx-tabbar--fixed'} aria-label="Main">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={cx('ofx-tab', active === t.id && 'ofx-tab--active')}
          aria-current={active === t.id ? 'page' : undefined}
          onClick={() => onSelect(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </nav>
  );
}

// ---------- Sheet ----------

export function Sheet({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <>
      <div className="ofx-scrim" onClick={onClose} />
      <div className="ofx-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ofx-sheet__handle" />
        <div className="ofx-sheet__head">
          <span className="ofx-sheet__title">{title}</span>
        </div>
        <div className="ofx-sheet__body">{children}</div>
        {footer && <div className="ofx-sheet__foot">{footer}</div>}
      </div>
    </>
  );
}

// ---------- Feedback ----------

export function Banner({ tone = 'neutral', icon, title, children, action }: {
  tone?: 'neutral' | 'warn' | 'danger' | 'unsettled' | 'halted';
  icon?: ReactNode; title?: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={cx('ofx-banner', tone !== 'neutral' && `ofx-banner--${tone}`)} role="status">
      {icon && <span className="ofx-banner__icon">{icon}</span>}
      <div>
        {title && <div className="ofx-banner__title">{title}</div>}
        {children && <div className="ofx-banner__body">{children}</div>}
      </div>
      {action && <span className="ofx-banner__action">{action}</span>}
    </div>
  );
}

export function EmptyState({ icon, art, title, hint, action }: {
  /** `art` is an illustration path (decorative — the title carries the meaning) and
   * takes the icon's place; EmptyState is a sanctioned art slot (DESIGN-SYSTEM-WEB §6). */
  icon?: ReactNode; art?: string; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <div className="ofx-empty">
      {art
        ? <img className="ofx-empty__art" src={art} alt="" loading="lazy" decoding="async" />
        : icon && <span className="ofx-empty__icon">{icon}</span>}
      <span className="ofx-empty__title">{title}</span>
      {hint && <p className="ofx-empty__hint">{hint}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ width, height = 14 }: { width?: number | string; height?: number }) {
  return <span className="ofx-skel" style={{ display: 'block', width: width ?? '100%', height }} />;
}
