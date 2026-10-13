import { type Logger, type LoggerOptions, pino } from 'pino';

export type { Logger } from 'pino';

const isProd = process.env.NODE_ENV === 'production';

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: {
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'password_hash',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.secret',
      'CF_ACCESS_CLIENT_SECRET',
      'JWT_SECRET',
      'R2_SECRET_ACCESS_KEY',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
    ],
    censor: '[redacted]',
  },
};

// Query parameters whose values are credentials. Fastify logs every request's full
// URL, and `redact` above only matches object paths, not substrings of a string —
// so Meta's webhook handshake (`hub.verify_token`, sent in both spellings) and the
// email-verification `token` landed verbatim in logs until the URL was scrubbed here.
const SENSITIVE_QUERY_PARAMS = new Set([
  'hub.verify_token',
  'hub_verify_token',
  'token',
  'access_token',
  'id_token',
  'code',
  'hmac',
  'signature',
]);

export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const pairs = url
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      let name = rawName;
      try {
        // Match on the decoded name so `hub%2Everify_token` can't slip past.
        name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      } catch {
        // Malformed escape: fall back to the raw name.
      }
      return SENSITIVE_QUERY_PARAMS.has(name.toLowerCase()) ? `${rawName}=[redacted]` : pair;
    });
  return `${url.slice(0, q + 1)}${pairs.join('&')}`;
}

interface LoggedRequest {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remotePort?: number };
}

// Same shape as Fastify's default `req` serializer, with the URL scrubbed. Fastify
// lets a loggerInstance's own serializers override its defaults, so wiring this
// into createLogger covers every "incoming request" line.
export const requestSerializers = {
  req: (req: LoggedRequest) => ({
    method: req.method,
    url: redactUrl(req.url),
    version: req.headers?.['accept-version'],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  }),
};

const prettyTransport = !isProd
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,env',
        singleLine: false,
      },
    }
  : undefined;

export function createLogger(service: string, extra: Record<string, unknown> = {}): Logger {
  return pino({
    ...baseOptions,
    base: { ...baseOptions.base, service, ...extra },
    serializers: requestSerializers,
    ...(prettyTransport ? { transport: prettyTransport } : {}),
  });
}

export const rootLogger = createLogger('root');
