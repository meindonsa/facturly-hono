import { Hono } from 'hono';
import { createUserClient } from '../lib/supabase.js';
import { authMiddleware, USER_TOKEN_KEY, type AuthVariables } from '../middleware/auth.middleware.js';

const db = new Hono<{ Variables: AuthVariables }>();

// Toutes les routes database sont protégées
db.use('*', authMiddleware);

// ---------------------------------------------------------------------------
// Validation du nom de table
// Whitelist explicite pour éviter qu'un client n'accède à n'importe quelle
// table en changeant le path. À adapter avec tes vraies tables.
// ---------------------------------------------------------------------------

const ALLOWED_TABLES = new Set([
    // Facturly
    'profiles',
    'companies',
    'invoices',
    'invoice_items',
]);


// Tables qui nécessitent l'injection automatique de owner_id depuis le JWT
const OWNER_ID_TABLES = new Set(['companies']);

function isTableAllowed(table: string): boolean {
    return ALLOWED_TABLES.has(table);
}

function tableGuard(table: string, c: Parameters<typeof authMiddleware>[0]) {
    if (!isTableAllowed(table)) {
        return c.json(
            { error: 'Not Found', message: `Table "${table}" introuvable ou non autorisée.` },
            404
        );
    }
    return null;
}

// ---------------------------------------------------------------------------
// GET /api/db/:table
// Query params supportés :
//   ?select=col1,col2    → colonnes à retourner (défaut : *)
//   ?limit=20            → pagination (défaut : 20, max : 100)
//   ?offset=0            → offset
//   ?order=col:asc|desc  → tri (ex: created_at:desc)
//   ?[col]=valeur        → filtre égalité (ex: ?status=active)
// ---------------------------------------------------------------------------

db.get('/:table', async (c) => {
    const table = c.req.param('table');
    const guard = tableGuard(table, c);
    if (guard) return guard;

    const supabase = createUserClient(c.get(USER_TOKEN_KEY));

    const select = c.req.query('select') ?? '*';
    const limit  = Math.min(Number(c.req.query('limit')  ?? 20), 100);
    const offset = Number(c.req.query('offset') ?? 0);
    const order  = c.req.query('order'); // ex: "created_at:desc"

    let query = supabase.from(table).select(select, { count: 'exact' });

    // Filtres dynamiques : tout query param autre que les réservés
    const RESERVED = new Set(['select', 'limit', 'offset', 'order']);
    for (const [key, value] of Object.entries(c.req.queries() ?? {})) {
        if (!RESERVED.has(key)) query = query.eq(key, value[0]);
    }

    // Tri
    if (order) {
        const [col, direction] = order.split(':');
        if (col) query = query.order(col, { ascending: direction !== 'desc' });
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) return c.json({ error: error.message }, 500);

    return c.json({ data, meta: { total: count, limit, offset } });
});

// ---------------------------------------------------------------------------
// GET /api/db/:table/:id
// Récupère un enregistrement par sa clé primaire (colonne `id`)
// ---------------------------------------------------------------------------

db.get('/:table/:id', async (c) => {
    const table = c.req.param('table');
    const id    = c.req.param('id');
    const guard = tableGuard(table, c);
    if (guard) return guard;

    const supabase = createUserClient(c.get(USER_TOKEN_KEY));
    const select   = c.req.query('select') ?? '*';

    const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq('id', id)
        .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!data)  return c.json({ error: 'Not Found', message: `Enregistrement introuvable.` }, 404);

    return c.json(data);
});

// ---------------------------------------------------------------------------
// POST /api/db/:table
// Body : objet ou tableau d'objets à insérer
// ---------------------------------------------------------------------------

db.post('/:table', async (c) => {
    const table = c.req.param('table');
    const guard = tableGuard(table, c);
    if (guard) return guard;

    const supabase = createUserClient(c.get(USER_TOKEN_KEY));
    let body       = await c.req.json();

    // Injection automatique de owner_id depuis le JWT pour les tables concernées
    if (OWNER_ID_TABLES.has(table)) {
        const user = c.get('user');
        body = Array.isArray(body)
            ? body.map((row: Record<string, unknown>) => ({ ...row, owner_id: user.id }))
            : { ...body, owner_id: user.id };
    }

    const { data, error } = await supabase.from(table).insert(body).select();

    if (error) return c.json({ error: error.message }, 400);

    return c.json(data, 201);
});

// ---------------------------------------------------------------------------
// PATCH /api/db/:table/:id
// Body : champs à mettre à jour (mise à jour partielle)
// ---------------------------------------------------------------------------

db.patch('/:table/:id', async (c) => {
    const table = c.req.param('table');
    const id    = c.req.param('id');
    const guard = tableGuard(table, c);
    if (guard) return guard;

    const supabase = createUserClient(c.get(USER_TOKEN_KEY));
    const body     = await c.req.json();

    const { data, error } = await supabase
        .from(table)
        .update(body)
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) return c.json({ error: error.message }, 400);
    if (!data)  return c.json({ error: 'Not Found', message: 'Enregistrement introuvable.' }, 404);

    return c.json(data);
});

// ---------------------------------------------------------------------------
// DELETE /api/db/:table/:id
// ---------------------------------------------------------------------------

db.delete('/:table/:id', async (c) => {
    const table = c.req.param('table');
    const id    = c.req.param('id');
    const guard = tableGuard(table, c);
    if (guard) return guard;

    const supabase = createUserClient(c.get(USER_TOKEN_KEY));

    const { error } = await supabase.from(table).delete().eq('id', id);

    if (error) return c.json({ error: error.message }, 400);

    return c.body(null, 204);
});

export { db as databaseRoutes };