import { createMiddleware } from 'hono/factory';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const EXPECTED = Buffer.from(env.APP_TOKEN, 'utf8');

export const appTokenMiddleware = createMiddleware(async (c, next) => {
    const token = c.req.header('X-App-Token');

    if (!token) {
        return c.json(
            { error: 'Unauthorized', message: 'H Access denied' },
            401
        );
    }

    const received = Buffer.from(token, 'utf8');

    const valid =
        received.length === EXPECTED.length &&
        timingSafeEqual(received, EXPECTED);

    if (!valid) {
        return c.json(
            { error: 'Unauthorized', message: 'H Invalid token.' },
            401
        );
    }
    await next();
});