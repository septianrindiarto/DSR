// ─────────────────────────────────────────────────────────────────────────────
// Remove a (test) contract and EVERYTHING that hangs on it.  ⚠️  DESTRUCTIVE.
//
// For cleaning test contracts out of a database that also holds real data.
// SAFE BY DEFAULT: without --confirm it only prints what it found and writes a
// JSON backup — nothing is changed.
//
// What it removes (for the contract, its amendments, and their codes):
//   contract, units, required documents, monthly M rows (lease_unit_billings) and
//   older lease_billings, L/T/O/R forms + recaps, the order rows of those codes,
//   their invoices (+ payments, payment links, auto Books journal entries, faktur
//   drafts), surat-pengantar numbers of the codes, unit replacements, emergency
//   reports, notifications about them, and the odometer readings those forms
//   wrote (source 'ops' / 'contract', inside the contract period).
// What it keeps: the client company, its users, customers, cars, drivers, and the
//   activity log (audit history).
// Files (contract documents, form evidence, faktur PDFs) are MOVED into the backup
//   folder — not deleted — on the machine where the script runs.
//
// It refuses (exit 1) when:
//   • an invoice also bills orders that do not belong to these contracts
//   • a faktur pajak also covers other invoices, or is TERBIT (use --force-faktur)
//   • a Books journal entry falls in a locked period (use --force-locked)
//
// Usage (from apps/api, against the DB in .env):
//   node src/scripts/purge-contract.js --contract kontrak_XXX            # dry run + backup
//   node src/scripts/purge-contract.js --contract kontrak_XXX --confirm  # really delete
// Options: --id 12 (instead of --contract), --keep-odometer, --out <folder>
// The backup (purge-backups/<contract>-<time>/rows.json + files/) contains client
// data: keep it private, never commit it (purge-backups/ is git-ignored).
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import * as T from '../db/schema.js';
import { and, eq, inArray, or, sql, gte, lte } from 'drizzle-orm';
import { resolvePrivateRef, PRIVATE_ROOT } from '../services/private-files.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const CONFIRM = flag('--confirm');
const FORCE_FAKTUR = flag('--force-faktur');
const FORCE_LOCKED = flag('--force-locked');
const KEEP_ODO = flag('--keep-odometer');
const uniq = (a) => [...new Set(a.filter((x) => x !== null && x !== undefined && x !== ''))];
const IN = (col, list) => (list.length ? inArray(col, list) : sql`false`);
const say = (...a) => console.log(...a);

