'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight, ArrowUpRight, CircleCheck, Factory, PackageCheck, PackageOpen, PlayCircle,
  RefreshCw, Scissors, ShieldCheck, Shirt, Sparkles, TriangleAlert,
} from 'lucide-react';
import { ALL_NAV_ITEMS } from '@dnd/contracts';
import { cn, fmtQty } from '@/lib/utils';
import type { Accent } from '@/components/ui/primitives';
import { InfoHint } from '@/components/ui/primitives';
import { GlassTooltip } from '@/components/ui/tooltip';
import { accentVar, stageAccent } from '@/components/ui/charts';
import { useAuth } from './auth-context';

/**
 * Garments are discrete, so a count shows as a whole number — "88", not
 * "88.00". A genuine fraction still prints, because hiding one would be a lie.
 */
function pieces(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? fmtQty(String(n), 0) : fmtQty(String(n), 2);
}

const num = (v: string) => Number(v) || 0;

export interface LineStage {
  stageId: string;
  code: string;
  name: string;
  sequence: number;
  receivedQty: string;
  completedQty: string;
  forwardedQty: string;
  rejectedQty: string;
  reworkOpenQty: string;
  wipQty: string;
  hasActivity: boolean;
}

const STAGE_ICON: Record<Accent, React.ComponentType<{ className?: string }>> = {
  release: PlayCircle,
  issue: PackageOpen,
  cutting: Scissors,
  stitching: Shirt,
  finishing: Sparkles,
  qc: ShieldCheck,
  rework: RefreshCw,
  completed: PackageCheck,
  rejected: TriangleAlert,
  inventory: PackageOpen,
  purchasing: PackageOpen,
  delayed: TriangleAlert,
  hold: TriangleAlert,
  neutral: Factory,
};

/**
 * Where a stage card leads: the screen that works that stage, if one exists
 * and the person can open it. A stage with no screen is simply not a link —
 * a card that leads to a 404 is worse than a card that leads nowhere.
 */
const DRILLDOWN: [RegExp, RegExp][] = [
  [/release/i, /^Manufacturing Orders$/],
  [/issue/i, /^Material Movements$/],
  [/cut/i, /^Cutting$/],
  [/embroider/i, /^Embroidery$/],
  [/stitch|sew/i, /^Stitching$/],
  [/wash|process/i, /^Washing/],
  [/finish/i, /^Finishing$/],
  [/qc|quality|inspect/i, /^Quality Control$/],
  [/rework/i, /^Rework$/],
  [/handover|dispatch/i, /^Production Handover$/],
];

/**
 * The production flow.
 *
 * Connected stage cards, in route order. Each card's headline is what sits AT
 * that stage right now; the bar is how much of what it took in it has
 * completed; and losses — rejection and open rework — are flagged on the card
 * where they happened, because where quantity leaves the line is the thing
 * nobody has on a spreadsheet.
 *
 * A garment is counted once, at the stage it has reached, so stage figures
 * deliberately do NOT sum across cards. Everything here is read from the
 * stage ledger; nothing is estimated.
 */
