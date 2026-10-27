'use client';

import * as React from 'react';
import { Factory, Package, PackageCheck, Scissors, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The manufacturing motion canvas on the sign-in screen.
 *
 * An abstract picture of how work moves through the business — production,
 * material, cutting, quality, finished goods — not a dashboard. It carries no
 * numbers at all, so nothing here can be mistaken for live figures.
 *
 * Sequence: the stage tiles land (staggered), the connectors draw between
 * them, then a small light pulse travels the route, each tile brightening as
 * it arrives; the composition rests and the pulse runs again every ten
 * seconds. Pulses are native SVG motion along the same paths the connectors
 * draw, so they cannot drift off the lines. Everything else is transform and
 * opacity.
 *
 * It pauses when scrolled away or when the tab is hidden, and it is static
 * for anyone who has asked for reduced motion.
 */

// Coordinates in the SVG's own 600 × 520 space. Tiles are positioned in the
// same space as percentages, so lines and tiles stay aligned at any size.
const W = 600;
const H = 520;

const STAGES = [
  { key: 'production', name: 'Production', icon: Factory, colour: 'var(--chart-release)', x: 128, y: 130 },
  { key: 'material', name: 'Material', icon: Package, colour: 'var(--chart-issue)', x: 352, y: 74 },
  { key: 'cutting', name: 'Cutting', icon: Scissors, colour: 'var(--chart-cutting)', x: 492, y: 236 },
  { key: 'quality', name: 'Quality', icon: ShieldCheck, colour: 'var(--chart-qc)', x: 334, y: 382 },
  { key: 'finished', name: 'Finished goods', icon: PackageCheck, colour: 'var(--chart-completed)', x: 122, y: 412 },
] as const;

// Gentle curves between consecutive stages.
const PATHS = [
  'M128,130 C196,70 270,58 352,74',
  'M352,74 C440,92 492,150 492,236',
  'M492,236 C492,318 420,370 334,382',
  'M334,382 C262,392 176,380 122,412',
];

/** Seconds: when the travelling pulse starts, and how long each leg takes. */
const PULSE_START = 2.4;
const LEG = 0.9;
const CYCLE = 10;

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function ManufacturingCanvas({ simplified = false }: { simplified?: boolean }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  const uid = React.useId().replace(/:/g, '');
  const [paused, setPaused] = React.useState(false);

  // Pause purely decorative motion when nobody can see it.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let visible = true;
    const apply = () => {
      const stop = !visible || document.visibilityState === 'hidden';
      setPaused(stop);
      const svg = svgRef.current;
      if (svg) (stop ? svg.pauseAnimations() : svg.unpauseAnimations());
    };
    const io = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; apply(); });
    io.observe(el);
    document.addEventListener('visibilitychange', apply);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', apply); };
  }, []);

  return (
    <div ref={rootRef} data-paused={paused} className="relative mx-auto aspect-[600/520] w-full max-w-[640px]">
      {/* Decorative glass panes floating behind the network. */}
      {!simplified ? (
        <>
          {/* An abstract interface fragment: a header, three bars in stage
              colours and a soft curve. Shapes only — no figures. */}
          <div
            aria-hidden="true"
            className="login-float absolute left-[4%] top-[50%] h-[27%] w-[34%] overflow-hidden rounded-[20px] border border-[var(--glass-border)] bg-[var(--login-tile)] p-[3.2%] opacity-80 shadow-[inset_0_1px_0_var(--glass-highlight),0_18px_40px_-20px_var(--glass-shadow)]"
            style={{ animationDelay: '-2s' }}
          >
            <span className="login-sweep" />
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--chart-release)]" />
              <span className="h-1.5 w-[34%] rounded-full bg-ink/15" />
            </div>
            <div className="mt-[9%] space-y-[6%]">
              {[['var(--chart-release)', '78%'], ['var(--chart-cutting)', '56%'], ['var(--chart-completed)', '68%']].map(([c, w], i) => (
                <div key={i} className="h-1.5 rounded-full bg-ink/8">
                  <div className="h-full rounded-full" style={{ width: w, background: `color-mix(in srgb, ${c} 70%, transparent)` }} />
                </div>
              ))}
            </div>
          </div>
          <div
            aria-hidden="true"
            className="login-float absolute right-[1%] top-[2%] h-[20%] w-[27%] overflow-hidden rounded-[18px] border border-[var(--glass-border)] bg-[var(--login-tile)] p-[2.6%] opacity-70 shadow-[inset_0_1px_0_var(--glass-highlight)]"
            style={{ animationDelay: '-5s' }}
          >
            <span className="h-1.5 w-[42%] rounded-full bg-ink/15 block" />
            <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="mt-[10%] h-[52%] w-full">
              <path d="M0,28 C14,26 22,14 36,16 S60,30 72,18 S90,6 100,8" fill="none" stroke="var(--login-accent-2)" strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.8" />
            </svg>
          </div>
        </>
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          {PATHS.map((_, i) => {
            const a = STAGES[i]!;
            const b = STAGES[i + 1]!;
            return (
              <linearGradient key={i} id={`${uid}-g${i}`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                <stop offset="0%" style={{ stopColor: a.colour }} />
                <stop offset="100%" style={{ stopColor: b.colour }} />
              </linearGradient>
            );
          })}
          <radialGradient id={`${uid}-pulse`}>
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Abstract textile curves — threads drawn across the cloth. */}
        {!simplified ? (
          <g className="login-drift" opacity="0.5">
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M-40,${300 + i * 34} C120,${220 + i * 30} 260,${470 - i * 22} 420,${330 + i * 18} S640,${210 + i * 26} 680,${250 + i * 30}`}
                fill="none"
                stroke="var(--color-ink)"
                strokeOpacity={0.07 - i * 0.015}
                strokeWidth={1}
              />
            ))}
          </g>
        ) : null}

        {/* Faint full-route track, then the drawn connectors over it. */}
        {PATHS.map((d, i) => (
          <path key={`t${i}`} d={d} fill="none" stroke="var(--color-ink)" strokeOpacity="0.08" strokeWidth="1" />
        ))}
        {PATHS.map((d, i) => (
          <path
            key={`c${i}`}
            id={`${uid}-p${i}`}
            d={d}
            pathLength={1}
            fill="none"
            stroke={`url(#${uid}-g${i})`}
            strokeWidth="1.6"
            strokeLinecap="round"
            className="login-draw"
            style={{ animationDelay: `${1000 + i * 260}ms` }}
          />
        ))}

        {/* The travelling pulse: one leg per connector, on a shared cycle. */}
        {!reduced
          ? PATHS.map((_, i) => {
              const t0 = (i * LEG) / CYCLE;
              const t1 = ((i + 1) * LEG) / CYCLE;
              const e = 0.01;
              return (
                <g key={`pulse${i}`} opacity="0">
                  <circle r="11" fill={`url(#${uid}-pulse)`} opacity="0.55" />
                  <circle r="3" fill="#fff" />
                  <animateMotion
                    dur={`${CYCLE}s`}
                    begin={`${PULSE_START}s`}
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyPoints="0;0;1;1"
                    keyTimes={`0;${t0.toFixed(3)};${t1.toFixed(3)};1`}
                  >
                    <mpath href={`#${uid}-p${i}`} />
                  </animateMotion>
                  <animate
                    attributeName="opacity"
                    dur={`${CYCLE}s`}
                    begin={`${PULSE_START}s`}
                    repeatCount="indefinite"
                    values="0;0;1;1;0;0"
                    keyTimes={`0;${t0.toFixed(3)};${(t0 + e).toFixed(3)};${(t1 - e).toFixed(3)};${t1.toFixed(3)};1`}
                  />
                </g>
              );
            })
          : null}
      </svg>

      {/* Stage tiles, positioned in the SVG's coordinate space. */}
      {STAGES.map((s, i) => {
        const Icon = s.icon;
        return (
          <div
            key={s.key}
            className="login-node absolute w-max -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(s.x / W) * 100}%`, top: `${(s.y / H) * 100}%`, animationDelay: `${i * 150}ms` }}
          >
            <div
              className={cn(
                'relative flex items-center gap-2.5 rounded-[14px] border border-[var(--glass-border)] bg-[var(--login-tile)]',
                'shadow-[inset_0_1px_0_var(--glass-highlight),0_10px_28px_-12px_var(--glass-shadow)]',
                simplified ? 'px-2.5 py-2' : 'px-3 py-2.5',
              )}
            >
              {/* Brightens as the pulse arrives. */}
              <span
                aria-hidden="true"
                className="login-node-glow pointer-events-none absolute -inset-px rounded-[14px]"
                style={{
                  boxShadow: `0 0 0 1px color-mix(in srgb, ${s.colour} 60%, transparent), 0 0 24px -2px color-mix(in srgb, ${s.colour} 55%, transparent)`,
                  animationDelay: `${(PULSE_START + i * LEG - 0.1).toFixed(2)}s`,
                }}
              />
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full border"
                style={{
                  color: s.colour,
                  background: `radial-gradient(circle at 32% 26%, color-mix(in srgb, ${s.colour} 28%, transparent), color-mix(in srgb, ${s.colour} 10%, transparent) 72%)`,
                  borderColor: `color-mix(in srgb, ${s.colour} 30%, transparent)`,
                }}
              >
                <Icon className="size-4" />
              </span>
              <span className="pr-1 leading-tight">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
                  Stage {String(i + 1).padStart(2, '0')}
                </span>
                <span className="block whitespace-nowrap text-[13px] font-semibold text-ink">{s.name}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The phone's stand-in for the canvas: five stage dots on a hairline with a
 * light running along it. Small, quiet, and above the form — never behind it.
 */
export function MiniFlow() {
  return (
    <div aria-hidden="true" className="relative mx-auto mb-6 h-6 w-[220px]">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
      <span className="login-mini-pulse absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--login-accent)] shadow-[0_0_12px_2px_color-mix(in_srgb,var(--login-accent)_60%,transparent)]" />
      <div className="absolute inset-0 flex items-center justify-between">
        {STAGES.map((s) => (
          <span
            key={s.key}
            className="size-2.5 rounded-full border-2"
            style={{ borderColor: s.colour, background: `color-mix(in srgb, ${s.colour} 25%, var(--color-canvas))` }}
          />
        ))}
      </div>
    </div>
  );
}
