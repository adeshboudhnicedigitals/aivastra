import { assertNever, type WaitForCompletionResult } from './progress.js';

// Every caller must return before fetching outputs when cleanup exhaustion is terminal.
export async function handleCompletionResult(
  result: WaitForCompletionResult,
  terminate: () => Promise<void>,
): Promise<boolean> {
  switch (result.status) {
    case 'completed':
      return false;
    case 'queue_cleanup_failed':
      await terminate();
      return true;
    default:
      return assertNever(result);
  }
}
