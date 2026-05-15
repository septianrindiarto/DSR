# Rekap 2026 → Neon Postgres Sync

This wires the existing **`DSR Invoice Automation/Rekap 2026.xlsx`** (refreshed
periodically from Google Drive by the python script in that folder) into the
web app's Neon Postgres database.

## Architecture (one-way: gdrive → web)

```
Google Drive ─[python sync]─►  D:\Project\DSR\DSR Invoice Automation\Rekap 2026.xlsx
                                     │
                                     ├─ scheduler watches mtime  (every 10 min)
                                     ├─ POST /api/sync/rekap     (manual)
                                     └─ POST /api/sync/rekap/upload (drag & drop)
                                          │
                                          ▼
                                  sync.service.runRekapSync()
                                          │
                                          ▼
                                customers │ drivers │ cars │ orders
                                          │
                                          ▼
                                  sync_logs (audit trail)
```

The web admin remains the source of truth for any order *created or edited via
the UI* — those rows are tagged `source_origin = 'web'` and the sync NEVER
overwrites them. Excel-originated rows are tagged `source_origin = 'rekap_xlsx'`
and DO get patched on subsequent syncs.

## One-time setup

1. Install the new `xlsx` dep:
   ```
   cd apps/api
   npm install
   ```

2. Apply the schema migration:
   ```
   psql "$DATABASE_URL" -f drizzle/sync_migration.sql
   # ─OR─
   npm run db:push
   ```

3. (Optional) Override the file path in `apps/api/.env`:
   ```
   REKAP_XLSX_PATH=D:\Project\DSR\DSR Invoice Automation\Rekap 2026.xlsx
   REKAP_SYNC_INTERVAL_MS=600000   # default 10 min
   REKAP_SYNC_DISABLED=false       # set true to disable the scheduler
   ```

4. Run the one-shot bulk migration:
   ```
   npm run sync:rekap
   ```
   Output looks like:
   ```
   STATUS: SUCCESS
   File: D:\...\Rekap 2026.xlsx (1768105 bytes)
   Rows read: 901
   Customers: +47  ~3
   Drivers:   +18  ~0
   Cars:      +12  ~0
   Orders:    +897 ~4
   Duration: 24s
   ```

5. Start the API (`npm run dev` or `npm start`). The scheduler activates
   automatically and watches the xlsx file's mtime — whenever the python sync
   refreshes the file, a re-import runs in the background.

## How the column mapping works

| Excel sheet   | Excel column        | DB target               |
|---------------|---------------------|-------------------------|
| `Database`    | Nama (Kategori=Company / Pribadi) | `customers.name` / `companyName` |
| `Database`    | Telepon              | `customers.phone`       |
| `Database`    | Alamat               | `customers.address`     |
| `Database`    | Nama (Kategori=Driver) | `drivers.name`         |
| `Rule`        | col 0 / col 1        | additional driver name + phone |
| `Rule`        | col 2 / col 3        | car name + license plate |
| `Detail`      | Kode Transaksi       | `orders.order_number` (unique key) |
| `Detail`      | Nama / Company Name  | `orders.customer_id` (resolved) |
| `Detail`      | Tgl Pemakaian + Jumlah Hari | `orders.pickup_date` / `return_date` |
| `Detail`      | Mobil / Plat         | `orders.car_id` (resolved) |
| `Detail`      | Driver               | `orders.driver_id` (resolved) |
| `Detail`      | Kontrak Harga        | `orders.total_price` / `daily_rate` |
| `Detail`      | Status               | `orders.status` (mapped to enum: Done→completed, etc.) |
| `Detail`      | Paket / Tujuan / Inap/sppd / Lembur / Bailout | corresponding `orders.*` |
| `Logbook`     | No. Invoice          | `orders.invoice_number` |
| `Logbook`     | No. Surat            | `orders.invoice_letter_number` |
| `Logbook`     | Tanggal Kirim / Due Date / Tanggal Realisasi | `orders.invoice_*_date` |
| `Logbook`     | Status               | `orders.invoice_payment_status` (Pending / Paid) |

Audit log (`sync_logs`) records every run — manual, scheduled, or upload — with
counts, errors, and duration.

## Frontend integration

The **Dokumen** tab (admin sidebar, below Analitik) gets:

- **Sync Rekap** button — fires `POST /api/sync/rekap` and refreshes the page state.
- **Sync status strip** — last sync timestamp, file size/mtime, and order counts split by source.
- **"Order Menunggu Invoice"** panel — orders with `status IN (completed, active, confirmed)`
  and `invoice_number IS NULL`. One click auto-fills the invoice template.
- **Tandai Invoice Selesai** button — appears after autofilling from an order;
  saves the chosen invoice number back to that order so it leaves the pending queue.

## Operations

```bash
# Manual one-shot bulk migration
npm run sync:rekap

# Inspect recent syncs
psql "$DATABASE_URL" -c "SELECT id, status, orders_inserted, orders_updated, errors, duration_ms, created_at FROM sync_logs ORDER BY created_at DESC LIMIT 10;"

# How many orders still need an invoice?
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM orders WHERE invoice_number IS NULL AND status = 'completed';"
```

## What is NOT included (yet)

- **Web → Google Drive write-back.** That requires Google Drive API OAuth in the
  Node app. For now, the workflow is: user edits via web admin → Excel stays
  out-of-date for new web-created rows. If you need true bidirectional sync,
  next step is wiring `googleapis` with a service account and a write-back job
  that exports the DB back to a Rekap.xlsx and uploads it.
- **Schema for invoice attachment files.** The Documents page generates PDFs
  client-side (browser print). If you want server-side PDF storage, add
  `invoice_pdf_url` to the orders table and an endpoint that accepts the
  rendered PDF blob.
