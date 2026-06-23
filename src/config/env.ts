import 'dotenv/config';
import { z } from 'zod';


const envSchema = z.object({
    PORT: z
        .string()
        .default('3000')
        .transform(Number)
        .pipe(z.number().int().min(1).max(65535)),

    APP_TOKEN: z
        .string()
        .min(16, 'APP_TOKEN doit faire au moins 16 caractères'),

    ALLOWED_ORIGINS: z
        .string()
        .transform((val) =>
            val
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
        )
        .pipe(
            z
                .array(z.string().url('Chaque origine doit être une URL valide'))
                .min(1, 'Au moins une origine CORS est requise')
        ),

    // Supabase
    SUPABASE_URL: z.string().url('SUPABASE_URL doit être une URL valide'),
    SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY est requise'),
    SUPABASE_SERVICE_ROLE_KEY: z
        .string()
        .min(1, 'SUPABASE_SERVICE_ROLE_KEY est requise'),


    // Rate limiting
    RATE_LIMIT_WINDOW_MS: z
        .string()
        .default('60000')
        .transform(Number)
        .pipe(z.number().int().positive()),

    RATE_LIMIT_MAX: z
        .string()
        .default('100')
        .transform(Number)
        .pipe(z.number().int().positive()),
});

// ---------------------------------------------------------------------------
// Parsing — le serveur plante au démarrage si une variable est manquante
// ---------------------------------------------------------------------------

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;

    console.error('');
    console.error('❌  Variables d\'environnement invalides ou manquantes :');
    console.error('');

    for (const [field, messages] of Object.entries(errors)) {
        for (const message of messages ?? []) {
            console.error(`   • ${field}: ${message}`);
        }
    }

    console.error('');
    console.error('   → Vérifiez votre fichier .env (voir .env.example)');
    console.error('');

    process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;