# Tier 2 Multi-Vehicle — E2E Test Matrix

Scope: the multi-vehicle booking feature set (one booking → N car rows sharing
one `order_number`). Covers booking creation, the Rekap grouping UI, Telegram
notifications, multi-row invoices, per-car driver assignment, cancellation, and
analytics dimensions.

Automated smoke tests for the pure logic live in
`apps/api/test/multivehicle.test.js` (run `npm test` in `apps/api`, Node 22+).
The cases below are the full end-to-end matrix to run against a seeded stack
before deploy. Status legend: ☐ not run · ☑ pass · ✗ fail.

Conventions used in steps:
- "Rekap" = Admin → Rekap Order (`AdminOrders.jsx`).
- "Dokumen" = Admin → Dokumen (`AdminDocuments.jsx`).
- A "shared code" is the single `order_number` (e.g. `C073`) all cars of a
  booking carry.

---

## 1. Booking creation — shared order code

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1.1 | Public landing, 1 car | Landing form → 1 vehicle → submit | 201; one order row; success copy is the single-car message |
| 1.2 | Public landing, 3 cars | Landing form → "Tambah Kendaraan" ×2 → submit | 201; **3 rows**, all sharing one code; response `vehicleCount=3`; grandTotal = sum of the 3 |
| 1.3 | Public, quantity expansion | One row, category MPV, quantity 2 | 2 rows created from the single entry, same code |
| 1.4 | Dashboard (logged-in client) multi-car | Dashboard booking form, 2 cars | 2 rows under client's org; visible to client + agency |
| 1.5 | Admin Tambah Rekap, 2 cars + per-car driver | Rekap → Tambah → vehicles[] with driverId each | 2 rows, shared code, each row keeps its own driver |
| 1.6 | Cap enforcement | Submit 11 vehicles | 400 "Maksimal 10 kendaraan per pemesanan." |
| 1.7 | Legacy single-car payload (no `vehicles[]`) | POST with top-level carId only | Wrapped to 1-element array; identical DB state to 1.1 |
| 1.8 | Code uniqueness across bookings | Create booking A (3 cars), then B (2 cars) | A's code ≠ B's code; sequence increments once per booking |

## 2. Rekap grouping UI (`AdminOrders.jsx`)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 2.1 | Multi-car collapses | Open Rekap with a 3-car booking | One summary row, "3 mobil" badge, collapsed by default |
| 2.2 | Expand / collapse | Click summary row / "Rincian" | Reveals 3 child rows (one per car) with connector glyph; toggle closes |
| 2.3 | Summary aggregation | Inspect summary cells | Price/bailout/inap/lembur = **sum**; "mobil" = "3 kendaraan"; plat/driver = "—" |
| 2.4 | Varying fields | Cars with different packages / statuses | Package shows "Beragam"; status shows "Campuran" when mixed |
| 2.5 | Single bookings unchanged | View a 1-car booking | Renders as a normal row, no badge, full actions |
| 2.6 | Pagination keeps booking intact | Set page size small, booking near boundary | Booking never splits across pages (pagination is by booking) |
| 2.7 | Sort by per-car field | Sort by price | Multi-car booking stays grouped (grouping is by code, not adjacency) |
| 2.8 | Pagination counter | Read "Menampilkan … dari N" | N counts **bookings**, not car rows |
| 2.9 | Search | Search a customer/plate in a booking | Booking surfaces; group still intact |

## 3. Telegram notification (`telegram.service.js`)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 3.1 | Single car | Create 1.1 with token configured | One message, classic layout, no "(N kendaraan)" header |
| 3.2 | Multi car | Create 1.2 | One message; header "(3 kendaraan)"; numbered car list; **grand total** line |
| 3.3 | Per-car add-ons | Cars with inap/lembur/package | Each car line shows its add-ons in italics |
| 3.4 | Car label fallback | Car only known by carId (carsById map) | Resolves real name/plate, not "-" |
| 3.5 | No token configured | Unset `TELEGRAM_BOT_TOKEN` | `notifyOrderCreated` returns `not_configured`; **booking still succeeds** |
| 3.6 | Notes dedupe | Same trip note on all rows | Note appears once, not repeated per car |

