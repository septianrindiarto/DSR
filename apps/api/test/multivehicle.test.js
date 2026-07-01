// Tier 2 multi-vehicle — zero-dependency smoke tests.
//
// Run with:  node --test            (from apps/api)
//        or  node --test test/multivehicle.test.js
//
// These exercise the PURE, side-effect-free logic only (no DB, no network),
// so they run anywhere Node 22+ is installed without provisioning anything.
// DB/HTTP-bound flows are covered by the manual matrix in
// docs/Tier2_E2E_Test_Matrix.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderMessage } from '../src/services/telegram.service.js';

const customer = { name: 'PT Foo', companyName: 'PT Foo', phone: '081234567890' };
const baseOrder = (over = {}) => ({
    orderNumber: 'C073',
    pickupDate: '2026-07-01',
    returnDate: '2026-07-03',
    totalDays: 3,
    destination: 'Bandung',
    ...over,
});

test('Telegram: single-car message keeps the classic layout', () => {
    const car = { brand: 'Toyota', name: 'Avanza', licensePlate: 'D 1234 XY' };
    const msg = buildOrderMessage({
        order: baseOrder({ totalPrice: '1245000', package: 'Reguler' }),
        orders: [baseOrder({ totalPrice: '1245000', package: 'Reguler', car })],
        customer,
        source: 'landing',
    });
    assert.ok(msg, 'message should be built');
    assert.ok(msg.includes('Order baru'), 'has header');
    assert.ok(!msg.includes('kendaraan)'), 'no multi-count header for single car');
    assert.ok(msg.includes('Toyota Avanza'), 'shows the car');
    assert.ok(msg.includes('C073'), 'shows the shared code');
});

test('Telegram: multi-car message lists every car + grand total', () => {
    const rows = [
        baseOrder({ id: 1, totalPrice: '1245000', car: { brand: 'Toyota', name: 'Avanza', licensePlate: 'D 1' } }),
        baseOrder({ id: 2, totalPrice: '1500000', car: { brand: 'Toyota', name: 'Innova', licensePlate: 'D 2' } }),
        baseOrder({ id: 3, totalPrice: '900000',  car: { brand: 'Daihatsu', name: 'Xenia', licensePlate: 'D 3' } }),
    ];
    const msg = buildOrderMessage({ order: rows[0], orders: rows, customer, source: 'dashboard' });
    assert.ok(msg.includes('(3 kendaraan)'), 'header shows car count');
    assert.ok(msg.includes('Avanza') && msg.includes('Innova') && msg.includes('Xenia'), 'lists all 3 cars');
    // Prices were removed from the alert per product request.
    assert.ok(!msg.includes('Rp'), 'no price/total shown in the notification');
});

test('Telegram: request view groups as "N unit Category" with jemput/tujuan', () => {
    const rows = [
        baseOrder({ id: 1 }), baseOrder({ id: 2 }), baseOrder({ id: 3 }),
    ];
    const requestVehicles = [
        { carCategoryRequested: 'MPV', quantity: 2, pickupLocation: 'Bandung', destination: 'Jakarta' },
        { carCategoryRequested: 'SUV', quantity: 1, pickupLocation: 'Bandung', destination: 'Bogor' },
    ];
    const msg = buildOrderMessage({ order: rows[0], orders: rows, customer, source: 'landing', requestVehicles });
    assert.ok(msg.includes('(3 kendaraan)'), 'header counts total units');
    assert.ok(msg.includes('1. 2 unit MPV'), 'groups MPV as 2 units');
    assert.ok(msg.includes('2. 1 unit SUV'), 'groups SUV as 1 unit');
    assert.ok(msg.includes('jemput di Bandung tujuan Jakarta'), 'per-vehicle pickup/destination');
    assert.ok(!msg.includes('Rp'), 'no price shown');
});

test('Telegram: empty order set yields null (caller treats as no-op)', () => {
    assert.equal(buildOrderMessage({ orders: [] }), null);
    assert.equal(buildOrderMessage({ order: null }), null);
});

// ─── Booking grouping invariant (mirrors AdminOrders + invoice prefill) ──────
// Rows sharing a non-empty orderNumber form one booking; codeless rows are
// standalone. This is the contract the Rekap grouping and invoice sibling
// resolution both rely on.
function groupByCode(rows) {
    const map = new Map();
    const seq = [];
    for (const o of rows) {
        const code = (o.orderNumber || '').trim();
        const key = code ? `code:${code}` : `id:${o.id}`;
        if (!map.has(key)) { map.set(key, []); seq.push(key); }
        map.get(key).push(o);
    }
    return seq.map(k => ({ key: k, rows: map.get(k), isGroup: map.get(k).length > 1 }));
}

