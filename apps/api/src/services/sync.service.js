import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { db } from '../db/index.js';
import { orders, customers, drivers, cars, syncLogs } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

// ─── Configuration ──────────────────────────────────────────────────────────
// Local sync folder where the python script in DSR Invoice Automation drops
// the latest "Rekap 2026.xlsx" pulled from Google Drive.
export const REKAP_PATH = process.env.REKAP_XLSX_PATH
  || 'D:\\Project\\DSR\\DSR Invoice Automation\\Rekap 2026.xlsx';

// ─── Helpers ────────────────────────────────────────────────────────────────
function toStr(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // xlsx may emit serial numbers when cellDates: false; we use cellDates: true
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Indonesian month names → month index (0-based)
const ID_MONTHS = {
  januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
  juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
};

/**
 * Parse an Indonesian date string into a Date. Handles:
 *   - "DD/MM/YYYY"       e.g. "22/09/2025"
 *   - "D Month YYYY"     e.g. "7 September 2025"  (Indonesian month names)
 *   - ISO / anything JS Date can handle natively
 * Returns null if unparseable.
 */
function parseIdDate(str) {
  if (!str) return null;
  str = str.trim();
  // DD/MM/YYYY  (JavaScript parses this as MM/DD which is wrong — handle explicitly)
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
    if (!isNaN(d.getTime())) return d;
  }
  // "7 September 2025" with Indonesian month name
  const idm = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (idm) {
    const month = ID_MONTHS[idm[2].toLowerCase()];
    if (month !== undefined) return new Date(parseInt(idm[3], 10), month, parseInt(idm[1], 10));
  }
  // Fallback — let JS try (handles ISO etc.)
  const plain = new Date(str);
  return isNaN(plain.getTime()) ? null : plain;
}

/**
 * Parse "Tgl Pemakaian" which can be:
 *   - Single date:  "22/09/2025"  |  "7 September 2025"
 *   - Range s/d:   "17 s/d 20 November 2025"
 *   - Range dan:   "11 dan 13 Desember 2025"
 *
 * Returns { pickupDate, returnDate } where returnDate may be null
 * (caller should derive it from totalDays when null).
 */
function parseTglPemakaian(v) {
  const s = toStr(v).trim();
  if (!s || s === '-') return { pickupDate: null, returnDate: null };

  // Detect range patterns: "s/d" or " dan "
  const rangeMatch = s.match(/^(\d{1,2})\s+(?:s\/d|dan)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10);
    const endDay   = parseInt(rangeMatch[2], 10);
    const month    = ID_MONTHS[rangeMatch[3].toLowerCase()];
    const year     = parseInt(rangeMatch[4], 10);
    if (month !== undefined) {
      return {
        pickupDate:  new Date(year, month, startDay),
        returnDate:  new Date(year, month, endDay),
      };
    }
  }

  // Single date fallback
  return { pickupDate: parseIdDate(s), returnDate: null };
}
function normPhone(v) {
  const s = toStr(v).replace(/\D+/g, '');
  if (!s) return null;
  // Indonesian phone normalization — leading "0" or "62" both fine; keep raw digits
  return s.length >= 7 ? s : null;
}

// Map Detail.Status (Excel) → orders.status enum (DB)
function mapOrderStatus(s) {
  const v = toStr(s).toLowerCase();
  if (!v) return 'pending';
  if (v === 'done' || v === 'selesai' || v === 'completed') return 'completed';
  if (v === 'cancel' || v === 'cancelled' || v === 'batal' || v === 'dibatalkan') return 'cancelled';
  if (v === 'active' || v === 'aktif' || v === 'on going' || v === 'progress') return 'active';
  if (v === 'confirmed' || v === 'confirm' || v === 'dikonfirmasi') return 'confirmed';
  return 'pending';
}

