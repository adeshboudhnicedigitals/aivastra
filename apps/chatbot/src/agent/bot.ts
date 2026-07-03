import type { ChatMessageT } from '@aivastra/types';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { Env } from '../env.js';
import type { ChatbotDeps } from '../server.js';
import { makeAccountTools, makeSearchTool, newTurnCtx } from './tools.js';

export const FALLBACK_COPY =
  'I couldn\'t find an answer to that in our help articles. Could you rephrase, or tap "Talk to a human" and I\'ll connect you?';

const SYSTEM_PROMPT = `You are the Aivastra support assistant for logged-in users.
- Use searchKnowledge for policy/how-to/pricing questions. Only answer from its results.
- Use getCredits / getRecentJobs for questions about the current user's own account.
- If you cannot answer from the knowledge base or the account tools, or the user asks for
  a human, a refund, or has a billing complaint, reply with exactly: <escalate/>
- Never invent pricing, policy, or account data. Keep answers short and friendly.`;

export interface BotResult {
  kind: 'answer' | 'fallback' | 'escalate';
  content: string;
  meta: { toolCalls: string[]; qnaIds: string[] };
}

export function makeProdModel(env: Env): BaseChatModel {
  return new ChatAnthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.CHATBOT_GEN_MODEL,
    temperature: 0.2,
    maxTokens: 1024,
  });
}

function toLc(history: ChatMessageT[]): BaseMessage[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'bot')
    .map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)));
}

export async function runBotTurn(opts: {
  deps: ChatbotDeps;
  model: BaseChatModel;
  userId: string;
  convId: string;
  history: ChatMessageT[];
  userMessage: string;
  signal: AbortSignal;
}): Promise<BotResult> {
  const { deps } = opts;
  const turnCtx = newTurnCtx();
  const tools = [
    makeSearchTool(deps.db, deps.embed, deps.env, turnCtx),
    ...makeAccountTools(deps.db, opts.userId),
  ];

  const agent = createReactAgent({ llm: opts.model, tools, prompt: SYSTEM_PROMPT });
  const result = await agent.invoke(
    { messages: [...toLc(opts.history), new HumanMessage(opts.userMessage)] },
    {
      signal: opts.signal,
      recursionLimit: deps.env.CHATBOT_MAX_TOOL_ITERATIONS * 2 + 2,
    },
  );

  const last = result.messages[result.messages.length - 1];
  if (!last)
    return {
      kind: 'fallback' as const,
      content: FALLBACK_COPY,
      meta: { toolCalls: [], qnaIds: [] },
    };
  const text =
    typeof last.content === 'string'
      ? last.content
      : last.content
          .map((c: { type?: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : ''))
          .join('');
  if (!text.trim())
    return { kind: 'fallback', content: FALLBACK_COPY, meta: { toolCalls: [], qnaIds: [] } };
  turnCtx.toolCalls = result.messages
    .filter((m: BaseMessage) => m.getType() === 'tool')
    .map((m: BaseMessage & { name?: string }) => m.name ?? 'tool');

  const meta = { toolCalls: turnCtx.toolCalls, qnaIds: [...new Set(turnCtx.qnaIds)] };

  if (text.includes('<escalate/>')) return { kind: 'escalate', content: '', meta };

  const usedAccountTool = turnCtx.toolCalls.some(
    (n) => n === 'getCredits' || n === 'getRecentJobs',
  );
  if (turnCtx.searchCalled && !turnCtx.grounded && !usedAccountTool)
    return { kind: 'fallback', content: FALLBACK_COPY, meta };

  return { kind: 'answer', content: text, meta };
}
