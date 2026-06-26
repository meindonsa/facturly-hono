import { Hono }         from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, type AuthVariables } from '../middleware/auth.middleware.js'

const dashboard = new Hono<{ Variables: AuthVariables }>()

// ---------------------------------------------------------------------------
// GET /api/dashboard
// Protégé — calcul des statistiques + 5 dernières factures
// ---------------------------------------------------------------------------

dashboard.get('/', authMiddleware, async (c) => {
    const user = c.get('user')

    // 1. Récupérer la company de l'utilisateur
    const { data: company, error: compErr } = await supabaseAdmin
        .from('companies')
        .select('id, currency')
        .eq('owner_id', user.id)
        .single()

    if (compErr || !company) {
        return c.json({ error: 'Entreprise introuvable.' }, 404)
    }

    const now      = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const today    = now.toISOString().split('T')[0]

    // 2. Toutes les factures (champs légers pour le calcul)
    const { data: allInvoices, error: invErr } = await supabaseAdmin
        .from('invoices')
        .select('id, status, total, issued_at')
        .eq('company_id', company.id)

    if (invErr) {
        return c.json({ error: 'Impossible de charger les factures.' }, 500)
    }

    const invoices = allInvoices ?? []

    // 3. Calcul des statistiques côté serveur
    const monthInvoices = invoices.filter((inv) => inv.issued_at >= (firstDay ?? ''))

    const statistics = {
        totalPaidMonth: monthInvoices
            .filter((inv) => inv.status === 'paid')
            .reduce((sum, inv) => sum + inv.total, 0),

        totalPending: invoices
            .filter((inv) => inv.status === 'sent')
            .reduce((sum, inv) => sum + inv.total, 0),

        countMonth:   monthInvoices.length,

        countOverdue: invoices.filter(
            (inv) => inv.status === 'sent'
        ).length,

        countTotal: invoices.length,
    }

    // 4. Les 5 dernières factures (champs d'affichage)
    const { data: recentInvoices, error: recentErr } = await supabaseAdmin
        .from('invoices')
        .select('id, invoice_number, status, client_name, client_phone, total, issued_at')
        .eq('company_id', company.id)
        .order('issued_at', { ascending: false })
        .limit(5)

    if (recentErr) {
        return c.json({ error: 'Impossible de charger les factures récentes.' }, 500)
    }

    return c.json({
        statistics,
        invoices: recentInvoices ?? [],
    })
})

export { dashboard as dashboardRoutes }