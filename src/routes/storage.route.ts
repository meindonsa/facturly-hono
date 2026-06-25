import { Hono } from 'hono';
import { supabaseAdmin } from '../lib/supabase.js';
import { authMiddleware, USER_TOKEN_KEY, type AuthVariables } from '../middleware/auth.middleware.js';

const storage = new Hono<{ Variables: AuthVariables }>();

const MAX_SIZE_BYTES = 1024 * 1024 // 1 Mo
const ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
const BUCKET         = 'logos';

// ---------------------------------------------------------------------------
// POST /api/storage/upload-logo
// Protégé — upload du logo de l'entreprise vers Supabase Storage
// Content-Type : multipart/form-data
// Champ        : file (image)
// ---------------------------------------------------------------------------

storage.post('/upload-logo', authMiddleware, async (c) => {
    const user = c.get('user');

    // Lecture du multipart
    const formData = await c.req.formData();
    const file     = formData.get('file');

    if (!file || !(file instanceof File)) {
        return c.json({ error: 'Bad Request', message: 'Champ "file" manquant.' }, 400);
    }

    // Validation du type MIME
    if (!ALLOWED_TYPES.includes(file.type)) {
        return c.json({
            error:   'Bad Request',
            message: `Type de fichier non supporté. Types acceptés : ${ALLOWED_TYPES.join(', ')}.`,
        }, 400);
    }

    // Validation de la taille
    if (file.size > MAX_SIZE_BYTES) {
        return c.json({
            error:   'Bad Request',
            message: `Le fichier dépasse 500 Ko (taille reçue : ${Math.round(file.size / 1024)} Ko).`,
        }, 400);
    }

    // Chemin de stockage : logos/{user_id}/logo.{ext}
    const ext      = file.name.split('.').pop() ?? 'jpg';
    const filePath = `${user.id}/logo.${ext}`;

    // Conversion File → ArrayBuffer pour Supabase
    const buffer = await file.arrayBuffer();

    // Upload vers Supabase Storage (upsert pour remplacer l'existant)
    const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(filePath, buffer, {
            contentType: file.type,
            upsert:      true,
        });

    if (uploadError) {
        return c.json({ error: uploadError.message }, 500);
    }

    // Récupération de l'URL publique
    const { data: urlData } = supabaseAdmin.storage
        .from(BUCKET)
        .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Mise à jour de logo_url dans companies
    const { error: dbError } = await supabaseAdmin
        .from('companies')
        .update({ logo_url: publicUrl })
        .eq('owner_id', user.id);

    if (dbError) {
        return c.json({ error: dbError.message }, 500);
    }

    return c.json({ logo_url: publicUrl });
});

// ---------------------------------------------------------------------------
// DELETE /api/storage/delete-logo
// Protégé — supprime le logo de l'entreprise
// ---------------------------------------------------------------------------

storage.delete('/delete-logo', authMiddleware, async (c) => {
    const user = c.get('user');

    // On cherche le fichier existant (toutes extensions possibles)
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'svg'];
    const paths      = extensions.map((ext) => `${user.id}/logo.${ext}`);

    const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .remove(paths);

    if (error) return c.json({ error: error.message }, 500);

    // Mise à null dans companies
    await supabaseAdmin
        .from('companies')
        .update({ logo_url: null })
        .eq('owner_id', user.id);

    return c.json({ message: 'Logo supprimé.' });
});

export { storage as storageRoutes };