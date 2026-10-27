'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUp, Loader2, Lock, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Status { configured: boolean; provider: string | null; model: string; missing: string[] }
interface Answer { answer: string; toolsUsed: string[]; rounds: number }
type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[] };

const SUGGESTED = [
  'What is out of stock right now?',
  'Where is work sitting on the line?',
  'What do we still owe customers?',
  'Which materials are over their BOM standard?',
];

/**
 * The assistant.
 *
 * A glass pill that opens a panel. It answers from the ERP's own data through
 * read-only tools scoped to whoever is asking — it cannot change anything, and
 * it cannot see anything the person could not open themselves.
 *
 * The panel says which lookups produced an answer. An assistant that states a
 * figure without saying where it came from is asking to be trusted on nothing,
 * and in a system where a wrong number becomes a cutting instruction that is
 * not a reasonable thing to ask.
 */
export function Assistant() {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api.get<Status>('/assistant/status'),
    staleTime: 5 * 60_000,
  });

  const ask = useMutation({
    mutationFn: (question: string) =>
      api.post<Answer>('/assistant/ask', {
        question,
        history: turns.slice(-6).map((t) => ({ role: t.role, content: t.content })),
      }),
    onSuccess: (r) => {
      setTurns((t) => [...t, { role: 'assistant', content: r.answer, tools: r.toolsUsed }]);
    },
  });

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, ask.isPending]);

  // Cmd/Ctrl+K from anywhere. The one shortcut most people already try.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || ask.isPending) return;
    setTurns((t) => [...t, { role: 'user', content: question }]);
    setDraft('');
    ask.mutate(question);
  };

  return (
    <>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask the assistant"
          className={cn(
            'glass fixed bottom-5 right-5 z-40 flex items-center gap-2 py-2.5 pl-3.5 pr-4',
            'text-[12.5px] font-medium text-ink shadow-lg transition-transform duration-200',
            'hover:-translate-y-0.5 active:translate-y-0',
          )}
        >
          <Sparkles className="size-4" />
          Ask about your data
          <kbd className="ml-1 rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">⌘K</kbd>
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-5">
          {/* Dismiss by clicking away, but the panel is not modal: an operator
              should be able to read the screen behind while asking about it. */}
          <button
            aria-label="Close the assistant"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-transparent"
          />

          <div className="glass-modal relative flex h-[min(620px,88vh)] w-full max-w-[440px] flex-col overflow-hidden rounded-3xl">
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Sparkles className="size-4 text-ink" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-tight text-ink">Ask about your data</p>
                <p className="truncate text-[12px] leading-tight text-ink-muted">
                  {status.data?.configured
                    ? `Reads live figures · ${status.data.provider} ${status.data.model}`
                    : 'Reads live figures from this ERP'}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {status.data && !status.data.configured ? (
                <div className="rounded-xl border border-line bg-surface-muted px-3.5 py-3 text-[12.5px]">
                  <p className="flex items-center gap-1.5 font-medium text-ink">
                    <Lock className="size-3.5" /> No AI provider is connected yet
                  </p>
                  <p className="mt-1.5 text-ink-muted">
                    Add <code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code> or{' '}
                    <code className="font-mono text-[12px]">OPENAI_API_KEY</code> to the API environment
                    and restart it. The key stays on the server — it is never sent to this browser.
                  </p>
                </div>
              ) : null}

              {turns.length === 0 && status.data?.configured ? (
                <div className="pt-1">
                  <p className="text-[12px] text-ink-muted">
                    Ask anything about stock, production, demand or cost. Answers come from live records,
                    and only from what you are allowed to see.
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {SUGGESTED.map((s) => (
                      <li key={s}>
                        <button
                          onClick={() => send(s)}
                          className="glass-raised w-full rounded-xl px-3 py-2 text-left text-[12.5px] text-ink transition-transform hover:-translate-y-px"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ul className="space-y-3">
                {turns.map((t, i) => (
                  <li key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed',
                        t.role === 'user'
                          ? 'bg-ink text-canvas'
                          : 'glass-raised text-ink',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{t.content}</p>
                      {t.tools?.length ? (
                        <p className="mt-2 border-t border-line pt-1.5 text-[11px] text-ink-subtle">
                          Looked at: {[...new Set(t.tools)].map((x) => x.replace(/_/g, ' ')).join(', ')}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              {ask.isPending ? (
                <p className="mt-3 flex items-center gap-2 text-[12px] text-ink-muted">
                  <Loader2 className="size-3.5 animate-spin" /> Reading your records…
                </p>
              ) : null}

              {ask.error ? (
                <p className="mt-3 rounded-xl border border-line bg-surface-muted px-3.5 py-2.5 text-[12px] text-ink">
                  {(ask.error as { message?: string }).message ?? 'That did not go through. Try again.'}
                </p>
              ) : null}

              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); send(draft); }}
              className="border-t border-line p-3"
            >
              <div className="glass-raised flex items-end gap-2 rounded-xl p-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter writes a new line. The common
                    // case is one short question, so it gets the plain key.
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); }
                  }}
                  placeholder={status.data?.configured ? 'Ask a question…' : 'Connect a provider to ask'}
                  disabled={!status.data?.configured || ask.isPending}
                  className="max-h-28 min-h-[22px] flex-1 resize-none bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-subtle disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || !status.data?.configured || ask.isPending}
                  aria-label="Send"
                  className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-canvas transition-opacity disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" />
                </button>
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-ink-subtle">
                Read-only. It cannot change stock, approve anything, or send data to Shopify or Unicommerce.
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
