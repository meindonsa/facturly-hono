import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Client ADMIN — service role key, contourne les RLS
// Réservé aux actions privilégiées : gestion des utilisateurs, triggers
// internes, accès cross-tenant, etc.
//
// ⚠️  Ne jamais exposer ce client ni sa clé côté client.
//     L'utiliser uniquement dans les routes admin explicitement sécurisées.
// ---------------------------------------------------------------------------

export const supabaseAdmin = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            // Pas de persistance de session côté serveur
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
    }
);

// ---------------------------------------------------------------------------
// Client USER — scoped au JWT de l'utilisateur, respecte les RLS
// À créer à chaque requête avec le token extrait par authMiddleware.
//
// Usage dans un handler protégé :
//   import { createUserClient } from '../lib/supabase.ts';
//   import { USER_TOKEN_KEY } from '../middleware/auth.ts';
//
//   app.get('/items', authMiddleware, async (c) => {
//     const supabase = createUserClient(c.get(USER_TOKEN_KEY));
//     const { data } = await supabase.from('items').select();
//     return c.json(data);
//   });
// ---------------------------------------------------------------------------

export function createUserClient(jwt: string) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: {
            headers: { Authorization: `Bearer ${jwt}` },
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
    });
}