// Build sheet → array-of-objects with headers from row 0.
function sheetToObjects(ws) {
  // header: 1 returns array-of-arrays with raw header row
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null, blankrows: false });
  if (!aoa.length) return [];
  const headers = (aoa[0] || []).map(h => toStr(h));
  const out = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every(v => v === null || v === '')) continue;
    const obj = {};
    headers.forEach((h, j) => { if (h) obj[h] = row[j]; });
    out.push(obj);
  }
  return out;
}

// ─── Main entrypoint ────────────────────────────────────────────────────────
/**
 * Run a full Rekap 2026 → DB sync.
 * Returns a summary that gets persisted into the `sync_logs` table.
 *
 *   opts.filePath   override for the xlsx path
 *   opts.trigger    'manual' | 'scheduled' | 'upload' (audit field)
 *   opts.userId     user id of the operator (audit field)
 *   opts.source     'rekap_xlsx' (default) — extensible if you add more sources
 */
export async function runRekapSync(opts = {}) {
  const filePath = opts.filePath || REKAP_PATH;
  const trigger = opts.trigger || 'manual';
  const source = opts.source || 'rekap_xlsx';
  const startedAt = Date.now();

  const summary = {
    filePath, trigger, source,
    fileSize: 0, rowsRead: 0,
    customersInserted: 0, customersUpdated: 0,
    driversInserted: 0, driversUpdated: 0,
    carsInserted: 0, carsUpdated: 0,
    ordersInserted: 0, ordersUpdated: 0,
    errors: [],
    status: 'success',
  };

  // 1) Read file
  if (!fs.existsSync(filePath)) {
    summary.status = 'failed';
    summary.errors.push({ scope: 'file', message: `File not found: ${filePath}` });
    return finalize(summary, startedAt, opts.userId);
  }
  let stat;
  try { stat = fs.statSync(filePath); summary.fileSize = stat.size; }
  catch (err) {
    summary.status = 'failed';
    summary.errors.push({ scope: 'file', message: err.message });
    return finalize(summary, startedAt, opts.userId);
  }

  let wb;
  try { wb = XLSX.readFile(filePath, { cellDates: true }); }
  catch (err) {
    summary.status = 'failed';
    summary.errors.push({ scope: 'parse', message: err.message });
    return finalize(summary, startedAt, opts.userId);
  }

  // 2) Build customer + driver + car master from Database + Rule sheets
  const customerMap = await syncCustomers(wb, summary);
  const driverMap = await syncDrivers(wb, summary);
  const carMap = await syncCars(wb, summary);

  // 3) Build orders from Detail sheet, then enrich with invoice fields from Logbook
  const ordersByCode = await syncOrders(wb, customerMap, driverMap, carMap, summary);
  await syncLogbookInvoices(wb, ordersByCode, summary);

  if (summary.errors.length > 0 && (summary.ordersInserted > 0 || summary.ordersUpdated > 0)) {
    summary.status = 'partial';
  } else if (summary.errors.length > 0) {
    summary.status = 'failed';
  }

  return finalize(summary, startedAt, opts.userId);
}

async function finalize(summary, startedAt, userId) {
  summary.durationMs = Date.now() - startedAt;
  // Persist log row — never throw if logging fails
  try {
    await db.insert(syncLogs).values({
      source: summary.source,
      trigger: summary.trigger,
      status: summary.status,
      filePath: summary.filePath,
      fileSize: summary.fileSize,
      rowsRead: summary.rowsRead,
      customersInserted: summary.customersInserted,
      customersUpdated: summary.customersUpdated,
      driversInserted: summary.driversInserted,
      driversUpdated: summary.driversUpdated,
      carsInserted: summary.carsInserted,
      carsUpdated: summary.carsUpdated,
      ordersInserted: summary.ordersInserted,
      ordersUpdated: summary.ordersUpdated,
      errors: summary.errors.length > 0 ? summary.errors.slice(0, 100) : null,
      durationMs: summary.durationMs,
      triggeredBy: userId || null,
    });
  } catch (err) {
    console.error('[sync] failed to write sync_logs row:', err.message);
  }
  return summary;
}

