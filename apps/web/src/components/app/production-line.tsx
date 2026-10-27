'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { fmtQty } from '@/lib/utils';

/**
 * Garments are discrete, so a count shows as a whole number - "88", not
 * "88.00". Fabric is continuous and keeps its decimals elsewhere; carrying
 * them onto a piece count just puts noise on the largest type on the page.
 * A genuine fraction still prints, because hiding one would be a lie.
 */
function pieces(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Number.isInteger(n) ? fmtQty(value, 0) : fmtQty(value, 2);
}

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

/**
 * The Line.
 *
 * A garment is counted once, at the stage it has actually reached, so these
 * figures deliberately do NOT sum - 120 cut, 112 stitched and 96 finished is
 * 96 garments, not 328. The thing worth looking at is where quantity leaves
 * the line, which is why loss is drawn between the stages rather than inside
 * them.
 *
 * The running stitch is `stroke-dasharray`, so the animation is the subject
 * rather than decoration applied to it. On a phone it runs vertically, which
 * is the better reading of a sequence anyway.
 */
export function ProductionLine({
  stages, wipTotal, activeStages,
}: {
  stages: LineStage[];
  wipTotal: string;
  activeStages: number;
}) {
  const working = stages.filter((s) => s.hasActivity);
  const shown = working.length > 0 ? working : stages;
  const peak = Math.max(1, ...shown.map((s) => num(s.receivedQty)));

  return (
    <section
      aria-label="Production line"
      className="solid-accent relative overflow-hidden rounded-lg"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3.5 sm:px-5">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-chalk sm:text-[16px]">
            The line
          </h2>
          <p className="mt-0.5 text-[12px] text-chalk-muted">
            {shown.length === 0
              ? 'No route steps configured yet.'
              : 'Each garment counted once, at the stage it has reached. These do not sum.'}
          </p>
        </div>
        <Link
          href="/production/stages"
          className="group inline-flex items-center gap-1 rounded text-[12px] font-medium text-chalk-muted transition-colors hover:text-zari focus-visible:text-zari"
        >
          Open stages
          <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </header>

      {shown.length === 0 ? (
        <p className="px-4 pb-5 pt-3 text-[12.5px] text-chalk-muted sm:px-5">
          Define a production route and its steps, then released orders will appear here.
        </p>
      ) : (
        <>
          {/* Totals: the one big statement this page makes. */}
          {/*
            Three across on a phone rather than wrapped. Flow-wrapping these
            put one figure on its own row with a stray hint beside it, which
            reads as a mistake; a fixed three-up keeps the baselines true at
            every width.
          */}
          <div className="grid grid-cols-3 items-start gap-x-3 px-4 pb-1 pt-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-7 sm:px-5">
            <Figure
              delay={0}
              value={pieces(wipTotal)}
              label="on the floor now"
              hint={`${activeStages} ${activeStages === 1 ? 'stage holding work' : 'stages holding work'}`}
            />
            <Figure
              delay={80}
              value={pieces(totalOf(shown, 'rejectedQty'))}
              label="rejected"
              tone={num(totalOf(shown, 'rejectedQty')) > 0 ? 'loss' : 'none'}
            />
            <Figure
              delay={140}
              value={pieces(totalOf(shown, 'reworkOpenQty'))}
              label="out for rework"
              tone={num(totalOf(shown, 'reworkOpenQty')) > 0 ? 'loss' : 'none'}
              hint="Outstanding, not cumulative"
            />
          </div>

          <StitchTrack stages={shown} peak={peak} />
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Figure({
  value, label, hint, tone, delay,
}: {
  value: string; label: string; hint?: string; tone?: 'loss' | 'none'; delay: number;
}) {
  // A zero loss is good news and should read as calm, not as an alarm showing
  // nothing. Only a real loss earns the madder.
  const colour =
    tone === 'loss' ? 'text-madder' : tone === 'none' ? 'text-chalk-muted/60' : 'text-chalk';
  return (
    <div className="line-figure" style={{ animationDelay: `${delay}ms` }}>
      <div
        className={`font-display text-[24px] leading-none font-semibold tracking-tight num sm:text-[30px] ${colour}`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10.5px] leading-tight font-medium tracking-wide text-chalk-muted uppercase sm:text-[11px]">
        {label}
      </div>
      {hint ? (
        <div className="mt-0.5 hidden text-[11px] leading-tight text-chalk-muted/70 sm:block">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * The stitch itself.
 *
 * Rendered twice: a horizontal run for tablets and desktops, a vertical one for
 * phones. Two SVGs rather than one reflowed, because a sequence read top-to-
 * bottom on a narrow screen needs different proportions, not the same drawing
 * squeezed.
 */
function StitchTrack({ stages, peak }: { stages: LineStage[]; peak: number }) {
  return (
    <>
      {/* Phone: vertical */}
      <ol className="space-y-0 px-4 pb-5 pt-3 sm:hidden">
        {stages.map((s, i) => (
          <li key={s.stageId} className="relative pl-7">
            {i < stages.length - 1 ? (
              <svg
                className="absolute left-[7px] top-4 h-full w-px overflow-visible"
                aria-hidden="true"
                style={{ ['--stitch-length' as string]: '120' }}
              >
                <line
                  x1="0" y1="0" x2="0" y2="100%"
                  className="stitch"
                  stroke="var(--color-chalk-muted)"
                  strokeWidth="1.5"
                  strokeDashoffset="120"
                  style={{ animationDelay: `${300 + i * 110}ms` }}
                />
              </svg>
            ) : null}

            <span
              className="line-node absolute left-0 top-[5px] block size-3.5 border-2"
              style={{
                animationDelay: `${260 + i * 110}ms`,
                borderColor: num(s.wipQty) > 0 ? 'var(--color-zari)' : 'var(--color-vat-line)',
                background: num(s.wipQty) > 0 ? 'var(--color-zari)' : 'transparent',
              }}
            />

            <div
              className="line-node pb-5"
              style={{ animationDelay: `${300 + i * 110}ms` }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] font-medium text-chalk">{s.name}</span>
                <span
                  className={`font-display text-[22px] leading-none font-semibold num ${
                    num(s.wipQty) > 0 ? 'text-chalk' : 'text-chalk-muted/55'
                  }`}
                >
                  {pieces(s.wipQty)}
                </span>
              </div>
              <Meter stage={s} peak={peak} />
              <StageCaption stage={s} />
            </div>
          </li>
        ))}
      </ol>

      {/* Tablet and up: horizontal */}
      <div className="hidden sm:block">
        <div className="scroll-x px-5 pb-4 pt-3">
          <div
            // Columns cap rather than stretch. Three active stages spread
            // across a wide monitor turn the meters into long empty bars that
            // read as the most important thing on the strip; capped, the line
            // simply looks like what it is - a line that has not filled yet.
            className="grid min-w-[480px] gap-x-4"
            style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(104px, 236px))` }}
          >
            {/* the thread */}
            <svg
              className="col-span-full h-3 w-full overflow-visible"
              preserveAspectRatio="none"
              aria-hidden="true"
              style={{ ['--stitch-length' as string]: '1200' }}
            >
              <line
                x1="0" y1="6" x2="100%" y2="6"
                className="stitch"
                stroke="var(--color-chalk-muted)"
                strokeWidth="1.5"
                strokeDashoffset="1200"
              />
            </svg>

            {stages.map((s, i) => (
              <div key={s.stageId} className="relative -mt-[13px]">
                <span
                  className="line-node mb-3 block size-3 border-2"
                  style={{
                    animationDelay: `${300 + i * 110}ms`,
                    borderColor: num(s.wipQty) > 0 ? 'var(--color-zari)' : 'var(--color-vat-line)',
                    background: num(s.wipQty) > 0 ? 'var(--color-zari)' : 'var(--color-vat)',
                  }}
                />
                <div className="line-node" style={{ animationDelay: `${340 + i * 110}ms` }}>
                  <div className="truncate text-[11.5px] font-medium text-chalk-muted" title={s.name}>
                    {s.name}
                  </div>
                  <div
                    className={`mt-1 font-display text-[26px] leading-none font-semibold num ${
                      num(s.wipQty) > 0 ? 'text-chalk' : 'text-chalk-muted/55'
                    }`}
                  >
                    {pieces(s.wipQty)}
                  </div>
                  <Meter stage={s} peak={peak} />
                  <StageCaption stage={s} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** How much of the line's peak throughput passed through here. */
function Meter({ stage, peak }: { stage: LineStage; peak: number }) {
  const pct = Math.min(100, Math.round((num(stage.receivedQty) / peak) * 100));
  return (
    <div
      className="mt-2 h-[3px] w-full bg-vat-deep"
      role="img"
      aria-label={`${pieces(stage.receivedQty)} taken into ${stage.name}`}
    >
      <div
        className="h-full transition-[width] duration-700 ease-out"
        style={{
          width: `${pct}%`,
          background: num(stage.wipQty) > 0 ? 'var(--color-zari)' : 'var(--color-vat-line)',
        }}
      />
    </div>
  );
}

/**
 * What the big number means, and where quantity left.
 *
 * The figure above is what is SITTING here; the bar is what has passed
 * through. Saying "of 50 taken in" makes that relationship explicit - without
 * it the number and the bar look like they should agree, and they never will.
 */
function StageCaption({ stage }: { stage: LineStage }) {
  const rejected = num(stage.rejectedQty);
  const rework = num(stage.reworkOpenQty);
  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="text-[11px] text-chalk-muted/70">
        <span className="num">{pieces(stage.receivedQty)}</span> taken in
      </div>
      {rejected > 0 || rework > 0 ? (
        <div className="flex flex-wrap gap-x-2.5 text-[11px] text-madder">
          {rejected > 0 ? (
            <span className="num struck">{pieces(stage.rejectedQty)} rejected</span>
          ) : null}
          {rework > 0 ? (
            <span className="num struck">{pieces(stage.reworkOpenQty)} rework</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const num = (v: string): number => Number(v) || 0;
const totalOf = (stages: LineStage[], key: keyof LineStage): string =>
  stages.reduce((sum, s) => sum + num(String(s[key])), 0).toFixed(2);
