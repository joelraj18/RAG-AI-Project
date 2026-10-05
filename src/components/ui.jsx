import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';

// Shared UI primitives in a clean, store-like design language: gray canvas, white
// rounded cards with soft shadows, pill buttons, two-tone headlines and card shelves.

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', className, icon: Icon, children, ...p }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-500 disabled:bg-slate-300 dark:disabled:bg-slate-700',
    secondary: 'bg-slate-100 text-ink hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700',
    outline: 'text-brand-700 ring-1 ring-brand-600 hover:bg-brand-600 hover:text-white dark:text-brand-400 dark:ring-brand-400',
    ghost: 'text-brand-700 hover:underline dark:text-brand-400',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
  }[variant];
  const s = { sm: 'h-8 px-3.5 text-xs gap-1.5', md: 'h-9 px-4 text-sm gap-2', lg: 'h-11 px-6 text-[15px] gap-2' }[size];
  return (
    <button
      className={cx('inline-flex items-center justify-center rounded-full font-normal whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50', v, s, className)}
      {...p}
    >
      {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  );
}

export function Card({ className, hover, children, ...p }) {
  return (
    <div
      className={cx(
        'rounded-[18px] bg-white shadow-card dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-800',
        hover && 'transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover',
        className
      )}
      {...p}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, right }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
      <div className="flex items-start gap-3">
        {Icon && <Icon className="mt-1 h-5 w-5 text-slate-500" />}
        <div>
          <h3 className="headline text-xl">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Large page title on the left, tagline and links on the right. */
export function PageHeader({ title, tagline, links, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6 pt-10 pb-8 md:pt-14 md:pb-12">
      <h1 className="headline text-5xl md:text-[80px] md:leading-none">{title}</h1>
      {(tagline || links) && (
        <div className="max-w-sm text-left md:text-right">
          {tagline && <p className="headline text-2xl leading-tight md:text-[28px]">{tagline}</p>}
          {links && <div className="mt-3 flex flex-col gap-1.5 text-[15px] md:items-end">{links}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** "Bold part. Gray continuation." section title. */
export function SectionTitle({ title, sub, right, className }) {
  return (
    <div className={cx('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <h2 className="headline text-2xl md:text-[28px]">
        {title} {sub && <span className="text-slate-500 dark:text-slate-400">{sub}</span>}
      </h2>
      {right}
    </div>
  );
}

export function LinkButton({ children, className, ...p }) {
  return (
    <button type="button" className={cx('inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-400', className)} {...p}>
      {children}
    </button>
  );
}

/** Horizontal, snap-scrolling shelf of cards with previous/next arrows. */
export function Shelf({ children, className }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update, children]);
  const go = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  const arrow = 'absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200/80 text-slate-700 backdrop-blur transition hover:bg-slate-300 md:flex dark:bg-slate-700/80 dark:text-slate-100';
  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className={cx('shelf -mx-4 scroll-px-4 px-4 pt-1', className)}>
        {children}
      </div>
      {!edge.start && (
        <button className={cx(arrow, 'left-0')} onClick={() => go(-1)} aria-label="Scroll left">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {!edge.end && (
        <button className={cx(arrow, 'right-0')} onClick={() => go(1)} aria-label="Scroll right">
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

const BADGE = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  red: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  blue: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
};

export function Badge({ color = 'slate', className, children, ...p }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', BADGE[color], className)} {...p}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="headline mt-0.5 text-xl tabular-nums">{value}</div>
      {hint && <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

export function Progress({ value, className, color = 'bg-brand-600' }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800', className)} role="progressbar" aria-valuenow={Math.round((value || 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-[26px] w-[44px] shrink-0 rounded-full transition', checked ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700')}
      >
        <span className={cx('absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all', checked ? 'left-[20px]' : 'left-[2px]')} />
      </button>
      <button type="button" className="text-left" onClick={() => onChange(!checked)}>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </button>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink dark:text-slate-100">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15 dark:border-slate-700 dark:bg-slate-900';

/** 1–5 (or percentage) score ring. */
export function ScoreRing({ score, max = 5, label, size = 64, sub }) {
  const pct = score == null ? 0 : score / max;
  const color = score == null ? '#86868b' : pct >= 0.9 ? '#30d158' : pct >= 0.7 ? '#0a84ff' : pct >= 0.5 ? '#ff9f0a' : '#ff453a';
  const r = size / 2 - 5;
  const C = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${label}: ${score == null ? 'not available' : max === 5 ? `${score} of 5` : `${Math.round(score)}%`}`}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="5" className="fill-none stroke-slate-100 dark:stroke-slate-800" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="5" fill="none" stroke={color} strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} className="transition-all duration-700" />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="rotate-90 fill-ink text-sm font-semibold dark:fill-slate-50" style={{ transformOrigin: 'center' }}>
          {score == null ? '–' : max === 5 ? score.toFixed(score % 1 ? 1 : 0) : `${Math.round(score)}%`}
        </text>
      </svg>
      <div className="text-center text-xs font-medium text-ink dark:text-slate-200">{label}</div>
      {sub && <div className="-mt-1 text-center text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    panel.current?.focus();
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[22px] bg-white shadow-2xl outline-none dark:bg-slate-900', wide ? 'max-w-5xl' : 'max-w-xl')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="headline text-lg">{title}</h3>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {Icon && <Icon className="mb-5 h-12 w-12 text-slate-400" strokeWidth={1.25} />}
      <h3 className="headline text-3xl">{title}</h3>
      <div className="mt-3 max-w-md text-[15px] text-slate-500 dark:text-slate-400">{children}</div>
    </div>
  );
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- in-app dialogs & toasts (replace window.confirm / prompt / alert) ----------

const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [value, setValue] = useState('');

  const open = useCallback(
    (kind, opts) =>
      new Promise((resolve) => {
        setValue(opts.defaultValue || '');
        setDlg({ kind, ...opts, resolve });
      }),
    []
  );
  const api = {
    confirm: useCallback((message, opts = {}) => open('confirm', { message, ...opts }), [open]),
    prompt: useCallback((message, opts = {}) => open('prompt', { message, ...opts }), [open]),
    toast: useCallback((message, tone = 'ok') => {
      const id = Math.random();
      setToasts((t) => [...t, { id, message, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
    }, []),
  };
  const close = (result) => {
    dlg?.resolve(result);
    setDlg(null);
  };

  return (
    <DialogCtx.Provider value={api}>
      {children}
      <Modal open={!!dlg} onClose={() => close(dlg?.kind === 'prompt' ? null : false)} title={dlg?.title || (dlg?.kind === 'prompt' ? 'Enter a name' : 'Are you sure?')}>
        {dlg && (
          <form
            className="space-y-4 px-6 pb-6"
            onSubmit={(e) => {
              e.preventDefault();
              close(dlg.kind === 'prompt' ? value.trim() || null : true);
            }}
          >
            <p className="text-[15px] text-slate-600 dark:text-slate-300">{dlg.message}</p>
            {dlg.kind === 'prompt' && <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} aria-label={dlg.message} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => close(dlg.kind === 'prompt' ? null : false)}>
                Cancel
              </Button>
              <Button type="submit" variant={dlg.danger ? 'danger' : 'primary'} autoFocus={dlg.kind !== 'prompt'}>
                {dlg.confirmLabel || (dlg.kind === 'prompt' ? 'Save' : 'Continue')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2.5 text-sm shadow-card-hover">
            {t.tone === 'error' ? <AlertCircle className="h-4 w-4 text-rose-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {t.message}
          </div>
        ))}
      </div>
    </DialogCtx.Provider>
  );
}

// ---------- trade-off guidance ----------

export const TAGS = {
  recommended: { label: 'Recommended', icon: '⭐', color: 'brand' },
  fastest: { label: 'Fastest', icon: '⚡', color: 'blue' },
  lightest: { label: 'Lightest', icon: '💾', color: 'slate' },
  quality: { label: 'Best quality', icon: '🎯', color: 'violet' },
  private: { label: 'Private', icon: '🔒', color: 'green' },
};

export function TagBadges({ tags = [] }) {
  return tags.map((t) => (
    <Badge key={t} color={TAGS[t]?.color}>
      {TAGS[t]?.icon} {TAGS[t]?.label}
    </Badge>
  ));
}

/** Selectable card that explains what an option costs and why to pick it. */
export function OptionCard({ selected, onClick, title, tags, why, cost, disabled, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'flex h-full w-full flex-col items-start gap-1.5 rounded-[18px] p-4 text-left text-sm transition disabled:opacity-50',
        selected
          ? 'bg-white ring-2 ring-brand-600 dark:bg-slate-900 dark:ring-brand-400'
          : 'bg-white ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-700 dark:hover:ring-slate-500'
      )}
    >
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <span className="mr-auto text-[15px] font-semibold">{title}</span>
        <TagBadges tags={tags} />
      </div>
      {why && <span className="text-[13px] leading-snug text-slate-600 dark:text-slate-400">{why}</span>}
      {cost && <span className="text-xs text-slate-500">{cost}</span>}
      {children}
    </button>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'rounded-full px-3.5 py-1.5 text-xs font-medium transition',
            value === t.id ? 'bg-white text-ink shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 28, max }) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return <span className="text-xs text-slate-400">–</span>;
  const top = max ?? Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * width},${height - (x / (top || 1)) * (height - 4) - 2}`).join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="2" className="stroke-brand-600" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