// ────────────────────────────────────────────────────────────────────────────
// Customer master — Database sheet rows where Kategori="Company" or "Pribadi"
// + cross-check Rule sheet (cols 6-7) for any extra addresses.
// ────────────────────────────────────────────────────────────────────────────
async function syncCustomers(wb, summary) {
  /** name (lower) → customer.id */
  const map = new Map();
  const rows = wb.Sheets['Database'] ? sheetToObjects(wb.Sheets['Database']) : [];
  summary.rowsRead += rows.length;

  // Pull addresses from Rule sheet (cols 6-7 unnamed in headers)
  const ruleAddresses = new Map();
  const ruleSheet = wb.Sheets['Rule'];
  if (ruleSheet) {
    const aoa = XLSX.utils.sheet_to_json(ruleSheet, { header: 1, raw: false, defval: null });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const name = toStr(row[6]);
      const addr = toStr(row[7]);
      if (name && addr) ruleAddresses.set(name.toLowerCase(), addr);
    }
  }

  for (const r of rows) {
    const name = toStr(r['Nama']);
    if (!name) continue;
    const kategori = toStr(r['Kategori']).toLowerCase();
    if (kategori === 'driver') continue; // drivers go to syncDrivers below

    const customerType = kategori === 'company' ? 'company' : 'private';
    const phone = normPhone(r['Telepon']);
    const address = toStr(r['Alamat']) || ruleAddresses.get(name.toLowerCase()) || null;
    const isCompany = customerType === 'company';

    try {
      // Match by name+companyName tuple — case-insensitive
      const existing = await db.select().from(customers)
        .where(sql`LOWER(${customers.name}) = ${name.toLowerCase()}`)
        .limit(1);

      const values = {
        name,
        companyName: isCompany ? name : null,
        phone, whatsapp: phone,
        address,
        customerType,
        status: 'active',
      };

      if (existing.length > 0) {
        // Only fill in missing fields — never overwrite manually-edited data
        const cur = existing[0];
        const patch = {};
        if (!cur.address && address) patch.address = address;
        if (!cur.phone && phone) patch.phone = phone;
        if (!cur.companyName && isCompany) patch.companyName = name;
        if (!cur.customerType) patch.customerType = customerType;
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = new Date();
          await db.update(customers).set(patch).where(eq(customers.id, cur.id));
          summary.customersUpdated += 1;
        }
        map.set(name.toLowerCase(), cur.id);
      } else {
        const inserted = await db.insert(customers).values(values).returning();
        summary.customersInserted += 1;
        map.set(name.toLowerCase(), inserted[0].id);
      }
    } catch (err) {
      summary.errors.push({ scope: 'customer', name, message: err.message });
    }
  }

  return map;
}

