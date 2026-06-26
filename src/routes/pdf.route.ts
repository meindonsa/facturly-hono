import { Hono }        from 'hono';
import PDFDocument      from 'pdfkit';
import { supabaseAdmin } from '../lib/supabase.js';
import { authMiddleware, type AuthVariables } from '../middleware/auth.middleware.js';

const pdf = new Hono<{ Variables: AuthVariables }>();

// ---------------------------------------------------------------------------
// Types locaux
// ---------------------------------------------------------------------------

interface InvoiceItem {
    description: string
    quantity:    number
    unit_price:  number
    total:       number
}

interface Invoice {
    id:                   string
    invoice_number:       string
    status:               string
    client_name:          string
    client_phone:         string
    client_email:         string | null
    client_address:       string | null
    client_tax_id:        string | null
    issued_at:            string
    due_at:               string | null
    total_product:        number
    total_product_amount: number
    delivery_amount:      number
    total:                number
    notes:                string | null
    company_id:           string
}

interface Company {
    name:      string
    email:     string | null
    phone:     string
    address:   string | null
    city:      string | null
    country:   string | null
    tax_id:    string | null
    logo_url:  string | null
    currency:  string
    owner_id:  string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFCFA(amount: number): string {
    // toLocaleString produit des espaces insécables (\u00A0) mal gérés par pdfkit
    // On formate manuellement avec un espace normal
    return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA'
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
        day:   'numeric',
        month: 'long',
        year:  'numeric',
    })
}

function statusLabel(status: string): string {
    const labels: Record<string, string> = {
        draft:     'Brouillon',
        sent:      'Envoyée',
        paid:      'Payée',
        cancelled: 'Annulée',
    }
    return labels[status] ?? status
}

// Génère le PDF en mémoire et retourne un Buffer
async function generateInvoicePDF(
    invoice: Invoice,
    items:   InvoiceItem[],
    company: Company,
    logoBuffer: Buffer | null,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size:    'A4',
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
        })

        const chunks: Buffer[] = []
        doc.on('data',  (chunk: Buffer) => chunks.push(chunk))
        doc.on('end',   () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const W     = doc.page.width  - 100  // largeur utile
        const BLUE  = '#185FA5'
        const GRAY  = '#535250'
        const LIGHT = '#F1F0EE'
        const BLACK = '#141413'

        // ── En-tête ────────────────────────────────────────────────
        let headerY = 50

        // Logo (si disponible)
        if (logoBuffer) {
            try {
                doc.image(logoBuffer, 50, headerY, { height: 60, fit: [120, 60] })
            } catch { /* ignore si image invalide */ }
        }

        // Nom entreprise + infos
        const infoX = logoBuffer ? 185 : 50
        doc.font('Helvetica-Bold').fontSize(16).fillColor(BLACK)
            .text(company.name, infoX, headerY)

        doc.font('Helvetica').fontSize(9).fillColor(GRAY)
        let infoY = headerY + 22
        if (company.address) {
            doc.text(company.address, infoX, infoY)
            infoY += 13
        }
        if (company.city || company.country) {
            doc.text([company.city, company.country].filter(Boolean).join(', '), infoX, infoY)
            infoY += 13
        }
        if (company.phone) {
            doc.text(company.phone, infoX, infoY)
            infoY += 13
        }
        if (company.email) {
            doc.text(company.email, infoX, infoY)
            infoY += 13
        }
        if (company.tax_id) {
            doc.text(`RCCM / N° fiscal : ${company.tax_id}`, infoX, infoY)
        }

        // Numéro + statut (droite)
        doc.font('Helvetica-Bold').fontSize(22).fillColor(BLUE)
            .text('FACTURE', 50, headerY, { align: 'right', width: W })

        doc.font('Helvetica').fontSize(10).fillColor(GRAY)
            .text(invoice.invoice_number, 50, headerY + 28, { align: 'right', width: W })

        doc.font('Helvetica-Bold').fontSize(9)
            .fillColor(invoice.status === 'paid' ? '#3B6D11' : BLUE)
            .text(statusLabel(invoice.status).toUpperCase(), 50, headerY + 44, { align: 'right', width: W })

        // ── Ligne séparatrice ──────────────────────────────────────
        const sepY = Math.max(infoY, headerY + 70) + 15
        doc.moveTo(50, sepY).lineTo(50 + W, sepY)
            .strokeColor(LIGHT).lineWidth(1).stroke()

        // ── Bloc client + dates ────────────────────────────────────
        const blockY = sepY + 20

        // Client (gauche)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
            .text('FACTURÉ À', 50, blockY)
        doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK)
            .text(invoice.client_name, 50, blockY + 14)
        doc.font('Helvetica').fontSize(9).fillColor(GRAY)

        let clientY = blockY + 28
        doc.text(invoice.client_phone, 50, clientY); clientY += 13
        if (invoice.client_email)   { doc.text(invoice.client_email,   50, clientY); clientY += 13 }
        if (invoice.client_address) { doc.text(invoice.client_address, 50, clientY); clientY += 13 }
        if (invoice.client_tax_id)  { doc.text(`N° fiscal : ${invoice.client_tax_id}`, 50, clientY) }

        // Dates (droite)
        const dateX = 50 + W - 160
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
            .text('DATE D\'ÉMISSION', dateX, blockY)
        doc.font('Helvetica').fontSize(10).fillColor(BLACK)
            .text(formatDate(invoice.issued_at), dateX, blockY + 14)

        if (invoice.due_at) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
                .text('ÉCHÉANCE', dateX, blockY + 36)
            doc.font('Helvetica').fontSize(10).fillColor(BLACK)
                .text(formatDate(invoice.due_at), dateX, blockY + 50)
        }

        // ── Tableau des lignes ─────────────────────────────────────
        const tableY = Math.max(clientY, blockY + 80) + 25

        // En-tête tableau
        doc.rect(50, tableY, W, 24).fill(BLUE)
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF')
        const cols = { desc: 50, qty: 310, price: 380, total: 460 }
        doc.text('Description',    cols.desc  + 8, tableY + 7)
        doc.text('Qté',            cols.qty   + 4, tableY + 7)
        doc.text('Prix unit.',     cols.price + 4, tableY + 7)
        doc.text('Total',          cols.total + 4, tableY + 7)

        // Lignes
        let rowY = tableY + 24
        items.forEach((item, i) => {
            const bg = i % 2 === 0 ? '#FFFFFF' : LIGHT
            doc.rect(50, rowY, W, 22).fill(bg)
            doc.font('Helvetica').fontSize(9).fillColor(BLACK)
            doc.text(item.description,           cols.desc  + 8, rowY + 6, { width: 250, ellipsis: true })
            doc.text(String(item.quantity),      cols.qty   + 4, rowY + 6)
            doc.text(formatFCFA(item.unit_price), cols.price + 4, rowY + 6)
            doc.text(formatFCFA(item.total),     cols.total + 4, rowY + 6)
            rowY += 22
        })

        // ── Totaux ─────────────────────────────────────────────────
        const totalsX = 50 + W - 220
        rowY += 15

        // Sous-total produits
        doc.font('Helvetica').fontSize(9).fillColor(GRAY)
            .text(`${invoice.total_product} article(s)`, totalsX, rowY, { width: 110, align: 'right' })
        doc.fillColor(BLACK)
            .text(formatFCFA(invoice.total_product_amount), totalsX + 120, rowY, { width: 100, align: 'right' })
        rowY += 16

        // Livraison
        doc.font('Helvetica').fontSize(9).fillColor(GRAY)
            .text('Livraison', totalsX, rowY, { width: 110, align: 'right' })
        doc.fillColor(BLACK)
            .text(formatFCFA(invoice.delivery_amount), totalsX + 120, rowY, { width: 100, align: 'right' })
        rowY += 10

        // Ligne séparatrice totaux
        doc.moveTo(totalsX, rowY).lineTo(50 + W, rowY)
            .strokeColor(GRAY).lineWidth(0.5).stroke()
        rowY += 10

        // Total final
        doc.rect(totalsX, rowY, 220, 28).fill(BLUE)
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
            .text('TOTAL', totalsX + 8, rowY + 8, { width: 100 })
        doc.text(formatFCFA(invoice.total), totalsX + 110, rowY + 8, { width: 102, align: 'right' })
        rowY += 44

        // ── Notes ──────────────────────────────────────────────────
        if (invoice.notes) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
                .text('NOTES', 50, rowY)
            doc.font('Helvetica').fontSize(9).fillColor(BLACK)
                .text(invoice.notes, 50, rowY + 12, { width: W })
        }

        doc.end()
    })
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/pdf
// Protégé — génère et retourne le PDF de la facture en téléchargement
// ---------------------------------------------------------------------------