## 4. Multi-row invoice (`AdminDocuments.jsx`)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 4.1 | Prefill all cars | Dokumen → Invoice → pick any car of a 3-car booking | All 3 cars load as 3 line items |
| 4.2 | From pending queue | "Buat Invoice" on a pending row of a multi-car booking | All siblings pulled (queue + orders cache) |
| 4.3 | Totals | Inspect Sub Total / TOTAL / Terbilang | Subtotal = sum of all car lines incl. lembur/inap; terbilang matches grand |
| 4.4 | Auto-discount by days | 4-car, 1-day booking | **No** 5% discount (keys off days, not car count) |
| 4.5 | Auto-discount by days | 1-car, 5-day booking | 5% discount applied |
| 4.6 | Kuitansi "Untuk Pembayaran" | Bottom half | Lists every unit + plate |
| 4.7 | Mark invoiced (multi) | "Tandai Invoice Selesai" | **All** sibling rows leave the pending queue; toast notes car count |
| 4.8 | Mark invoiced (single) | Same on a 1-car booking | Single row marked, original behaviour |

## 5. Per-car driver assignment

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 5.1 | Open modal | Rekap → multi-car summary → "assignment_ind" icon | Modal lists each car with its own driver dropdown |
| 5.2 | Assign different drivers | Pick driver A for car 1, B for car 2, save | Each row persists its own driver; toast confirms count |
| 5.3 | Clear a driver | Set a car to "-- Tanpa driver --", save | That row's `driver_id` cleared, others untouched |
| 5.4 | Single-car path | 1-car booking edit modal | Driver set via existing EditModal (no regression) |
| 5.5 | Route guard | Call `PUT /api/orders/assign-drivers` unauthenticated | 401/403 |

## 6. Cancellation flows

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 6.1 | Cancel single car | Child row → detail → "Batalkan" (pending/confirmed) | Only that row → `cancelled`; siblings unchanged |
| 6.2 | Cancel whole booking | Summary row → "block" icon → confirm | All still-cancellable rows → `cancelled` |
| 6.3 | Completed rows protected | Booking with 1 completed + 2 active, cancel whole | Completed row untouched; 2 active → cancelled; count = 2 |
| 6.4 | Unknown code | `PUT /api/orders/booking/ZZZ/cancel` | 404 |
| 6.5 | Idempotency | Cancel an already-cancelled booking | 404 (nothing left to cancel) — no error state in UI beyond toast |

## 7. Analytics dimensions (`AdminAnalytics.jsx`, `analytics.service.js`)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 7.1 | YoY table columns | Open Analytics | Separate **Trip** (bookings) and **Unit** (cars) columns |
| 7.2 | Count correctness | Month with one 3-car booking | Trip = 1, Unit = 3 |
| 7.3 | Mixed month | 1×3-car + 2×1-car bookings | Trip = 3, Unit = 5 |
| 7.4 | Revenue unaffected | Compare omset | Sum of all car rows' price (unchanged) |
| 7.5 | Backend KPIs | `GET /api/analytics/kpis` | Response exposes `cars_rented`, `trips_booked`, `avg_trip_value`; `total_orders` kept as legacy alias |
| 7.6 | i18n parity | Toggle EN/ID | "Trips/Cars" ↔ "Trip/Unit"; no missing keys |

## 8. Regression / safety

| # | Scenario | Expected |
|---|----------|----------|
| 8.1 | Existing single-car bookings | Render, edit, invoice, cancel exactly as before |
| 8.2 | Rekap export/import | Round-trips; shared codes preserved on import |
| 8.3 | `sync.service` order-by-code path | `sourceOrigin='web'` rows still skipped (no multi-row collision) |
| 8.4 | `npm test` (apps/api) | All smoke tests pass |