// ────────────────────────────────────────────────────────────────────────────
// Driver master — Database "Driver" rows + Rule sheet col 0 (driver names) + col 1 (phone)
// ────────────────────────────────────────────────────────────────────────────
async function syncDrivers(wb, summary) {
  /** name (lower) → driver.id */
  const map = new Map();

  // Collect (name, phone) pairs from both sheets, dedupe by lowercase name
  const dedup = new Map(); // lowerName → { name, phone, address }

  // From Database
  const dbRows = wb.Sheets['Database'] ? sheetToObjects(wb.Sheets['Database']) : [];
  for (const r of dbRows) {
    const kategori = toStr(r['Kategori']).toLowerCase();
    if (kategori !== 'driver') continue;
    const name = toStr(r['Nama']);
    if (!name) continue;
    dedup.set(name.toLowerCase(), {
      name,
      phone: normPhone(r['Telepon']),
      address: toStr(r['Alamat']) || null,
    });
  }

  // From Rule (cols 0 = Nama Driver, 1 = phone — not always populated)
  const ruleSheet = wb.Sheets['Rule'];
  if (ruleSheet) {
    const aoa = XLSX.utils.sheet_to_json(ruleSheet, { header: 1, raw: false, defval: null });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const name = toStr(row[0]);
      if (!name) continue;
      const phone = normPhone(row[1]);
      const lower = name.toLowerCase();
      if (!dedup.has(lower)) dedup.set(lower, { name, phone, address: null });
      else if (!dedup.get(lower).phone && phone) dedup.get(lower).phone = phone;
    }
  }

  summary.rowsRead += dedup.size;

  for (const drv of dedup.values()) {
    try {
      const existing = await db.select().from(drivers)
        .where(sql`LOWER(${drivers.name}) = ${drv.name.toLowerCase()}`)
        .limit(1);

      const values = {
        name: drv.name,
        phone: drv.phone || '0000000000', // phone is NOT NULL in schema
        address: drv.address,
        status: 'active',
      };

      if (existing.length > 0) {
        const cur = existing[0];
        const patch = {};
        if ((!cur.phone || cur.phone === '0000000000') && drv.phone) patch.phone = drv.phone;
        if (!cur.address && drv.address) patch.address = drv.address;
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = new Date();
          await db.update(drivers).set(patch).where(eq(drivers.id, cur.id));
          summary.driversUpdated += 1;
        }
        map.set(drv.name.toLowerCase(), cur.id);
      } else {
        const inserted = await db.insert(drivers).values(values).returning();
        summary.driversInserted += 1;
        map.set(drv.name.toLowerCase(), inserted[0].id);
      }
    } catch (err) {
      summary.errors.push({ scope: 'driver', name: drv.name, message: err.message });
    }
  }

  return map;
}

// ────────────────────────────────────────────────────────────────────────────
// Car master — from Rule sheet (cols 2 = Mobil, 3 = Plat). Dedupe by license plate.
// We also pick up cars seen in Detail rows so nothing is missed.
// ────────────────────────────────────────────────────────────────────────────
async function syncCars(wb, summary) {
  /** plate (upper, no spaces) → car.id */
  const map = new Map();
  const dedup = new Map(); // plate → { brand/name, plate }

  const ruleSheet = wb.Sheets['Rule'];
  if (ruleSheet) {
    const aoa = XLSX.utils.sheet_to_json(ruleSheet, { header: 1, raw: false, defval: null });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const carName = toStr(row[2]);
      const plate = normalizePlate(row[3]);
      if (!carName || !plate) continue;
      if (!dedup.has(plate)) dedup.set(plate, { name: carName, brand: carName, plate });
    }
  }

  // Also pick up plates that appear in Detail rows
  const detailSheet = wb.Sheets['Detail'];
  if (detailSheet) {
    const rows = sheetToObjects(detailSheet);
    for (const r of rows) {
      const plate = normalizePlate(r['Plat']);
      const carName = toStr(r['Mobil']);
      if (!plate || !carName) continue;
      if (!dedup.has(plate)) dedup.set(plate, { name: carName, brand: carName, plate });
    }
  }

  summary.rowsRead += dedup.size;

  for (const car of dedup.values()) {
    try {
      const existing = await db.select().from(cars)
        .where(eq(cars.licensePlate, car.plate))
        .limit(1);

      // Best-guess type/category from car name
      const lower = car.name.toLowerCase();
      const type = guessCarType(lower);

      const values = {
        name: car.name,
        brand: deriveBrand(car.name),
        type,
        category: 'standard',
        licensePlate: car.plate,
        image: '/uploads/cars/placeholder.png', // schema requires NOT NULL
        price: '500000',                         // sane default; user can edit later
        capacity: 7,
        transmission: 'Automatic',
        fuel: 'Bensin',
        status: 'available',
        availableCount: 1,
      };

      if (existing.length > 0) {
        // Only patch missing fields
        const cur = existing[0];
        const patch = {};
        if (!cur.licensePlate) patch.licensePlate = car.plate;
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = new Date();
          await db.update(cars).set(patch).where(eq(cars.id, cur.id));
          summary.carsUpdated += 1;
        }
        map.set(car.plate, cur.id);
      } else {
        const inserted = await db.insert(cars).values(values).returning();
        summary.carsInserted += 1;
        map.set(car.plate, inserted[0].id);
      }
    } catch (err) {
      summary.errors.push({ scope: 'car', plate: car.plate, message: err.message });
    }
  }

  return map;
}

