// Redis client timeouts alone cannot enforce cancellation's remaining outer deadline.
export async function boundedRead<T>(read: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) throw new Error('authorization deadline exhausted');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('authorization read timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
