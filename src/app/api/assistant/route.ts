import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { buildAssistantTools } from "@/lib/ai/tools";
import { todayIso } from "@/lib/data";

export const maxDuration = 120;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

function systemPrompt(): string {
  const today = todayIso();
  return `You are the financial assistant inside Meridian, the user's private personal-finance dashboard. Today's date is ${today}.

Rules:
- NEVER invent, estimate, or compute financial figures yourself. Every number you state must come from a tool result — the tools do all arithmetic on the actual transaction database.
- Call tools to answer any question about balances, spending, income, transactions, subscriptions, or net worth. If a question spans multiple aspects, call multiple tools.
- Transfers between the user's own accounts and credit-card payments are neither income nor spending; the tools already exclude them.
- Amounts in tool results follow this convention: positive transaction amounts are money out, negative are money in. Aggregates (totalSpending, totalIncome) are already positive numbers.
- Format money as $1,234.56. Be concise — usually a short answer plus one or two supporting details. Add a brief comparison to a prior period when it is genuinely helpful.
- If the data can't answer the question, say so plainly rather than guessing.
- Politely decline questions unrelated to the user's finances.`;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI assistant is not configured. Add ANTHROPIC_API_KEY to .env.local.",
      },
      { status: 501 },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

  try {
    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 4096,
      system: systemPrompt(),
      tools: buildAssistantTools(),
      messages: parsed.data.messages,
      max_iterations: 8,
    });

    const toolCalls: { name: string; input: unknown }[] = [];
    let finalMessage: Anthropic.Beta.BetaMessage | null = null;
    for await (const message of runner) {
      finalMessage = message;
      for (const block of message.content) {
        if (block.type === "tool_use") {
          toolCalls.push({ name: block.name, input: block.input });
        }
      }
    }

    const reply =
      finalMessage?.content
        .filter(
          (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text",
        )
        .map((b) => b.text)
        .join("\n")
        .trim() ?? "";

    return NextResponse.json({
      reply: reply || "I wasn't able to produce an answer — try rephrasing.",
      toolCalls,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      // no request/response details in the client-facing error
      return NextResponse.json(
        { error: "The AI service returned an error. Try again shortly." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Assistant failed unexpectedly." },
      { status: 500 },
    );
  }
}