function normalizePlate(v) {
  return toStr(v).toUpperCase().replace(/\s+/g, '');
}
function deriveBrand(name) {
  const low = name.toLowerCase();
  if (low.includes('avanza') || low.includes('innova') || low.includes('rush') || low.includes('hiace') || low.includes('alphard')) return 'Toyota';
  if (low.includes('xpander') || low.includes('pajero')) return 'Mitsubishi';
  if (low.includes('xl7') || low.includes('ertiga')) return 'Suzuki';
  if (low.includes('brv') || low.includes('mobilio')) return 'Honda';
  return name; // best effort
}
function guessCarType(lower) {
  if (lower.includes('hiace') || lower.includes('alphard')) return 'MPV';
  if (lower.includes('rush') || lower.includes('pajero')) return 'SUV';
  if (lower.includes('sedan')) return 'Sedan';
  return 'MPV'; // default for the rental fleet
}

// ────────────────────────────────────────────────────────────────────────────
// Orders — Detail sheet, one row per Kode Transaksi.
// Foreign keys resolved via the maps built above.
// ────────────────────────────────────────────────────────────────────────────
async function syncOrders(wb, customerMap, driverMap, carMap, summary) {
  /** orderNumber → order row (returned for Logbook enrichment) */
  const ordersByCode = new Map();
  const detailSheet = wb.Sheets['Detail'];
  if (!detailSheet) return ordersByCode;

  const rows = sheetToObjects(detailSheet);
  summary.rowsRead += rows.length;

  for (const r of rows) {
    const orderNumber = toStr(r['Kode Transaksi']);
    if (!orderNumber || orderNumber.toLowerCase() === 'nan') continue;
    try {
      const customerName = toStr(r['Company Name']) || toStr(r['Nama']) || 'Private';
      const driverName = toStr(r['Driver']);
      const plate = normalizePlate(r['Plat']);

      let customerId = customerMap.get(customerName.toLowerCase());
      if (!customerId) {
        // Auto-create a thin customer record for anyone we missed
        const isCompany = customerName.toLowerCase().startsWith('pt') || customerName.toLowerCase().startsWith('cv');
        const [created] = await db.insert(customers).values({
          name: customerName,
          companyName: isCompany ? customerName : null,
          customerType: isCompany ? 'company' : 'private',
          status: 'active',
        }).returning();
        customerId = created.id;
        customerMap.set(customerName.toLowerCase(), customerId);
        summary.customersInserted += 1;
      }

      const driverId = driverName ? driverMap.get(driverName.toLowerCase()) || null : null;
      const carId = plate ? carMap.get(plate) || null : null;

      const { pickupDate, returnDate: parsedReturnDate } = parseTglPemakaian(r['Tgl Pemakaian']);
      const totalDays = Math.max(1, Math.floor(toNum(r['Jumlah Hari'])) || 1);
      // Use the end date from the range string when present; otherwise derive from totalDays.
      const returnDate = parsedReturnDate
        || (pickupDate ? new Date(pickupDate.getTime() + (totalDays - 1) * 24 * 60 * 60 * 1000) : null);
      const totalPrice = toNum(r['Kontrak Harga']);
      const dailyRate = totalPrice / totalDays;

      const values = {
        orderNumber,
        carId,
        customerId,
        driverId,
        pickupDate: pickupDate || new Date(),
        returnDate: returnDate || pickupDate || new Date(),
        totalDays,
        dailyRate: String(dailyRate.toFixed(2)),
        totalPrice: String(totalPrice.toFixed(2)),
        status: mapOrderStatus(r['Status']),
        package: toStr(r['Paket']) || null,
        destination: toStr(r['Tujuan']) || null,
        overnightNights: Math.floor(toNum(r['Inap/sppd']) || 0),
        overtimeHours: String(toNum(r['Lembur'])),
        bailout: String(toNum(r['Bailout'])),
        sourceOrigin: 'rekap_xlsx',
      };

      const existing = await db.select().from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);

      if (existing.length > 0) {
        // Patch only fields that changed and only for rekap-origin rows.
        // Web-created orders are NEVER overwritten by sync — they're the
        // source of truth for anything edited in the admin panel.
        const cur = existing[0];
        if (cur.sourceOrigin === 'web') {
          ordersByCode.set(orderNumber, cur);
          continue;
        }
        const patch = {};
        for (const [k, v] of Object.entries(values)) {
          if (k === 'orderNumber' || k === 'sourceOrigin') continue;
          if (cur[k] === undefined || cur[k] === null) {
            if (v !== null && v !== undefined) patch[k] = v;
          } else if (typeof v === 'string' && typeof cur[k] === 'string' && cur[k] !== v) {
            patch[k] = v;
          } else if (v instanceof Date && cur[k] instanceof Date && v.getTime() !== cur[k].getTime()) {
            patch[k] = v;
          } else if (typeof v === 'number' && Number(cur[k]) !== v) {
            patch[k] = v;
          }
        }
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = new Date();
          await db.update(orders).set(patch).where(eq(orders.id, cur.id));
          summary.ordersUpdated += 1;
        }
        ordersByCode.set(orderNumber, { ...cur, ...patch });
      } else {
        // createdAt defaults to NOW() — matches user requirement
        const [inserted] = await db.insert(orders).values(values).returning();
        summary.ordersInserted += 1;
        ordersByCode.set(orderNumber, inserted);
      }
    } catch (err) {
      summary.errors.push({ scope: 'order', kodeTransaksi: orderNumber, message: err.message });
    }
  }

  return ordersByCode;
}

