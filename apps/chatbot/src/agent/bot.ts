import type { ChatMessageT } from '@aivastra/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { ChatbotDeps } from '../server.js';
import { makeAccountTools, makeSearchTool, newTurnCtx } from './tools.js';

export const FALLBACK_COPY =
  'I couldn\'t find an answer to that in our help articles. Could you rephrase, or tap "Talk to a human" and I\'ll connect you?';

const ROUTER_PROMPT = `You are the tool-routing step of the Aivastra support assistant.
Decide which tools (if any) are needed to answer the user's latest message, then call them.
- Use searchKnowledge for policy/how-to/pricing questions.
- Use getCredits / getRecentJobs for questions about the current user's own account.
- For greetings, small talk, or anything no tool can help with, call no tools.`;

const GEN_SYSTEM_PROMPT = `You are the Aivastra support assistant for logged-in users, writing the final reply.
- Only answer using the tool results provided below (if any). Never invent pricing, policy, or account data.
- If the tool results don't contain enough information to answer, or the user asks for a human, a refund, or has a billing complaint, reply with exactly: <escalate/>
- Keep answers short and friendly.`;

export interface BotResult {
  kind: 'answer' | 'fallback' | 'escalate';
  content: string;
  meta: { toolCalls: string[]; qnaIds: string[] };
}

function toLc(history: ChatMessageT[]): BaseMessage[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'bot')
    .map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)));
}

function extractText(msg: BaseMessage): string {
  return typeof msg.content === 'string'
    ? msg.content
    : msg.content
        .map((c: { type?: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : ''))
        .join('');
}

export async function runBotTurn(opts: {
  deps: ChatbotDeps;
  toolModel: BaseChatModel;
  genModel: BaseChatModel;
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

  const conversation = [...toLc(opts.history), new HumanMessage(opts.userMessage)];

  // --- router step: one decision pass, no loop-back ---
  if (!opts.toolModel.bindTools) {
    throw new Error('configured tool model does not support tool calling (bindTools missing)');
  }
  const boundToolModel = opts.toolModel.bindTools(tools);
  const routerResponse = await boundToolModel.invoke(
    [new SystemMessage(ROUTER_PROMPT), ...conversation],
    { signal: opts.signal },
  );

  const toolCalls = routerResponse.tool_calls ?? [];
  const toolMessages: ToolMessage[] = [];
  for (const call of toolCalls) {
    turnCtx.toolCalls.push(call.name);
    const target = tools.find((t) => t.name === call.name);
    const output = target ? await target.invoke(call.args) : `Unknown tool: ${call.name}`;
    toolMessages.push(
      new ToolMessage({
        content: String(output),
        tool_call_id: call.id ?? call.name,
        name: call.name,
      }),
    );
  }

  // --- generation step: writes the final reply; never calls tools itself ---
  const genMessages: BaseMessage[] = [
    new SystemMessage(GEN_SYSTEM_PROMPT),
    ...conversation,
    ...(toolCalls.length > 0 ? [routerResponse, ...toolMessages] : []),
  ];
  const genResponse = await opts.genModel.invoke(genMessages, { signal: opts.signal });
  const text = extractText(genResponse);

  const meta = { toolCalls: turnCtx.toolCalls, qnaIds: [...new Set(turnCtx.qnaIds)] };

  if (!text.trim()) return { kind: 'fallback', content: FALLBACK_COPY, meta };
  if (text.includes('<escalate/>')) return { kind: 'escalate', content: '', meta };

  const usedAccountTool = turnCtx.toolCalls.some(
    (n) => n === 'getCredits' || n === 'getRecentJobs',
  );
  if (turnCtx.searchCalled && !turnCtx.grounded && !usedAccountTool)
    return { kind: 'fallback', content: FALLBACK_COPY, meta };

  return { kind: 'answer', content: text, meta };
}
