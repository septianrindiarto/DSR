#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// One-off backfill for Phase 4C-1.
//
// For every row in `organizations` that doesn't have display_id yet:
//   • compute display_id from name + created_at
//   • if the computed display_id is already used by ANOTHER row, log + skip
//     (humans resolve collisions; we never auto-suffix)
//   • set parent_agency_id according to assumed model:
//       - org id 1 (DSR Solution) is the agency itself        → NULL
//       - every other org is treated as a client of DSR       → 1
//   • write back the values
//
// Idempotent: rows that already have display_id are skipped.
// Run with:    node src/scripts/backfill-display-ids.js
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { isNull, eq } from 'drizzle-orm';
import { findAvailableDisplayId } from '../services/display-id.service.js';

const AGENCY_ORG_ID = 1; // DSR's own org row

async function main() {
    const rows = await db.select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
        displayId: organizations.displayId,
        parentAgencyId: organizations.parentAgencyId,
    }).from(organizations).where(isNull(organizations.displayId));

    if (rows.length === 0) {
        console.log('No organizations need backfilling. All rows already have display_id.');
        return;
    }

    console.log(`Found ${rows.length} organization(s) needing display_id backfill.`);

    let ok = 0;
    let walkedCollisions = 0;

    for (const row of rows) {
        const { displayId, attempts } = await findAvailableDisplayId(
            row.name,
            row.createdAt || new Date()
        );
        if (attempts > 1) walkedCollisions++;

        const isAgencyItself = row.id === AGENCY_ORG_ID;
        const parentAgencyId = isAgencyItself ? null : AGENCY_ORG_ID;

        await db.update(organizations)
            .set({ displayId, parentAgencyId })
            .where(eq(organizations.id, row.id));

        const parentLabel = isAgencyItself ? '(agency itself, parent=NULL)' : `(parent_agency_id=${AGENCY_ORG_ID})`;
        const attemptsNote = attempts > 1 ? ` [${attempts} attempts due to collision]` : '';
        console.log(`  ✓ org ${row.id} "${row.name}" → ${displayId}  ${parentLabel}${attemptsNote}`);
        ok++;
    }

    console.log('');
    console.log(`Done. ${ok} updated. ${walkedCollisions} required >1 attempt due to collisions.`);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Backfill failed:', err);
        process.exit(1);
    });