// ────────────────────────────────────────────────────────────────────────────
// Logbook → invoice metadata on existing orders.
// Logbook rows are keyed by Kode Transaksi → match orders, fill billing fields.
// ────────────────────────────────────────────────────────────────────────────
async function syncLogbookInvoices(wb, ordersByCode, summary) {
  const sheet = wb.Sheets['Logbook'];
  if (!sheet) return;
  const rows = sheetToObjects(sheet);
  summary.rowsRead += rows.length;

  for (const r of rows) {
    const orderNumber = toStr(r['Kode Transaksi']);
    if (!orderNumber) continue;
    const target = ordersByCode.get(orderNumber);
    if (!target) continue;

    try {
      const patch = {
        invoiceNumber: toStr(r['No. Invoice']) || null,
        invoiceLetterNumber: toStr(r['No. Surat']) || null,
        invoiceSentDate: toDate(r['Tanggal Kirim']),
        invoiceDueDate: toDate(r['Due Date']),
        invoicePaidDate: toDate(r['Tanggal Realisasi']),
        invoicePaymentStatus: toStr(r['Status']) || null,
        updatedAt: new Date(),
      };
      // Don't blow away non-empty fields with empty Logbook cells
      for (const k of Object.keys(patch)) if (patch[k] === null || patch[k] === '') delete patch[k];
      if (Object.keys(patch).length <= 1) continue; // only updatedAt

      await db.update(orders).set(patch).where(eq(orders.id, target.id));
    } catch (err) {
      summary.errors.push({ scope: 'logbook', kodeTransaksi: orderNumber, message: err.message });
    }
  }
}
