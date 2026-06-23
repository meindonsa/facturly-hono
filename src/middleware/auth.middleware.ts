import { createMiddleware } from 'hono/factory';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Clé de contexte Hono — partagée entre ce middleware et les routes
// ---------------------------------------------------------------------------

export const USER_TOKEN_KEY = 'userToken' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBearer(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token?.trim()) return null;
    return token.trim();
}

export const authMiddleware = createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = extractBearer(authHeader);

    if (!token) {
        return c.json(
            {
                error: 'Unauthorized',
                message: 'Header Authorization manquant ou malformé. Format attendu : Bearer <token>',
            },
            401
        );
    }

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
        return c.json(
            {
                error: 'Unauthorized',
                message: 'Token invalide ou expiré.',
            },
            401
        );
    }

    c.set(USER_TOKEN_KEY, token);
    c.set('user', data.user);

    await next();
});

import type { User } from '@supabase/supabase-js';

export type AuthVariables = {
    [USER_TOKEN_KEY]: string;
    user: User;
};