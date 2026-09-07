import type { ChatbotDeps } from '../server.js';
import {
  appendMessage,
  getOrCreateActiveConversation,
  reopenIfResolved,
  setSubjectFromFirstMessage,
} from './service.js';

export class Orchestrator {
  private inflight = new Map<string, AbortController>();
  private chains = new Map<string, Promise<void>>();

  constructor(private deps: ChatbotDeps) {}

  private enqueue(convId: string, fn: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(convId) ?? Promise.resolve()).then(fn, fn);
    this.chains.set(convId, next);
    return next;
  }

  terminate(convId: string): void {
    this.inflight.get(convId)?.abort();
    this.inflight.delete(convId);
  }

  async handleUserMessage(
    convId: string,
    userId: string,
    content: string,
    attachmentKey?: string,
    attachmentType?: string,
  ): Promise<void> {
    const { deps } = this;
    await this.enqueue(convId, async () => {
      await reopenIfResolved(deps.db, deps.pub, convId);
      // The ticket exists before any message does (it's created at WS connect), so
      // the subject can only be derived here, on the first user message to land.
      await setSubjectFromFirstMessage(deps.db, convId, content);
      await appendMessage(deps.db, deps.pub, convId, {
        role: 'user',
        senderId: userId,
        content,
        attachmentKey: attachmentKey ?? null,
        attachmentType: attachmentType ?? null,
      });
    });
  }
}

export { getOrCreateActiveConversation };
