import type { ChatbotDeps } from '../server.js';
import { appendMessage, getOrCreateActiveConversation, reopenIfResolved } from './service.js';

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
  ): Promise<void> {
    const { deps } = this;
    await this.enqueue(convId, async () => {
      await reopenIfResolved(deps.db, deps.pub, convId);
      await appendMessage(deps.db, deps.pub, convId, {
        role: 'user',
        senderId: userId,
        content,
        attachmentKey: attachmentKey ?? null,
      });
    });
  }
}

export { getOrCreateActiveConversation };
