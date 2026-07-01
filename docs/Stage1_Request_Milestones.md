# DSR Solution — Stage 1: Request & Milestone Log

**Purpose:** a chronological record of everything requested and delivered in
this working stage, framed as milestones. Use it to review your own workflow,
see how the app evolved, and decide what to build next. This is **Stage 1**;
future stages should append their own milestone logs.

**Stage 1 theme:** complete the *Tier 2 multi-vehicle booking* feature set,
harden surrounding admin tooling, and take the app to a live production
deployment on a VPS.

Legend: ✅ done · 🚀 deployed to prod · 📄 documentation · ⚠️ follow-up open

---

## Milestone timeline (in request order)

### M1 — Tier 2 Slice 2 + multi-row invoice engine ✅
**You asked:** finish (1) Rekap grouping + Telegram, and (2) the invoice
template engine for multi-row invoices.

**Delivered:**
- **Rekap grouping** (`AdminOrders.jsx`): order rows sharing one `order_number`
  collapse into a single expandable booking row with an "N mobil" badge; child
  rows per car; summary aggregates price/bailout/inap/lembur; pagination by
  booking so a booking never splits across pages.
- **Telegram consolidation** (`telegram.service.js`): one message lists all N
  vehicles + grand total; single-car layout preserved. Logic extracted to a
  pure `buildOrderMessage()`.
- **Multi-row invoices** (`AdminDocuments.jsx`): selecting any car of a booking
  pulls *all* sibling cars as line items; per-booking subtotal/tax/discount;
  fixed the auto-discount to key off rental **days** (not car count);
  "mark invoiced" now marks every car in the booking.

### M2 — Finish the rest of Tier 2 ✅
**You asked:** "continue tier 2" → all four remaining items.

**Delivered:**
- **Per-car driver assignment** — bulk endpoint + modal.
- **Cancellation flows** — cancel a whole booking (all rows by code) vs a single
  car; completed rows protected.
- **Analytics audit** — split the conflated count into **Trips Booked**
  (distinct codes) vs **Cars Rented** (rows) in the YoY table and made the
  backend SQL explicit (`cars_rented`, `trips_booked`, `avg_trip_value`); added
  i18n keys.
- **E2E test matrix** — `apps/api/test/multivehicle.test.js` (Node's built-in
  runner, zero deps) + `docs/Tier2_E2E_Test_Matrix.md` (40+ scenarios).

### M3 — Booking form field reorg (per-vehicle) ✅
**You asked:** move Tujuan & Penjemputan into the vehicle card; put the two
dates inline; same on the landing form.

**Delivered:** `destination` and `pickupLocation` became **per-vehicle** (each
car can split to its own destination/pickup). Backend `vehicleItemSchema`
+ per-row write with trip-level fallback; both `DashboardBookingForm.jsx` and
`LandingBookingForm.jsx` reorganised; dates on one row.

### M4 — Client-company dropdown + assign-car button ✅
**You asked:** (1) on the dashboard booking form, give agency admins a dropdown
of affiliated client companies; (2) add an "assign car/unit" button next to the
assign-driver button.

**Delivered:** agency staff pick the client from `api.companies.list()`
(scoped to their agency); the public booking route now matches the company name
to its org so the booking is visible to that client. Added an assign-car modal
+ `assignCarsBulk` endpoint (auto-prices unpriced category rows from the unit's
rate × days).

### M5 — Consolidate group-row controls ✅
**You asked:** reduce the group row to three buttons — Action, Cancel, Delete —
where **Action** opens one form to set car, driver, and price.

**Delivered:** one **ManageBookingModal** (unit + driver + price per car, saved
together via `PUT /api/orders/booking-items`); whole-booking **delete**
(`DELETE /api/orders/booking/:code`); removed the separate car/driver/expand
buttons (row click still expands).

### M6 — Active-only options in the Action modal ✅
**You asked:** the unit and driver dropdowns show too many maintenance units and
inactive drivers.

**Delivered:** the modal filters to non-maintenance cars and active drivers,
while always keeping a row's currently-assigned unit/driver visible so existing
assignments never vanish.

### M7 — Bulk status on Armada & Driver tabs ✅
**You asked:** add bulk checkboxes to set several units/drivers active/inactive
at once.

**Delivered:** checkbox column + select-all + a bulk action bar on both
`AdminFleet.jsx` (Available/Maintenance/Rented) and `AdminDrivers.jsx`
(Active/Inactive/Suspended); backed by `PUT /api/cars/bulk-status` and
`PUT /api/drivers/bulk-status` (validated enums, registered before `/:id`).