test('Grouping: 3 rows of one code collapse to a single multi-car group', () => {
    const groups = groupByCode([
        { id: 1, orderNumber: 'C073' },
        { id: 2, orderNumber: 'C073' },
        { id: 3, orderNumber: 'C073' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].isGroup, true);
    assert.equal(groups[0].rows.length, 3);
});

test('Grouping: distinct + codeless rows are separate single rows', () => {
    const groups = groupByCode([
        { id: 1, orderNumber: 'C073' },
        { id: 2, orderNumber: 'P010' },
        { id: 3, orderNumber: '' },
        { id: 4, orderNumber: null },
    ]);
    assert.equal(groups.length, 4);
    assert.ok(groups.every(g => !g.isGroup));
});

// ─── Analytics dimension invariant ───────────────────────────────────────────
// cars_rented counts rows; trips_booked counts distinct codes. A 3-car booking
// must read as 1 trip / 3 cars — the miscalculation this audit guards against.
function dimensions(rows) {
    const codes = new Set();
    for (const o of rows) codes.add((o.orderNumber || '').trim() || `id:${o.id}`);
    return { cars: rows.length, trips: codes.size };
}

test('Analytics: 3-car booking = 1 trip, 3 cars', () => {
    const d = dimensions([
        { id: 1, orderNumber: 'C073' },
        { id: 2, orderNumber: 'C073' },
        { id: 3, orderNumber: 'C073' },
    ]);
    assert.deepEqual(d, { cars: 3, trips: 1 });
});

test('Analytics: mixed bookings count trips distinctly', () => {
    const d = dimensions([
        { id: 1, orderNumber: 'C073' },
        { id: 2, orderNumber: 'C073' },
        { id: 3, orderNumber: 'P010' },
        { id: 4, orderNumber: 'P011' },
    ]);
    assert.deepEqual(d, { cars: 4, trips: 3 });
});

// ─── Invoice totals invariant (mirrors InvoiceTemplate) ──────────────────────
// Per-row charge = price + lembur*50k + inap*150k; subtotal sums rows; the
// 4-day auto-discount keys off rental DAYS (date span), never the car count.
function invoiceTotals(items, { autoDisc = true, pajakRate = 0, discount = 0 } = {}) {
    const itemsTotal = items.reduce((s, it) =>
        s + Number(it.price || 0) + Number(it.lembur || 0) * 50000 + Number(it.inap || 0) * 150000, 0);
    const subTotal = itemsTotal * (1 + pajakRate / 100);
    const rentalDays = Math.max(1, ...items.map(it => {
        const d1 = new Date(it.rentDate), d2 = new Date(it.rentReturnDate);
        if (isNaN(d1) || isNaN(d2)) return 1;
        return Math.floor((d2 - d1) / 86400000) + 1;
    }));
    const auto = autoDisc && rentalDays >= 4;
    const disc = auto ? subTotal * 0.05 : Number(discount || 0);
    return { subTotal, grand: subTotal - disc, rentalDays, auto };
}

test('Invoice: multi-car subtotal sums every line', () => {
    const r = invoiceTotals([
        { price: 1245000, rentDate: '2026-07-01', rentReturnDate: '2026-07-03' },
        { price: 1500000, rentDate: '2026-07-01', rentReturnDate: '2026-07-03' },
    ], { autoDisc: false });
    assert.equal(r.subTotal, 2745000);
    assert.equal(r.grand, 2745000);
});

test('Invoice: auto-discount keys off days, NOT car count', () => {
    // 4 cars, 1-day rental → must NOT trigger the 4-day discount.
    const shortTrip = invoiceTotals(
        Array.from({ length: 4 }, () => ({ price: 1000000, rentDate: '2026-07-01', rentReturnDate: '2026-07-01' })),
    );
    assert.equal(shortTrip.auto, false, '4 cars on a 1-day trip must not auto-discount');

    // 1 car, 5-day rental → SHOULD trigger.
    const longTrip = invoiceTotals([{ price: 5000000, rentDate: '2026-07-01', rentReturnDate: '2026-07-05' }]);
    assert.equal(longTrip.auto, true, '5-day rental should auto-discount');
    assert.equal(longTrip.grand, 5000000 - 5000000 * 0.05);
});
