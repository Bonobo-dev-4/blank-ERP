'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowUp, ArrowUpRight, BellRing, Boxes, ClipboardList, Database, Factory, Lock, RotateCcw,
  Sparkles, SquarePen, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-context';

interface Status { configured: boolean; provider: string | null; model: string; missing: string[] }
interface Answer { answer: string; toolsUsed: string[]; rounds: number }
type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[] };
type AskVars = { question: string; history: { role: Turn['role']; content: string }[] };

/**
 * Suggested questions, each one answerable by the assistant's real tools —
 * and shown only to someone whose permissions reach those tools, so nobody is
 * offered a question the assistant would have to refuse.
 */
const SUGGESTED: { q: string; icon: React.ComponentType<{ className?: string }>; needs: string[] }[] = [
  { q: "What's currently in production?", icon: Factory, needs: ['manufacturing.read'] },
  { q: 'Which raw materials are out of stock?', icon: Boxes, needs: ['inventory.read'] },
  { q: 'Show pending manufacturing orders', icon: ClipboardList, needs: ['manufacturing.read'] },
  { q: 'What needs attention today?', icon: BellRing, needs: ['inventory.read', 'manufacturing.read'] },
];

/** Screens where nothing may float over the controls. */
const SUPPRESS_ON = ['/scan'];

/**
 * The assistant.
 *
 * A floating glass capsule at the bottom centre of the app, opening a drawer
 * from the right. It answers from the ERP's own data through read-only tools
 * scoped to whoever is asking — it cannot change anything, and it cannot see
 * anything the person could not open themselves.
 *
 * Every answer says which lookups produced it. An assistant that states a
 * figure without saying where it came from is asking to be trusted on
 * nothing, and in a system where a wrong number becomes a cutting instruction
 * that is not a reasonable thing to ask.
 *
 * The conversation lives here, in the shell, so closing the drawer or moving
 * between screens never loses it; only "New conversation" clears it.
 */