### M8 — Explain "Hapus Duplikat" 📄
**You asked:** what the dedupe button does. Explained: it merges customers with
identical names — keeps the oldest id, reassigns their orders to it, deletes the
rest — and flagged the sharp edges (preview keeps "most orders" survivor vs
backend keeps "lowest id"; exact-name vs case-insensitive grouping; only orders
are migrated; global + permanent). ⚠️ Optional hardening offered (case-insensitive
merge, keep most-complete record, recompute `total_orders`).

### M9 — Push to GitHub 🚀 / ⚠️
**You asked:** push the app so you can deploy. The sandbox can't push (no
GitHub auth + a stale working-tree mirror), so I guided a push from your
machine. **Discovered:** `apps/api/.gitignore` ignored the entire `drizzle/`
folder, so migrations were never committed. Fixed the ignore so migrations
deploy.

### M10 — Update the Deployment Master Guide 📄
**You asked:** update the deploy guide for the Tier 2 release. Added §1.3 (Tier 2
must-haves + shared-code migration), test + multi-unit steps in §6, the explicit
shared-code migration for Path B in §8.6, and matching checklist items.

### M11 — Live deployment execution 🚀
**You asked:** walk me through the VPS deploy. Completed §7→§13 together and
debugged each snag:
- VPS base setup (Node 22, PM2, ufw, `dsr` user).
- Clone (fixed the `drizzle/` gitignore so migrations exist on the VPS).
- Schema migrate on empty Neon (explained the harmless `normalize_client_roles`
  cleanup errors on a fresh DB).
- nginx config + Let's Encrypt TLS (apex live; www cert tidy-up).
- PM2 ecosystem file (fixed a malformed-paste error via heredoc).
- **Root-cause fix:** the app's `VITE_API_BASE` empty value fell back to
  `localhost:5000` → "failed to fetch"; rebuilt with the real HTTPS origin and
  corrected the guide.
- nginx 500 on `/` → `chmod o+x /home/dsr` so www-data can traverse to `dist`.
- Result: **`https://dsrappai.com` live**, API healthy, DB connected.

### M12 — Role dropdown explainer + duplicate-email fix ✅ / 📄
**You asked:** explain the role dropdown and fix the "Tambah Pengguna" error.
Explained the two dimensions (`account_type` agency/client + `role`
admin/agent/demo) and the gap (modal isn't account_type-aware). Fixed the
real bug: the create-user route only checked `error.message` for "duplicate",
but the Postgres unique violation is code **23505** on `error.cause` — now
returns a clean "Email sudah terdaftar." ⚠️ Follow-up: make the role dropdown
account_type-aware; include the fix in the next prod push.

### M13 — Documentation suite 📄 *(this stage's wrap-up)*
**You asked:** produce (1) this Stage 1 milestone log, (2) a build-with-AI
walkthrough, (3) a user guide for client + agency flows, and (4) persistent
project context for all future chats. Delivered as the `docs/` set + root
`CLAUDE.md`.

---

## Open follow-ups carried into the next stage

- ⚠️ **Push M5–M12 code to prod** and run `npm run migrate -- orders_shared_code`
  if not already applied there. Re-build the web app with
  `VITE_API_BASE=https://dsrappai.com`.
- ⚠️ **www TLS** — expand the apex cert to cover `www.dsrappai.com` and delete
  the orphan www-only cert.
- ⚠️ **Role dropdown** — make it account_type-aware (client roles vs agency
  roles) and set `account_type` correctly on create.
- ⚠️ **Dedupe hardening** — case-insensitive merge, keep most-complete survivor,
  recompute `total_orders`.
- ⚠️ **PM2 boot persistence** — confirm `pm2 startup` was completed (survives reboot).
- 💡 **Optional** — route-based code-splitting to shrink the 727 kB JS bundle;
  add a `favicon.ico`.

---

## Workflow observations (to guide what you want)

A few patterns stand out across Stage 1 — useful when planning Stage 2:

1. **You iterate UI in tight loops.** Many milestones (M3→M4→M5→M6) were
   successive refinements of the *same* booking/Rekap surface. Batching these as
   one "booking UX" epic up front would cut rework.
2. **Backend + frontend move together.** Almost every UI request needed a
   matching endpoint. Defining the API contract first (as AGENTS.md recommends)
   keeps the two in sync.
3. **Deployment surfaced latent config bugs**, not feature bugs — gitignored
   migrations, the `VITE_API_BASE` localhost fallback, home-dir permissions, the
   duplicate-email error leak. These are now documented so they won't recur.
4. **Multi-vehicle "shared code" is the spine** of the whole stage. Most features
   are variations on "operate on all rows sharing an `order_number`." Keep that
   invariant central in Stage 2.

Suggested Stage 2 candidates (from the follow-ups + your stated intent to
enhance): finish the prod push of M5–M12, account_type-aware user management,
dedupe hardening, and any new features you have in mind — file them at the top
of a new `Stage2_Request_Milestones.md` as you go.