async function main() {
    const numbers = values('--contract'), ids = values('--id').map(Number).filter(Boolean);
    if (!numbers.length && !ids.length) { say('Pakai --contract <nomor kontrak> atau --id <id>.'); process.exit(1); }

    // 1. Contracts (+ their amendments, recursively)
    let contracts = await db.select().from(T.leaseContracts)
        .where(or(IN(T.leaseContracts.contractNumber, numbers), IN(T.leaseContracts.id, ids)));
    if (!contracts.length) { say('Kontrak tidak ditemukan.'); process.exit(1); }
    for (let guard = 0; guard < 10; guard++) {
        const more = await db.select().from(T.leaseContracts)
            .where(and(IN(T.leaseContracts.amendsContractId, contracts.map((c) => c.id)), sql`${T.leaseContracts.id} NOT IN (${sql.join(contracts.map((c) => sql`${c.id}`), sql`, `)})`));
        if (!more.length) break;
        contracts = [...contracts, ...more];
    }
    const cIds = contracts.map((c) => c.id);

    // 2. Everything that belongs to them
    const units = await db.select().from(T.leaseContractUnits).where(IN(T.leaseContractUnits.contractId, cIds));
    const docs = await db.select().from(T.contractDocuments).where(IN(T.contractDocuments.contractId, cIds));
    const monthly = await db.select().from(T.leaseUnitBillings).where(IN(T.leaseUnitBillings.contractId, cIds));
    const legacyBills = await db.select().from(T.leaseBillings).where(IN(T.leaseBillings.contractId, cIds));
    const forms = await db.select().from(T.opsEntries).where(IN(T.opsEntries.contractId, cIds));
    const recaps = await db.select().from(T.opsRecaps).where(IN(T.opsRecaps.contractId, cIds));
    const replacements = await db.select().from(T.leaseUnitReplacements).where(IN(T.leaseUnitReplacements.contractId, cIds));
    const incidents = await db.select().from(T.unitIncidents).where(IN(T.unitIncidents.contractId, cIds));
    const codes = uniq([...monthly.map((m) => m.orderNumber), ...legacyBills.map((b) => b.orderNumber), ...forms.map((f) => f.code), ...recaps.map((r) => r.code)]);
    const orderRows = await db.select().from(T.orders).where(or(IN(T.orders.contractId, cIds), IN(T.orders.id, uniq(monthly.map((m) => m.orderId))), IN(T.orders.orderNumber, codes)));
    const orderIds = orderRows.map((o) => o.id);

    // 3. Invoices of those orders (+ cancelled ones that recorded these contracts)
    const cancelled = await db.select({ id: T.invoices.id }).from(T.invoices)
        .where(and(eq(T.invoices.isCancelled, true), or(...cIds.map((id) => sql`${T.invoices.cancelledMeta}->'contractIds' @> ${JSON.stringify([id])}::jsonb`))))
        .catch(() => []);
    const invIds = uniq([...orderRows.map((o) => o.invoiceId), ...legacyBills.map((b) => b.invoiceId), ...recaps.map((r) => r.invoiceId), ...forms.map((f) => f.invoiceId), ...cancelled.map((c) => c.id)]);
    const invoiceRows = await db.select().from(T.invoices).where(IN(T.invoices.id, invIds));
    const foreignOrders = await db.select({ id: T.orders.id, no: T.orders.orderNumber, inv: T.orders.invoiceId }).from(T.orders)
        .where(and(IN(T.orders.invoiceId, invIds), sql`${T.orders.id} NOT IN (${orderIds.length ? sql.join(orderIds.map((x) => sql`${x}`), sql`, `) : sql`0`})`));
    const payments = await db.select().from(T.invoicePayments).where(IN(T.invoicePayments.invoiceId, invIds));
    const payLinks = await db.select().from(T.paymentLinks).where(IN(T.paymentLinks.invoiceId, invIds));
    const fakturIds = uniq(invoiceRows.map((i) => i.fakturId));
    const fakturs = await db.select().from(T.fakturPajak).where(IN(T.fakturPajak.id, fakturIds));
    const fakturOthers = await db.select({ id: T.invoices.id, no: T.invoices.invoiceNumber, f: T.invoices.fakturId }).from(T.invoices)
        .where(and(IN(T.invoices.fakturId, fakturIds), sql`${T.invoices.id} NOT IN (${invIds.length ? sql.join(invIds.map((x) => sql`${x}`), sql`, `) : sql`0`})`));

    // 4. Books (auto entries of these invoices / payments, and their reversals)
    const payIds = payments.map((p) => p.id);
    let books = await db.select().from(T.bookTransactions).where(or(
        and(eq(T.bookTransactions.sourceType, 'invoice'), IN(T.bookTransactions.sourceId, invIds)),
        and(eq(T.bookTransactions.sourceType, 'payment'), IN(T.bookTransactions.sourceId, payIds))));
    const rev = books.length ? await db.select().from(T.bookTransactions).where(IN(T.bookTransactions.reversalOf, books.map((b) => b.id))) : [];
    books = [...books, ...rev.filter((r) => !books.some((b) => b.id === r.id))];
    const bookLines = await db.select().from(T.bookLines).where(IN(T.bookLines.transactionId, books.map((b) => b.id)));
    const locks = books.length ? await db.select().from(T.bookPeriodLocks) : [];
    const lockedBooks = books.filter((b) => locks.some((l) => l.organizationId === b.organizationId && String(b.entryDate).slice(0, 7) === `${l.year}-${String(l.month).padStart(2, '0')}`));

    // 5. Odometer readings written by these forms, letter numbers, notifications
    const carIds = uniq([...units.map((u) => u.carId), ...replacements.map((r) => r.replacementCarId)]);
    const from = contracts.map((c) => c.startDate).sort()[0], to = contracts.map((c) => c.endDate).sort().pop();
    const odo = KEEP_ODO || !carIds.length ? [] : await db.select().from(T.odometerReadings).where(and(IN(T.odometerReadings.carId, carIds),
        IN(T.odometerReadings.source, ['ops', 'contract']),
        gte(T.odometerReadings.readingDate, new Date(`${from}T00:00:00+07:00`)), lte(T.odometerReadings.readingDate, new Date(`${to}T23:59:59+07:00`))));
    const letters = codes.length ? (await db.execute(sql`SELECT * FROM doc_letter_numbers WHERE code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`)) : [];
    const letterRows = Array.isArray(letters) ? letters : letters?.rows || [];
    const refs = uniq([...codes, ...contracts.map((c) => c.contractNumber), ...invoiceRows.map((i) => i.invoiceNumber)]);
    const notes = await db.select().from(T.notifications).where(or(IN(T.notifications.ref, refs),
        ...cIds.map((id) => sql`${T.notifications.link} LIKE ${`%contract=${id}%`}`)));

    // 6. Files (moved to the backup folder on --confirm)
    const files = [
        ...docs.filter((d) => d.fileRef).map((d) => ({ ref: d.fileRef, area: 'contracts' })),
        ...forms.flatMap((f) => (f.evidence || []).map((e) => ({ ref: e.ref, area: 'ops' }))),
        ...monthly.flatMap((m) => (m.evidence || []).map((e) => ({ ref: e.ref, area: 'ops' }))),
        ...fakturs.filter((f) => f.fileRef).map((f) => ({ ref: f.fileRef, area: 'faktur' })),
    ].filter((f) => f.ref);

    // ─── Report ──────────────────────────────────────────────────────────
    say(`\n${CONFIRM ? '⚠️  HAPUS' : 'DRY RUN (tidak ada yang diubah)'} — kontrak: ${contracts.map((c) => `${c.contractNumber} (#${c.id}, ${c.status})`).join(', ')}`);
    const line = (label, n, extra = '') => say(`  ${String(n).padStart(5)}  ${label}${extra ? ` — ${extra}` : ''}`);
    line('unit kontrak', units.length, carIds.length ? `mobil #${carIds.join(', #')} (mobil TIDAK dihapus)` : '');
    line('dokumen kontrak', docs.length);
    line('form bulanan M', monthly.length, monthly.map((m) => m.orderNumber).join(', '));
    line('tagihan bulanan lama', legacyBills.length);
    line('form L/T/O/R', forms.length, forms.map((f) => f.code || `#${f.id}`).join(', '));
    line('rekap R', recaps.length);
    line('baris order (kode)', orderRows.length, uniq(orderRows.map((o) => o.orderNumber)).join(', '));
    line('invoice', invoiceRows.length, invoiceRows.map((i) => `${i.invoiceNumber}${i.isCancelled ? ' (batal)' : i.paidDate ? ' (LUNAS)' : ''}`).join(', '));
    line('pembayaran invoice', payments.length);
    line('link pembayaran', payLinks.length);
    line('faktur pajak', fakturs.length, fakturs.map((f) => `${f.nsfp || 'draft'} (${f.status})`).join(', '));
    line('jurnal Books (otomatis)', books.length, `${bookLines.length} baris`);
    line('unit pengganti', replacements.length);
    line('laporan darurat', incidents.length);
    line('bacaan odometer dari form', odo.length, KEEP_ODO ? 'dilewati (--keep-odometer)' : '');
    line('nomor surat pengantar', letterRows.length);
    line('notifikasi', notes.length);
    line('file (dipindah ke backup)', files.length);

    const problems = [];
    if (foreignOrders.length) problems.push(`Invoice juga berisi order lain: ${foreignOrders.map((o) => `${o.no} (invoice #${o.inv})`).join(', ')}`);
    if (fakturOthers.length) problems.push(`Faktur juga memuat invoice lain: ${fakturOthers.map((o) => o.no).join(', ')}`);
    if (!FORCE_FAKTUR && fakturs.some((f) => f.status === 'terbit')) problems.push('Ada faktur pajak TERBIT (sudah dilaporkan). Tambah --force-faktur bila memang data uji.');
    if (!FORCE_LOCKED && lockedBooks.length) problems.push(`Ada jurnal di periode Books yang dikunci (${uniq(lockedBooks.map((b) => String(b.entryDate).slice(0, 7))).join(', ')}). Tambah --force-locked bila memang data uji.`);
    if (problems.length) { say('\n✋ Berhenti:'); problems.forEach((p) => say(`   • ${p}`)); process.exit(1); }

    // ─── Backup (always) ─────────────────────────────────────────────────
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.resolve(values('--out')[0] || path.join(process.cwd(), 'purge-backups'), `${contracts[0].contractNumber.replace(/[^\w.-]+/g, '_')}-${stamp}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify({
        createdAt: new Date().toISOString(), database: (process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@'),
        contracts, units, docs, monthly, legacyBills, forms, recaps, orders: orderRows, invoices: invoiceRows, payments, payLinks,
        fakturs, books, bookLines, replacements, incidents, odometer: odo, letters: letterRows, notifications: notes, files,
    }, null, 2));
    say(`\n💾 Backup data: ${path.join(outDir, 'rows.json')}`);
    if (!CONFIRM) { say('\nDry run selesai. Periksa daftar di atas, lalu jalankan lagi dengan --confirm.'); process.exit(0); }

    // ─── Delete (one transaction) ────────────────────────────────────────
    await db.transaction(async (tx) => {
        const del = (table, col, list) => (list.length ? tx.delete(table).where(inArray(col, list)) : null);
        await del(T.bookLines, T.bookLines.id, bookLines.map((l) => l.id));
        await del(T.bookTransactions, T.bookTransactions.id, books.map((b) => b.id));
        await del(T.paymentLinks, T.paymentLinks.id, payLinks.map((p) => p.id));
        await del(T.invoicePayments, T.invoicePayments.id, payIds);
        await del(T.opsEntries, T.opsEntries.id, forms.map((f) => f.id));
        await del(T.opsRecaps, T.opsRecaps.id, recaps.map((r) => r.id));
        await del(T.leaseUnitBillings, T.leaseUnitBillings.id, monthly.map((m) => m.id));
        await del(T.leaseBillings, T.leaseBillings.id, legacyBills.map((b) => b.id));
        await del(T.orders, T.orders.id, orderIds);
        await del(T.invoices, T.invoices.id, invIds);
        await del(T.fakturPajak, T.fakturPajak.id, fakturIds);
        await del(T.leaseUnitReplacements, T.leaseUnitReplacements.id, replacements.map((r) => r.id));
        await del(T.unitIncidents, T.unitIncidents.id, incidents.map((i) => i.id));
        await del(T.contractDocuments, T.contractDocuments.id, docs.map((d) => d.id));
        await del(T.leaseContractUnits, T.leaseContractUnits.id, units.map((u) => u.id));
        await del(T.odometerReadings, T.odometerReadings.id, odo.map((r) => r.id));
        await del(T.notifications, T.notifications.id, notes.map((n) => n.id));
        if (letterRows.length) await tx.execute(sql`DELETE FROM doc_letter_numbers WHERE id IN (${sql.join(letterRows.map((l) => sql`${l.id}`), sql`, `)})`);
        // supersede links from other contracts, then the contracts (amendments first)
        await tx.update(T.leaseContracts).set({ supersededBy: null }).where(IN(T.leaseContracts.supersededBy, cIds));
        for (const c of [...contracts].reverse()) await tx.delete(T.leaseContracts).where(eq(T.leaseContracts.id, c.id));
        // cars whose odometer came from deleted readings → latest remaining reading
        for (const carId of KEEP_ODO ? [] : uniq(odo.map((r) => r.carId))) {
            const [last] = await tx.select({ km: T.odometerReadings.km }).from(T.odometerReadings).where(eq(T.odometerReadings.carId, carId))
                .orderBy(sql`${T.odometerReadings.readingDate} DESC`).limit(1);
            if (last) await tx.update(T.cars).set({ currentOdometer: last.km }).where(eq(T.cars.id, carId));
        }
    });

    // ─── Files: move into the backup folder ──────────────────────────────
    let moved = 0, missing = 0;
    for (const f of files) {
        const abs = resolvePrivateRef(f.ref, f.area);
        if (!abs || !fs.existsSync(abs)) { missing++; continue; }
        const dest = path.join(outDir, 'files', path.relative(PRIVATE_ROOT, abs));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(abs, dest);
        moved++;
    }
    say(`\n✅ Selesai. ${contracts.length} kontrak dihapus. File dipindah: ${moved}${missing ? `, tidak ditemukan di mesin ini: ${missing} (mungkin tersimpan di server lain)` : ''}.`);
    process.exit(0);
}

main().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