pdf.get('/:id/pdf', authMiddleware, async (c) => {
    const id   = c.req.param('id')
    const user = c.get('user')

    // 1. Charger la facture
    const { data: invoice, error: invErr } = await supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('id', id)
        .single()

    if (invErr || !invoice) {
        return c.json({ error: 'Facture introuvable.' }, 404)
    }

    // 2. Vérifier que la facture appartient à l'utilisateur
    const { data: company, error: compErr } = await supabaseAdmin
        .from('companies')
        .select('*')
        .eq('id', invoice.company_id)
        .eq('owner_id', user.id)
        .single()

    if (compErr || !company) {
        return c.json({ error: 'Accès non autorisé.' }, 403)
    }

    // 3. Charger les lignes
    const { data: items, error: itemsErr } = await supabaseAdmin
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', id)
        .order('created_at', { ascending: true })

    if (itemsErr) {
        return c.json({ error: 'Impossible de charger les lignes.' }, 500)
    }

    // 4. Charger le logo (si présent)
    let logoBuffer: Buffer | null = null
    if (company.logo_url) {
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 5000) // 5s max pour le logo
            const res = await fetch(company.logo_url, { signal: controller.signal })
            clearTimeout(timer)
            if (res.ok) {
                logoBuffer = Buffer.from(await res.arrayBuffer())
            }
        } catch { /* logo optionnel, on continue sans */ }
    }

    // 5. Générer le PDF en mémoire
    const pdfBuffer = await generateInvoicePDF(
        invoice  as Invoice,
        (items ?? []) as InvoiceItem[],
        company  as Company,
        logoBuffer,
    )

    // 6. Retourner le PDF en téléchargement
    const filename  = `${invoice.invoice_number}.pdf`
    const uint8     = new Uint8Array(pdfBuffer)
    return new Response(uint8, {
        headers: {
            'Content-Type':        'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length':      String(uint8.byteLength),
        },
    })
})

export { pdf as pdfRoutes }