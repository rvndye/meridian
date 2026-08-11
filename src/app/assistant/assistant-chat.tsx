"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { Sparkles, Send, Wrench } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: unknown }[];
}

const EXAMPLES = [
  "How much did I spend on restaurants last month?",
  "What was my biggest expense this month?",
  "What subscriptions am I paying for?",
  "How much did I spend at Amazon in the last six months?",
  "Why was my spending higher this month?",
  "How much money did I save last month?",
];

/** Minimal inline-markdown renderer: only **bold**, which the model uses for figures. */
function renderContent(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

const TOOL_LABELS: Record<string, string> = {
  get_account_balances: "Looked up account balances",
  get_net_worth: "Computed net worth",
  get_spending_by_category: "Analyzed spending by category",
  get_income: "Analyzed income",
  get_cash_flow: "Computed cash flow",
  get_transactions: "Searched transactions",
  get_recurring_transactions: "Checked recurring transactions",
  compare_periods: "Compared periods",
  get_spending_by_merchant: "Analyzed merchants",
};

export function AssistantChat({ configured }: { configured: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply, toolCalls: data.toolCalls },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setTimeout(
        () => scrollRef.current?.scrollTo({ top: 1e6, behavior: "smooth" }),
        50,
      );
    }
  }

  if (!configured) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkles size={18} />
        </span>
        <h2 className="text-[15px] font-semibold">Assistant not configured</h2>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-2">
          Add{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">
            ANTHROPIC_API_KEY
          </code>{" "}
          to <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">.env.local</code>{" "}
          and restart the app. The rest of the dashboard works without it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-180px)] min-h-[420px] flex-col rounded-lg border border-border bg-surface">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Sparkles size={18} />
            </span>
            <p className="mb-4 max-w-sm text-[13px] text-ink-2">
              Ask anything about your spending, income, subscriptions, or net
              worth.
            </p>
            <div className="flex max-w-lg flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={clsx(
                "max-w-[85%]",
                m.role === "user" ? "self-end" : "self-start",
              )}
            >
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {m.toolCalls.map((t, j) => (
                    <span
                      key={j}
                      className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-3"
                    >
                      <Wrench size={10} />
                      {TOOL_LABELS[t.name] ?? t.name}
                    </span>
                  ))}
                </div>
              )}
              <div
                className={clsx(
                  "whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "bg-ink text-white"
                    : "border border-border bg-surface-2 text-ink",
                )}
              >
                {m.role === "assistant" ? renderContent(m.content) : m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="self-start rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-3">
              Analyzing your data…
            </div>
          )}
          {error && (
            <div className="self-start rounded-lg border border-neg/30 bg-neg-soft px-3.5 py-2.5 text-[13px] text-neg">
              {error}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your finances…"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-ink text-white disabled:opacity-40"
          aria-label="Send"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
