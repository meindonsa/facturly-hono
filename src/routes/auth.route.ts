import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { supabaseAdmin, createUserClient } from '../lib/supabase.js';
import { authMiddleware, USER_TOKEN_KEY, type AuthVariables } from '../middleware/auth.middleware.js';

const auth = new Hono<{ Variables: AuthVariables }>();

const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// Body : { email, password }
// Public — X-App-Token suffit
// ---------------------------------------------------------------------------

auth.post('/register', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();

    if (!body.email || !body.password) {
        return c.json({ error: 'Bad Request', message: 'email et password sont requis.' }, 400);
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
    });

    if (error) return c.json({ error: error.message }, 400);

    return c.json(
        { user: { id: data.user.id, email: data.user.email } },
        201
    );
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Body : { email, password }
// Public — X-App-Token suffit
// ---------------------------------------------------------------------------

auth.post('/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();

    if (!body.email || !body.password) {
        return c.json({ error: 'Bad Request', message: 'email et password sont requis.' }, 400);
    }

    const { data, error } = await anonClient.auth.signInWithPassword({
        email: body.email,
        password: body.password,
    });

    if (error || !data.session) {
        return c.json({ error: 'Unauthorized', message: 'Email ou mot de passe invalide.' }, 401);
    }

    return c.json({
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt:    data.session.expires_at,
        user: {
            id:    data.user.id,
            email: data.user.email,
            role:  data.user.role,
        },
    });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// Body : { refreshToken }
// Public — le refreshToken est la preuve d'identité
// ---------------------------------------------------------------------------

auth.post('/refresh', async (c) => {
    const body = await c.req.json<{ refreshToken?: string }>();

    if (!body.refreshToken) {
        return c.json({ error: 'Bad Request', message: 'refreshToken est requis.' }, 400);
    }

    const { data, error } = await anonClient.auth.refreshSession({
        refresh_token: body.refreshToken,
    });

    if (error || !data.session) {
        return c.json({ error: 'Unauthorized', message: 'Refresh token invalide ou expiré.' }, 401);
    }

    return c.json({
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt:    data.session.expires_at,
    });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// Protégé — révoque la session Supabase du token courant
// ---------------------------------------------------------------------------

auth.post('/logout', authMiddleware, async (c) => {
    const supabase = createUserClient(c.get(USER_TOKEN_KEY));
    const { error } = await supabase.auth.signOut();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ message: 'Déconnecté avec succès.' });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Protégé — profil de l'utilisateur courant
// ---------------------------------------------------------------------------

auth.get('/me', authMiddleware, (c) => {
    const user = c.get('user');
    return c.json({
        id:       user.id,
        email:    user.email,
        role:     user.role,
        metadata: user.user_metadata,
    });
});

export { auth as authRoutes };