export function Assistant() {
  const pathname = usePathname();
  const { can } = useAuth();
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [announce, setAnnounce] = React.useState('');
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pinnedToEnd = React.useRef(true);

  React.useEffect(() => { setMounted(true); }, []);

  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api.get<Status>('/assistant/status'),
    staleTime: 5 * 60_000,
  });
  const configured = !!status.data?.configured;

  const ask = useMutation({
    mutationFn: ({ question, history }: AskVars) => api.post<Answer>('/assistant/ask', { question, history }),
    onSuccess: (r) => {
      setTurns((t) => [...t, { role: 'assistant', content: r.answer, tools: r.toolsUsed }]);
      setAnnounce('Answer received.');
    },
    onError: () => setAnnounce('The question did not go through.'),
  });

  // Cmd/Ctrl+K from anywhere — the one shortcut most people already try.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Follow new messages only if the reader is already at the end — never
  // yank someone back down while they are reading an earlier answer.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToEnd.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns, ask.isPending]);

  // Grow the box with the question, up to a few lines.
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, open]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || ask.isPending || !configured) return;
    const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.content }));
    pinnedToEnd.current = true;
    setTurns((t) => [...t, { role: 'user', content: question }]);
    setDraft('');
    setAnnounce('Reading your records…');
    ask.mutate({ question, history });
  };

  // Retry re-asks the question already on screen, without adding it twice.
  const retry = () => {
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'user' || ask.isPending) return;
    const history = turns.slice(0, -1).slice(-6).map((t) => ({ role: t.role, content: t.content }));
    setAnnounce('Reading your records…');
    ask.mutate({ question: last.content, history });
  };

  const newConversation = () => {
    if (ask.isPending) return;
    setTurns([]);
    setDraft('');
    ask.reset();
    setAnnounce('Started a new conversation.');
    inputRef.current?.focus();
  };

  const suggestions = SUGGESTED.filter((s) => s.needs.some((p) => can(p)));
  const suppressed = SUPPRESS_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const lastFailed = !!ask.error && turns[turns.length - 1]?.role === 'user';

  const launcher =
    mounted && !suppressed
      ? createPortal(
          <button
            ref={launcherRef}
            type="button"
            onClick={() => setOpen(true)}
            data-hidden={open}
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Ask about your data (⌘K)"
            className="ai-pill"
          >
            <span className="ai-pill-icon" aria-hidden="true">
              <Sparkles className="ai-twinkle size-[18px]" />
            </span>
            <span>Ask about your data</span>
            <ArrowUpRight className="ai-pill-arrow size-4" aria-hidden="true" />
          </button>,
          document.body,
        )
      : null;

  return (
    <>
      {launcher}

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ai-scrim" />
          <Dialog.Content
            className="ai-drawer"
            aria-describedby="ai-drawer-desc"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            onCloseAutoFocus={(e) => {
              // Back to the capsule, once it is visible again.
              e.preventDefault();
              requestAnimationFrame(() => launcherRef.current?.focus());
            }}
          >
            {/* --- header --- */}
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--ai-panel-border)] px-5">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full border"
                style={{
                  color: 'var(--ai-pill-icon)',
                  background: 'radial-gradient(circle at 32% 26%, color-mix(in srgb, var(--ai-accent) 28%, transparent), color-mix(in srgb, var(--ai-accent) 8%, transparent) 72%)',
                  borderColor: 'color-mix(in srgb, var(--ai-accent) 30%, transparent)',
                }}
                aria-hidden="true"
              >
                <Sparkles className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <Dialog.Title className="truncate font-display text-[15px] font-semibold tracking-[-0.02em]">
                  Ask about your data
                </Dialog.Title>
                <p id="ai-drawer-desc" className="truncate text-[12.5px] text-[var(--ai-text-2)]">
                  Dash and Dot AI Assistant
                </p>
              </div>
              <button
                type="button"
                onClick={newConversation}
                disabled={turns.length === 0 || ask.isPending}
                aria-label="New conversation"
                title="New conversation"
                className="grid size-9 place-items-center rounded-lg text-[var(--ai-text-2)] transition-colors hover:bg-[var(--ai-bot-bg)] hover:text-[var(--ai-text)] disabled:pointer-events-none disabled:opacity-35"
              >
                <SquarePen className="size-[17px]" />
              </button>
              <Dialog.Close
                aria-label="Close the assistant"
                className="grid size-9 place-items-center rounded-lg text-[var(--ai-text-2)] transition-colors hover:bg-[var(--ai-bot-bg)] hover:text-[var(--ai-text)]"
              >
                <X className="size-[18px]" />
              </Dialog.Close>
            </header>

            {/* --- conversation --- */}
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                pinnedToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
            >
              {status.data && !configured ? (
                <div className="rounded-2xl border border-[var(--ai-panel-border)] bg-[var(--ai-bot-bg)] px-4 py-3.5 text-[13.5px]">
                  <p className="flex items-center gap-2 font-semibold">
                    <Lock className="size-4" /> No AI provider is connected yet
                  </p>
                  <p className="mt-1.5 leading-relaxed text-[var(--ai-text-2)]">
                    Add <code className="font-mono text-[12.5px]">ANTHROPIC_API_KEY</code> or{' '}
                    <code className="font-mono text-[12.5px]">OPENAI_API_KEY</code> to the API environment
                    and restart it. The key stays on the server — it is never sent to this browser.
                  </p>
                </div>
              ) : null}

              {turns.length === 0 && configured ? (
                <div className="pt-4">
                  <span
                    className="grid size-12 place-items-center rounded-2xl border"
                    style={{
                      color: 'var(--ai-pill-icon)',
                      background: 'radial-gradient(circle at 30% 24%, color-mix(in srgb, var(--ai-accent) 26%, transparent), color-mix(in srgb, var(--ai-accent) 6%, transparent) 74%)',
                      borderColor: 'color-mix(in srgb, var(--ai-accent) 28%, transparent)',
                    }}
                    aria-hidden="true"
                  >
                    <Sparkles className="size-[22px]" />
                  </span>
                  <h2 className="mt-4 font-display text-[22px] font-[650] leading-tight tracking-[-0.03em]">
                    What would you like to know?
                  </h2>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ai-text-2)]">
                    Explore your manufacturing, inventory and order data. Answers come from live records,
                    and only from what you are allowed to see.
                  </p>
                  {suggestions.length ? (
                    <ul className="mt-6 space-y-2" aria-label="Suggested questions">
                      {suggestions.map(({ q, icon: Icon }) => (
                        <li key={q}>
                          <button
                            type="button"
                            onClick={() => send(q)}
                            className="group flex w-full items-center gap-3 rounded-[14px] border border-[var(--ai-panel-border)] bg-[var(--ai-bot-bg)] px-3.5 py-3 text-left text-[13.5px] font-medium transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-[var(--ai-user-bg)]"
                          >
                            <Icon className="size-4 shrink-0 text-[var(--ai-pill-icon)]" />
                            <span className="flex-1">{q}</span>
                            <ArrowUpRight className="size-4 shrink-0 text-[var(--ai-text-2)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <ul className="space-y-4">
                {turns.map((t, i) =>
                  t.role === 'user' ? (
                    <li key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-[color-mix(in_srgb,var(--ai-accent)_22%,transparent)] bg-[var(--ai-user-bg)] px-3.5 py-2.5 text-[14px] leading-relaxed">
                        {t.content}
                      </div>
                    </li>
                  ) : (
                    <li key={i} className="flex gap-2.5">
                      <BotMark />
                      <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-[var(--ai-panel-border)] bg-[var(--ai-bot-bg)] px-3.5 py-2.5 text-[14px] leading-relaxed">
                        <RichText text={t.content} />
                        {t.tools?.length ? (
                          <p className="mt-2.5 flex items-start gap-1.5 border-t border-[var(--ai-panel-border)] pt-2 text-[12px] text-[var(--ai-text-2)]">
                            <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              Looked at: {[...new Set(t.tools)].map((x) => x.replace(/^get_/, '').replace(/_/g, ' ')).join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ),
                )}

                {ask.isPending ? (
                  <li className="flex gap-2.5">
                    <BotMark />
                    <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-md border border-[var(--ai-panel-border)] bg-[var(--ai-bot-bg)] px-3.5 py-3 text-[13px] text-[var(--ai-text-2)]">
                      <span className="flex gap-1" aria-hidden="true">
                        {[0, 1, 2].map((d) => (
                          <span key={d} className="ai-dot size-1.5 rounded-full bg-[var(--ai-pill-icon)]" style={{ animationDelay: `${d * 140}ms` }} />
                        ))}
                      </span>
                      Reading your records…
                    </div>
                  </li>
                ) : null}
              </ul>

              {lastFailed && !ask.isPending ? (
                <div role="alert" className="mt-4 rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3 text-[13.5px]">
                  <p>{(ask.error as { message?: string }).message ?? 'That did not go through.'}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold text-[var(--ai-text)] transition-colors hover:bg-[var(--ai-bot-bg)]"
                  >
                    <RotateCcw className="size-3.5" /> Try again
                  </button>
                </div>
              ) : null}
            </div>

            {/* Status for screen readers: thinking, answered, failed. */}
            <p role="status" aria-live="polite" className="sr-only">{announce}</p>

            {/* --- composer --- */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(draft); }}
              className="shrink-0 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-2"
            >
              <div className="flex min-h-12 items-end gap-2 rounded-[18px] border border-[var(--ai-panel-border)] bg-[var(--ai-input-bg)] py-1.5 pl-4 pr-1.5 shadow-[0_8px_24px_-14px_var(--ai-panel-shadow),inset_0_1px_0_rgb(255_255_255/0.12)] transition-[border-color,box-shadow] focus-within:border-[color-mix(in_srgb,var(--ai-accent)_60%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ai-accent)_18%,transparent)]">
                <label htmlFor="ai-question" className="sr-only">Your question</label>
                <textarea
                  id="ai-question"
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter writes a new line.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); }
                  }}
                  placeholder={configured ? 'Ask anything about your data...' : 'Connect a provider to ask'}
                  disabled={!configured || ask.isPending}
                  className="max-h-[140px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1.5 text-[14px] leading-snug text-[var(--ai-text)] outline-none placeholder:text-[var(--ai-text-2)] placeholder:opacity-80 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || !configured || ask.isPending}
                  aria-label="Send question"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ai-accent)] text-[var(--ai-on-accent)] shadow-sm transition-[opacity,transform] duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-35"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
              <p className="mt-2 px-1 text-[11.5px] leading-snug text-[var(--ai-text-2)]">
                Read-only — it can&rsquo;t change stock, approve anything, or write to Shopify or Unicommerce.
                {status.data?.configured && status.data.provider ? ` · ${status.data.provider} ${status.data.model}` : ''}
              </p>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function BotMark() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border"
      style={{
        color: 'var(--ai-pill-icon)',
        background: 'color-mix(in srgb, var(--ai-accent) 14%, transparent)',
        borderColor: 'color-mix(in srgb, var(--ai-accent) 26%, transparent)',
      }}
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/* ------------------------------------------------------------ rich text */

/**
 * A deliberately small Markdown subset — paragraphs, bullet and numbered
 * lists, pipe tables, **bold** and `code` — built as React elements, so the
 * model's text is always escaped and can never inject markup.
 */
function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="my-2 overflow-x-auto rounded-lg border border-[var(--ai-panel-border)]">
          <table className="w-full text-[12.5px]">
            {head ? (
              <thead className="bg-[var(--ai-bot-bg)] text-left">
                <tr>{head.map((c, k) => <th key={k} className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{inline(c)}</th>)}</tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((r, j) => (
                <tr key={j} className="border-t border-[var(--ai-panel-border)]">
                  {r.map((c, k) => <td key={k} className="num px-2.5 py-1.5">{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*[-*•]\s+/, '')); i++; }
      blocks.push(
        <ul key={blocks.length} className="my-1.5 list-disc space-y-1 pl-5 marker:text-[var(--ai-text-2)]">
          {items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push(
        <ol key={blocks.length} className="my-1.5 list-decimal space-y-1 pl-5 marker:text-[var(--ai-text-2)]">
          {items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </ol>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*([-*•]|\d+[.)]|\|)/.test(lines[i]!)) {
      para.push(lines[i]!.replace(/^#{1,6}\s+/, ''));
      i++;
    }
    blocks.push(
      <p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">
        {para.map((p, k) => <React.Fragment key={k}>{k > 0 ? <br /> : null}{inline(p)}</React.Fragment>)}
      </p>,
    );
  }
  return <>{blocks}</>;
}

function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith('**')
        ? <strong key={m.index} className="font-semibold">{tok.slice(2, -2)}</strong>
        : <code key={m.index} className="rounded bg-[var(--ai-bot-bg)] px-1 py-px font-mono text-[12.5px]">{tok.slice(1, -1)}</code>,
    );
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
