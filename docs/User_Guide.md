# DSR Solution — User Guide (Client & Agency)

How to use every feature of DSR Solution, written for the two kinds of people
who use it: **clients** (customer companies who book cars) and **agency staff**
(the rental company who fulfils and manages bookings). UI labels are Indonesian
(the product's primary language) with English in brackets.

> Related: `Build_With_AI_Walkthrough.md` (how it works under the hood),
> `Deployment_Master_Guide.md` (operations), `Stage1_Request_Milestones.md`
> (change history).

---

## 1. Concepts you need first

- **Agency vs Client.** An **agency** is the rental company (e.g. "DSR Rent
  Car"). A **client** is a customer company that books from an agency. Your
  account type decides what you see.
- **Booking vs Car.** One **booking** can contain several **cars**. All cars in
  a booking share one **booking code** (e.g. `C073` for a company, `P012` for a
  private customer). In the Rekap (order list) a multi-car booking shows as one
  expandable row.
- **Order statuses:** Pending → Confirmed → Active → Completed, or Cancelled.
- **Roles (agency side):** Admin (Perusahaan) = full access; Agent = limited
  staff; Demo = sandbox account that only sees demo data.

---

## 2. Client experience

### 2.1 Getting an account
1. Your agency gives you an **invite code** (or a registration link).
2. Go to the site → **Masuk (Login)** → **Daftar (Register)** → choose **Klien
   (Client)** → enter the invite code, your details, email, and password.
3. A **verification email** arrives — click the link to activate, then log in.
   (No email? Check spam; ask your agency to resend.)

### 2.2 Booking a car (Dashboard form)
After login you land on the dashboard with the **Pesan Kendaraan (Book a
Vehicle)** form.
1. **Nama / No. WhatsApp** — who to contact (can differ from your login email).
   **Nama Perusahaan** is filled from your account automatically.
2. **Tgl Pemakaian / Tgl Selesai** — start and end dates (Total Hari is
   computed). 
3. **Daftar Kendaraan (Vehicle list):** for each car set **Kategori**, **Jumlah
   (quantity)**, **Paket** (optional), and that car's **Tujuan (destination)**
   and **Penjemputan (pickup)**. Need more cars? **+ Tambah Kendaraan**.
4. **Keterangan Tambahan** — any notes for the agency.
5. **Kirim Pemesanan (Submit).** You'll get a confirmation with the booking code;
   the agency is alerted instantly and will follow up via WhatsApp.

> Tip: you can book several different cars (even to different destinations) in
> one submission — they'll share one booking code.

### 2.3 Tracking your orders (Rekap)
- Open **Rekap Order** to see your bookings. Multi-car bookings appear as one row
  with an **"N mobil"** badge — click it to expand the individual cars.
- You see **only your own company's** orders. Columns (code, dates, car, driver,
  price, status, invoice info) can be toggled and the list searched/sorted.

### 2.4 What you can't do
Clients can't manage fleet, drivers, other companies, or agency settings — those
are agency-only.

---

## 3. Agency experience

Agency staff use the full admin panel. The sidebar covers Dashboard, Rekap
Order, Jadwal (Schedule), Pelanggan (Customers), Armada (Fleet), Driver,
Keuangan (Finance), Dokumen (Documents), Analitik (Analytics), Pengguna (Users),
Pengaturan (Settings).

### 3.1 First-time setup (new agency)
1. Register the agency account → you become the first admin (`org_id=1`).
2. **Pengaturan → Kode Undangan** — copy/rotate your invite code; share it with
   clients so their orgs attach to you.
3. **Armada** — add your cars. **Driver** — add your drivers.
4. (Optional) **Pengguna** — add staff accounts (Admin/Agent/Demo).

### 3.2 Taking & managing orders (Rekap Order)
You see orders for your agency **and all your client companies**.

- **Add an order on a client's behalf:** **Tambah Rekap/Order** — choose the
  client company, dates, and add vehicles. (On the dashboard booking form, agency
  staff get a **dropdown of affiliated client companies** to pick from.)
- **A multi-car booking** is one expandable row. Its controls:
  - **Action** — opens *Atur Booking*: set the **unit (car)**, **driver**, and
    **price** for each car in the booking, all saved at once. The unit and
    driver dropdowns list only **usable** options (cars not in maintenance,
    active drivers). Picking a unit auto-fills the price (unit rate × days) when
    the row has no price yet.
  - **Cancel** — cancels the **whole booking** (every still-cancellable car;
    finished cars are left alone).
  - **Delete** — permanently removes the whole booking (confirm dialog).
  - Expand the row (click it) to see per-car child rows; each child has its own
    view/edit/delete and a single-car cancel via its detail modal.
- **Status flow:** Pending → confirm → Mulai Sewa (active) → Selesai
  (completed); or cancel.
- **Driver per car:** use **Action**, or assign on a single child row.
- **Export/Import:** the Export and Import buttons handle XLSX/CSV/JSON/XML/TXT
  (see §3.10).

### 3.3 Fleet (Armada)
- Add/edit cars (name, brand, type, category, year, plate, price/day, capacity,
  transmission, fuel, photos, status). Table or grid view.
- **Status** = Available / Rented / Maintenance. Maintenance cars are hidden from
  the booking assignment dropdowns.
- **Bulk status:** tick several cars → the bulk bar appears → set
  **Tersedia / Perbaikan / Disewa** for all selected at once. **Bersihkan**
  clears the selection.

### 3.4 Drivers
- Add/edit drivers, upload documents (SIM, KTP, photo).
- **Status** = Active / Inactive / Suspended. Only **active** drivers appear in
  assignment dropdowns.
- **Bulk status:** same pattern as Fleet — tick rows → set
  **Aktif / Nonaktif / Suspend** at once.

### 3.5 Customers (Pelanggan)
- Manage customer records (private/company, status, contact, order history).
- **Hapus Duplikat (Remove Duplicates):** the badge counts customers that share
  a name with another. Clicking it **merges same-name customers** — keeps the
  oldest record, moves all their orders onto it, and deletes the duplicates.
  - ⚠️ It matches by exact name, only moves orders (other fields on deleted
    duplicates are discarded), and is **permanent and global**. Export the
    customer list first if unsure.

### 3.6 Schedule (Jadwal)
- Week/month timeline of bookings and maintenance. Use it to spot clashes and
  plan driver/car allocation. Click through to the related order.

### 3.7 Documents (Dokumen) — invoices & letters
Generate print-ready A4 documents from order data:
- **Invoice (+ kuitansi)**, **Surat Jalan**, **Kwitansi**, **Surat Penawaran**,
  **Surat Perjanjian**.
- **Multi-car invoice:** pick any car of a booking (or a row from the "perlu
  tagihan / needs invoice" queue) and the invoice loads **all cars in that
  booking** as line items, with subtotal, tax, an automatic 5% discount for
  rentals of 4+ days, and the total spelled out in words (*terbilang*).
- **Tandai Invoice Selesai (Mark invoiced):** records the invoice number and
  removes **every car** of the booking from the pending queue.
- Print or save as PDF from the browser print dialog.

### 3.8 Analytics (Analitik)
- Year-over-year table per month showing **Trip** (number of bookings),
  **Unit** (number of cars rented), **Total Hari**, **Omset** (revenue), and
  **Net**, plus the top-5 contributing companies.
- The Trip vs Unit split matters: a 3-car booking is **1 trip / 3 units**.

### 3.9 Finance, Users, Settings
- **Keuangan (Finance):** chart of accounts, journal entries, and reports
  (ledger, trial balance, income statement, cash flow, balance sheet).
- **Pengguna (Users):** create staff accounts and set their role. Adding an
  email that already exists shows **"Email sudah terdaftar."**
  - Note: the role dropdown (Admin Perusahaan / Agent / Demo) currently shows the
    same options regardless of org type (a known limitation).
- **Pengaturan (Settings):** edit your org profile, manage the invite code, see
  the vendor list, and test the Telegram notification connection.

### 3.10 Import / Export (any list page)
- **Export:** click Export → pick a format → a file downloads.
- **Import:** click Import → pick a file + format → the app maps the columns,
  cleans the values, and reports how many rows imported / were skipped.
  Headers are matched flexibly (e.g. `tgl pemakaian`, `pickupDate`, `usage date`
  all map to the same field).

---

## 4. Notifications (agency)
Every new order triggers a **Telegram** alert to the agency's configured chat —
one message per booking, listing all cars and the estimated total. Configure/
test it in **Pengaturan → Notifikasi**. If Telegram isn't configured, orders
still succeed; you just don't get the push.

---

## 5. Quick reference

| I want to… | Where |
|---|---|
| Book cars (client) | Dashboard → Pesan Kendaraan |
| Book for a client (agency) | Rekap → Tambah, or Dashboard form → pick client |
| See my/our orders | Rekap Order |
| Set car + driver + price for a booking | Rekap → booking row → **Action** |
| Cancel a whole booking | Rekap → booking row → **Cancel** |
| Cancel one car | Expand booking → child row → detail → Batalkan |
| Delete a booking | Rekap → booking row → **Delete** |
| Mark several cars in/out of service | Armada → tick rows → bulk bar |
| Mark several drivers active/inactive | Driver → tick rows → bulk bar |
| Make an invoice | Dokumen → Invoice → pick the order |
| Merge duplicate customers | Pelanggan → Hapus Duplikat |
| Add a staff user | Pengguna → Tambah Pengguna |
| Get/rotate the client invite code | Pengaturan → Kode Undangan |

---

## 6. Troubleshooting (user-facing)

- **"failed to fetch" on submit/register** — usually a deployment/config issue
  (API base URL), not your account. Tell your agency/admin; see the deploy
  guide's `VITE_API_BASE` note.
- **Verification email didn't arrive** — check spam; ask the agency to resend;
  the agency should verify Gmail OAuth is still valid.
- **Multi-car booking fails** — the production database must have the shared-code
  migration applied (`npm run migrate -- orders_shared_code`). An admin action.
- **A car/driver isn't in the assignment dropdown** — it's in Maintenance
  (car) or Inactive/Suspended (driver). Change its status in Armada/Driver, or
  it'll still show if it's already assigned to that row.
