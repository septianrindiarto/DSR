import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

// ─── Company-wide letter numbering ───────────────────────────────────────────
// Formal documents (surat pengantar tagihan, penawaran, invoice cover, …) share
// ONE incrementing letter number per organization per year, formatted as
// "No.<YY>/DSR/<seq3>" e.g. "No.26/DSR/070". Distinct from the invoice number.
//
// getNextLetterNumber reserves and returns the next number atomically:
// the INSERT ... ON CONFLICT DO UPDATE bumps last_seq in a single statement, so
// concurrent callers can never get the same value. On the first call of a new
// year the row is created at 1 (sequence resets each January). The 2026 row is
// pre-seeded to 69 by the migration so the first generated number is 070.

export const documentService = {
    async getNextLetterNumber(organizationId) {
        const orgId = Number(organizationId) || 1;
        const year = new Date().getFullYear();

        const result = await db.execute(sql`
            INSERT INTO letter_counters (organization_id, year, last_seq)
            VALUES (${orgId}, ${year}, 1)
            ON CONFLICT (organization_id, year)
            DO UPDATE SET last_seq = letter_counters.last_seq + 1, updated_at = NOW()
            RETURNING last_seq
        `);
        const row = (result.rows ?? result)[0];
        const seq = Number(row?.last_seq) || 1;
        const yy = String(year).slice(-2);
        const letterNumber = `No.${yy}/DSR/${String(seq).padStart(3, '0')}`;
        return { letterNumber, seq, year };
    },

    /**
     * Surat pengantar number for a kode transaksi (owner 2026-11-13): reuse the
     * one already given to this code (remembered in doc_letter_numbers, or a
     * letter number an earlier invoice of the code carries); otherwise reserve
     * the next company number and remember it. → { letterNumber, reused }
     */
    async letterNumberForCode(organizationId, code, userId = null) {
        const orgId = Number(organizationId) || 1;
        const c = String(code || '').trim().toUpperCase().slice(0, 30);
        if (!c) { const e = new Error('Kode transaksi wajib diisi.'); e.status = 400; throw e; }
        const rows = (r) => r.rows ?? r;
        const found = rows(await db.execute(sql`
            SELECT letter_number FROM doc_letter_numbers WHERE organization_id = ${orgId} AND code = ${c} LIMIT 1`))[0];
        if (found) return { letterNumber: found.letter_number, reused: true };
        const legacy = rows(await db.execute(sql`
            SELECT invoice_letter_number AS n FROM orders
             WHERE upper(order_number) = ${c} AND invoice_letter_number IS NOT NULL AND invoice_letter_number <> ''
               AND (claimed_by_agency_id = ${orgId} OR organization_id = ${orgId} OR organization_id IS NULL)
             ORDER BY id LIMIT 1`))[0];
        const letterNumber = legacy?.n || (await this.getNextLetterNumber(orgId)).letterNumber;
        const ins = rows(await db.execute(sql`
            INSERT INTO doc_letter_numbers (organization_id, code, letter_number, created_by)
            VALUES (${orgId}, ${c}, ${letterNumber}, ${userId})
            ON CONFLICT (organization_id, code) DO NOTHING
            RETURNING letter_number`))[0];
        if (ins) return { letterNumber: ins.letter_number, reused: !!legacy };
        // Someone else saved it a moment earlier → use theirs.
        const again = rows(await db.execute(sql`
            SELECT letter_number FROM doc_letter_numbers WHERE organization_id = ${orgId} AND code = ${c} LIMIT 1`))[0];
        return { letterNumber: again.letter_number, reused: true };
    },
};
