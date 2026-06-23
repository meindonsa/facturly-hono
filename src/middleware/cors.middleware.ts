import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import {env} from "../config/env.js";

const honoCorsMw = cors({
    origin: (origin) => {
        if (!origin) return null;
        return env.ALLOWED_ORIGINS.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-App-Token'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 600,
    credentials: true,
});

const originGuard = createMiddleware(async (c, next) => {
    const origin = c.req.header('Origin');

    if (!origin) {
        await next();
        return;
    }

    if (!env.ALLOWED_ORIGINS.includes(origin)) {
        return c.json(
            { error: 'Forbidden', message: 'Origin not allowed' },
            403
        );
    }

    await next();
});

export const corsMiddleware = [originGuard, honoCorsMw] as const;