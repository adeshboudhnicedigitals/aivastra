export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'development') {
    process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET') return;
      throw err;
    });
  }
}