export function ProductionLine({
  stages, wipTotal, activeStages,
}: {
  stages: LineStage[];
  wipTotal: string;
  activeStages: number;
}) {
  const { can } = useAuth();
  const [showIdle, setShowIdle] = React.useState(false);
  const working = stages.filter((s) => s.hasActivity);
  const idleCount = stages.length - working.length;
  const shown = showIdle || working.length === 0 ? stages : working;

  const rejected = shown.reduce((n, s) => n + num(s.rejectedQty), 0);
  const rework = shown.reduce((n, s) => n + num(s.reworkOpenQty), 0);

  const hrefFor = (s: LineStage): string | undefined => {
    const rule = DRILLDOWN.find(([stage]) => stage.test(`${s.name} ${s.code}`));
    if (!rule) return undefined;
    const item = ALL_NAV_ITEMS.find(
      (i) => rule[1].test(i.label) && i.status !== 'PLANNED' && (!i.permission || can(i.permission)),
    );
    return item?.href;
  };

  return (
    <section aria-labelledby="flow-title" className="glass-elevated rounded-3xl p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="flow-title" className="t-section-title text-ink">
              Production flow
            </h2>
            <InfoHint text="Each garment is counted once, at the stage it has reached, so stage figures do not sum across cards. Read live from the stage ledger." />
          </div>
          <p className="text-[13px] text-ink-subtle">
            {shown.length === 0
              ? 'No production stages are configured yet.'
              : `${shown.length} stages in route order · garments, live from the stage ledger`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        {working.length > 0 && idleCount > 0 ? (
          <button
            type="button"
            aria-pressed={showIdle}
            onClick={() => setShowIdle((v) => !v)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors',
              showIdle ? 'border-brand/60 bg-brand-soft text-ink' : 'border-line text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            <span aria-hidden="true" className={cn('size-3 rounded-[3px] border', showIdle ? 'border-brand bg-brand' : 'border-line-strong')} />
            Show {idleCount} idle {idleCount === 1 ? 'stage' : 'stages'}
          </button>
        ) : null}
        <dl className="flex flex-wrap items-stretch gap-2">
          <Summary label="On the floor" value={pieces(wipTotal)} accent="stitching" note={`at ${activeStages} stages`} />
          <Summary label="Rejected" value={pieces(rejected)} accent="rejected" alert={rejected > 0} />
          <Summary label="Out for rework" value={pieces(rework)} accent="rework" alert={rework > 0} />
        </dl>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-muted">
          Configure production stages and a route to see work flow through them here.
        </p>
      ) : (
        <ol
          className={cn(
            'mt-4 flex flex-col gap-1.5 lg:flex-row lg:items-stretch lg:gap-0',
            shown.length > 5 && 'lg:overflow-x-auto lg:pb-2',
          )}
          aria-label="Production stages in order"
        >
          {shown.map((s, i) => {
            const accent = stageAccent(s.name, s.code, i);
            const next = shown[i + 1];
            return (
              <React.Fragment key={s.stageId}>
                <li className={cn('min-w-0 lg:flex-1', shown.length > 5 && 'lg:min-w-[210px]')}>
                  <StageCard stage={s} index={i} accent={accent} href={hrefFor(s)} />
                </li>
                {next ? (
                  <Connector
                    from={accent}
                    to={stageAccent(next.name, next.code, i + 1)}
                    handedOn={num(s.forwardedQty)}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Summary({
  label, value, accent, note, alert,
}: {
  label: string;
  value: string;
  accent: Accent;
  note?: string;
  alert?: boolean;
}) {
  return (
    <div className="glass-inset flex min-w-[112px] items-center gap-2.5 rounded-xl px-3 py-1.5">
      <span className="size-2 shrink-0 rounded-full" style={{ background: accentVar(accent) }} aria-hidden="true" />
      <div>
        <dt className="text-[12px] text-ink-subtle">{label}</dt>
        <dd
          className={cn('num text-[18px] font-semibold leading-tight tracking-[-0.02em]', alert ? '' : 'text-ink')}
          style={alert ? { color: accentVar(accent) } : undefined}
        >
          {value}
          {note ? <span className="ml-1.5 text-[12px] font-normal tracking-normal text-ink-subtle">{note}</span> : null}
        </dd>
      </div>
    </div>
  );
}

function StageCard({
  stage, index, accent, href,
}: {
  stage: LineStage;
  index: number;
  accent: Accent;
  href?: string;
}) {
  const Icon = STAGE_ICON[accent];
  const colour = accentVar(accent);
  const received = num(stage.receivedQty);
  const completed = num(stage.completedQty);
  const rejected = num(stage.rejectedQty);
  const rework = num(stage.reworkOpenQty);
  const wip = num(stage.wipQty);
  const pct = received > 0 ? Math.min(100, Math.round((completed / received) * 100)) : 0;

  const body = (
    <>
      {/* A fine wash of the stage colour, so the card reads as tinted glass. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        style={{
          background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${colour} 20%, transparent), transparent 62%)`,
        }}
      />
      <div className="flex items-center gap-2.5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full border"
          style={{
            color: colour,
            background: `color-mix(in srgb, ${colour} 16%, transparent)`,
            borderColor: `color-mix(in srgb, ${colour} 34%, transparent)`,
          }}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="t-micro text-ink-subtle">Stage {index + 1}</p>
          <h3 className="t-card-title truncate text-ink">{stage.name}</h3>
        </div>
        {href ? <ArrowUpRight className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /> : null}
      </div>

      <div className="mt-3.5 flex items-end justify-between gap-2">
        <div>
          <p className="t-kpi line-figure text-[34px] text-ink">{pieces(wip)}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">at this stage now</p>
        </div>
        <GlassTooltip content={`${pieces(completed)} of ${pieces(received)} garments taken in at ${stage.name} have been completed here.`}>
          <button type="button" className="rounded-md text-right" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <span className="num block text-[15px] font-semibold text-ink">{pct}%</span>
            <span className="block text-[12px] text-ink-subtle">completed</span>
          </button>
        </GlassTooltip>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={`${stage.name}: ${pct}% of work taken in is completed`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="bar-grow h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, color-mix(in srgb, ${colour} 70%, transparent), ${colour})`,
            boxShadow: `0 0 8px color-mix(in srgb, ${colour} 45%, transparent)`,
          }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
        <div>
          <dt className="text-ink-subtle">Taken in</dt>
          <dd className="num font-semibold text-ink">{pieces(received)}</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Completed</dt>
          <dd className="num font-semibold text-ink">{pieces(completed)}</dd>
        </div>
      </dl>

      {/* Pinned to the card's foot so exception rows line up across stages. */}
      <div className="mt-auto pt-3">
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
        {rejected > 0 ? (
          <Exception
            accent="rejected"
            icon={TriangleAlert}
            label={`${pieces(rejected)} rejected`}
            tip={`${pieces(rejected)} garments were rejected at ${stage.name} and left the line.`}
          />
        ) : null}
        {rework > 0 ? (
          <Exception
            accent="rework"
            icon={RefreshCw}
            label={`${pieces(rework)} in rework`}
            tip={`${pieces(rework)} garments sent to rework from ${stage.name} have not come back yet.`}
          />
        ) : null}
        {rejected === 0 && rework === 0 ? (
          <span className="inline-flex h-6 items-center gap-1.5 text-[12.5px] text-ink-subtle">
            <CircleCheck className="size-3.5" style={{ color: accentVar('completed') }} />
            No losses at this stage
          </span>
        ) : null}
      </div>
      </div>
    </>
  );

  const shell = cn(
    'glass-inset group relative isolate flex h-full flex-col gap-0 rounded-xl p-4',
    'shadow-[inset_0_1px_0_var(--glass-highlight)]',
  );

  return href ? (
    <Link
      href={href}
      aria-label={`${stage.name}: ${pieces(wip)} at this stage. Open ${stage.name}.`}
      className={cn(shell, 'glass-interactive hover:border-[var(--glass-border)]')}
    >
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

function Exception({
  accent, icon: Icon, label, tip,
}: {
  accent: Accent;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tip: string;
}) {
  const colour = accentVar(accent);
  return (
    <GlassTooltip content={tip}>
    <span
      tabIndex={0}
      className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] font-semibold"
      style={{
        color: `var(--color-${accent === 'rejected' ? 'danger' : 'hold'})`,
        background: `color-mix(in srgb, ${colour} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${colour} 34%, transparent)`,
      }}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
    </GlassTooltip>
  );
}

/**
 * The transition between two stages: a lit line from one stage's colour to
 * the next, carrying what was handed on. Vertical on a phone, where a
 * sequence reads top to bottom anyway.
 */
function Connector({ from, to, handedOn }: { from: Accent; to: Accent; handedOn: number }) {
  return (
    <li aria-hidden="true" className="flex items-center justify-center lg:w-[64px] lg:shrink-0">
      {/* desktop: horizontal */}
      <div className="hidden w-full flex-col items-center gap-1 px-1.5 lg:flex">
        <span className="num text-[13px] font-semibold text-ink">{pieces(handedOn)}</span>
        <div className="relative flex w-full items-center">
          <span
            className="h-[2px] flex-1 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${accentVar(from)}, ${accentVar(to)})`,
              boxShadow: `0 0 10px color-mix(in srgb, ${accentVar(to)} 45%, transparent)`,
            }}
          />
          <ArrowRight className="-ml-1.5 size-4 shrink-0" style={{ color: accentVar(to) }} />
        </div>
        <span className="text-[12px] text-ink-subtle">handed on</span>
      </div>
      {/* phone and tablet: vertical */}
      <div className="flex items-center gap-2 py-0.5 lg:hidden">
        <span
          className="h-6 w-[3px] rounded-full"
          style={{ background: `linear-gradient(180deg, ${accentVar(from)}, ${accentVar(to)})` }}
        />
        <span className="text-[12px] text-ink-muted">
          <span className="num font-semibold text-ink">{pieces(handedOn)}</span> handed on
        </span>
      </div>
    </li>
  );
}
