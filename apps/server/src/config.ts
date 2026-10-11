import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TICK_RATE: z.coerce.number().int().min(10).max(120).default(30),
  SNAPSHOT_DIVISOR: z.coerce.number().int().min(1).max(10).default(2),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(2).max(64).default(16),
  MAX_ROOMS: z.coerce.number().int().min(1).max(1000).default(20),
  /** Per-IP cap on simultaneous sockets. Keep it generous: homes, schools and offices share one NAT IP. */
  MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(1000).default(20),
  /** Comma-separated Origin allow-list for WebSocket upgrades. Empty allows any origin. */
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Read the client IP from X-Forwarded-For (only enable behind a trusted reverse proxy). */
  TRUST_PROXY: bool,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
