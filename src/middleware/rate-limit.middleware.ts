import { createMiddleware } from 'hono/factory';
import { env } from '../config/env.js';

interface WindowEntry {
    count: number;
    resetAt: number;
}

const store = new Map<string, WindowEntry>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // toutes les 5 minutes

function cleanup(): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    for (const [key, entry] of store.entries()) {
        if (now >= entry.resetAt) store.delete(key);
    }
}

function resolveIp(c: Parameters<typeof createMiddleware>[0] extends (c: infer C, ...args: any[]) => any ? C : never): string {
    const forwarded = c.req.header('X-Forwarded-For');
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return c.req.header('X-Real-IP') ?? 'unknown';
}

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
    cleanup();

    const ip = resolveIp(c);
    const now = Date.now();

    let entry = store.get(ip);

    if (!entry || now >= entry.resetAt) {
        entry = { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS };
        store.set(ip, entry);
    } else {
        entry.count++;
    }

    const remaining = Math.max(0, env.RATE_LIMIT_MAX - entry.count);
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);

    // Headers informatifs (exposés via CORS exposeHeaders)
    c.header('X-RateLimit-Limit', String(env.RATE_LIMIT_MAX));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > env.RATE_LIMIT_MAX) {
        c.header('Retry-After', String(retryAfterSec));
        return c.json(
            {
                error: 'Too Many Requests',
                message: `Limite de ${env.RATE_LIMIT_MAX} requêtes par ${env.RATE_LIMIT_WINDOW_MS / 1000}s atteinte.`,
                retryAfter: retryAfterSec,
            },
            429
        );
    }
    await next();
});