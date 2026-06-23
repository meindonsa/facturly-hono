import type { ErrorHandler } from 'hono';

// ---------------------------------------------------------------------------
// Gestion d'erreurs globale — monté via app.onError()
//
// Intercepte toutes les erreurs non gérées dans les handlers et middlewares
// et retourne une réponse JSON uniforme plutôt qu'une stack trace brute.
// ---------------------------------------------------------------------------

export const errorHandler: ErrorHandler = (err, c) => {
    console.error(`[error] ${c.req.method} ${c.req.path} →`, err.message);

    // Erreur HTTP Hono (ex: c.notFound(), HTTPException)
    if ('status' in err && typeof err.status === 'number') {
        return c.json(
            { error: err.message || 'HTTP Error' },
            err.status as Parameters<typeof c.json>[1]
        );
    }

    // Erreur inattendue — on ne fuit pas les détails en production
    return c.json(
        {
            error: 'Internal Server Error',
            ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
        },
        500
    );
};