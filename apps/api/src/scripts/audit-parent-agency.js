// One-shot diagnostic + backfill for organizations.parent_agency_id.
//
// Bug context: agency admin's Rekap Order was hiding orders tagged to a
// client org because the scope filter only matched org_id = my_org_id.
// The fix in scope.js expands the OR to include client orgs where
// parent_agency_id = my_org_id. For that subquery to find anything,
// every existing client org must have parent_agency_id set.
//
// Phase 4C-1 added the column and the registration path now writes it,
// but rows created before that migration (or via direct INSERT) may still
// be NULL. This script:
//   1. Lists every organization with id, name, parent_agency_id
//   2. For any client org (id != 1) with NULL parent_agency_id, sets it to 1
//   3. Re-prints the table so the operator can confirm
//
// Run:  node apps/api/src/scripts/audit-parent-agency.js
//
// Idempotent — re-running after a clean state is a no-op.

import 'dotenv/config';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { isNull, eq, ne, and, sql } from 'drizzle-orm';

const AGENCY_ORG_ID = 1; // DSR Rent Car

async function main() {
    console.log('--- BEFORE ---');
    const before = await db.select({
        id: organizations.id,
        name: organizations.name,
        parentAgencyId: organizations.parentAgencyId,
        displayId: organizations.displayId,
    })
        .from(organizations)
        .orderBy(organizations.id);
    console.table(before);

    // Find client orgs (not the agency itself) with NULL parent_agency_id
    const orphans = await db.select({
        id: organizations.id,
        name: organizations.name,
    })
        .from(organizations)
        .where(and(
            ne(organizations.id, AGENCY_ORG_ID),
            isNull(organizations.parentAgencyId),
        ));

    if (orphans.length === 0) {
        console.log('\n✓ All client orgs already have parent_agency_id set.');
    } else {
        console.log(`\nFound ${orphans.length} client org(s) with NULL parent_agency_id:`);
        for (const o of orphans) console.log(`  - id=${o.id} name="${o.name}"`);

        const result = await db.update(organizations)
            .set({ parentAgencyId: AGENCY_ORG_ID })
            .where(and(
                ne(organizations.id, AGENCY_ORG_ID),
                isNull(organizations.parentAgencyId),
            ))
            .returning({ id: organizations.id, name: organizations.name });

        console.log(`\n✓ Backfilled parent_agency_id=${AGENCY_ORG_ID} on ${result.length} row(s).`);
    }

    // Also make sure the agency itself has parent_agency_id = NULL
    // (it should not have a parent).
    const [agencyRow] = await db.select({
        id: organizations.id,
        parentAgencyId: organizations.parentAgencyId,
    })
        .from(organizations)
        .where(eq(organizations.id, AGENCY_ORG_ID));
    if (agencyRow && agencyRow.parentAgencyId !== null) {
        await db.update(organizations)
            .set({ parentAgencyId: null })
            .where(eq(organizations.id, AGENCY_ORG_ID));
        console.log(`✓ Cleared parent_agency_id on agency org id=${AGENCY_ORG_ID}.`);
    }

    console.log('\n--- AFTER ---');
    const after = await db.select({
        id: organizations.id,
        name: organizations.name,
        parentAgencyId: organizations.parentAgencyId,
        displayId: organizations.displayId,
    })
        .from(organizations)
        .orderBy(organizations.id);
    console.table(after);

    process.exit(0);
}

main().catch((err) => {
    console.error('audit-parent-agency failed:', err);
    process.exit(1);
});
