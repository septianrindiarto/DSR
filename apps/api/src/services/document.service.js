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
};
