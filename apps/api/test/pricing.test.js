// Pricing engine rules (pure). Run: node --test test/pricing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote, resolveZone, normalizePackage, normalizeCategory, inclusiveDays, unitPriceFor, normCity } from '../src/services/pricing-core.js';

const zoneCities = [
    { city: 'Bandung', cityNorm: 'bandung', zone: 1 },
    { city: 'Jakarta', cityNorm: 'jakarta', zone: 2 },
    { city: 'Serang', cityNorm: 'serang', zone: 4 },
];
const rateCards = [
    { category: 'MPV', package: 'all_in', zone: 1, carModel: '', pricePerDay: 750000 },
    { category: 'MPV', package: 'all_in', zone: 2, carModel: '', pricePerDay: 850000 },
    { category: 'SUV', package: 'all_in', zone: 1, carModel: '', pricePerDay: 1100000 },
    { category: 'SUV', package: 'all_in', zone: 1, carModel: 'Innova Zenix', pricePerDay: 1400000 },
];

test('normalizers accept the form labels', () => {
    assert.equal(normalizePackage('Mobil dan Driver'), 'car_driver');
    assert.equal(normalizePackage('Mobil & Driver'), 'car_driver');
    assert.equal(normalizePackage('ALL IN'), 'all_in');
    assert.equal(normalizePackage('Lepas Kunci'), 'lepas_kunci');
    assert.equal(normalizeCategory('city car'), 'City Car');
    assert.equal(normalizeCategory('Lainnya'), null);
    assert.equal(normCity('Kota Bandung'), 'bandung');
});

test('zone from destination; highest tier wins; default fallback', () => {
    assert.deepEqual(resolveZone('Kantor di Bandung', zoneCities), { zone: 1, source: 'city', city: 'Bandung' });
    assert.equal(resolveZone('Bandung - Jakarta - Serang', zoneCities).zone, 4);
    assert.equal(resolveZone('Bandungan', zoneCities).zone, null);          // whole words only
    assert.equal(resolveZone('Surabaya', zoneCities, 3).source, 'default');
});

test('inclusive days like orders', () => {
    assert.equal(inclusiveDays('2026-10-01', '2026-10-01'), 1);
    assert.equal(inclusiveDays('2026-10-01', '2026-10-03'), 3);
});

test('rate card × days, rounding, overtime and overnight', () => {
    const q = computeQuote({
        items: [{ category: 'MPV', package: 'All In', destination: 'Jakarta', quantity: 2, overtimeHours: 3, overnightNights: 1 }],
        pickupDate: '2026-10-01', returnDate: '2026-10-02', rateCards, zoneCities,
        settings: { overtimePerHour: 50000, overnightPerNight: 150000, rounding: 1000 },
    });
    // (850k × 2 days) + 3 × 50k + 150k = 2,000,000 per unit × 2 units
    assert.equal(q.items[0].perUnit, 2000000);
    assert.equal(q.total, 4000000);
    assert.equal(q.complete, true);
    assert.equal(q.items[0].source, 'rate_card');
});

test('model override beats category rate', () => {
    const u = unitPriceFor({ category: 'SUV', pkg: 'all_in', zone: 1, carModel: 'Toyota Innova Zenix HV' }, rateCards);
    assert.deepEqual([u.unitPrice, u.source], [1400000, 'model']);
});

test('corporate fixed price and discount', () => {
    const corp = [{ category: 'MPV', package: 'all_in', zone: 0, pricePerDay: 700000 }];
    assert.equal(unitPriceFor({ category: 'MPV', pkg: 'all_in', zone: 2 }, rateCards, corp).unitPrice, 700000);
    const disc = [{ category: 'MPV', package: 'all_in', zone: 2, discountPct: 10 }];
    const u = unitPriceFor({ category: 'MPV', pkg: 'all_in', zone: 2 }, rateCards, disc);
    assert.deepEqual([u.unitPrice, u.listPrice, u.source], [765000, 850000, 'corporate']);
    const expired = [{ category: 'MPV', package: 'all_in', zone: 0, pricePerDay: 1, validUntil: '2020-01-01' }];
    assert.equal(unitPriceFor({ category: 'MPV', pkg: 'all_in', zone: 1 }, rateCards, expired, '2026-10-15').source, 'rate_card');
});

test('missing rate / zone → incomplete, price 0 (price on request)', () => {
    const q = computeQuote({ items: [{ category: 'LCV', package: 'All In', destination: 'Bandung' }, { category: 'MPV', package: 'All In', destination: 'Surabaya' }],
        pickupDate: '2026-10-01', returnDate: '2026-10-01', rateCards, zoneCities });
    assert.equal(q.complete, false);
    assert.deepEqual(q.items[0].missing, ['rate']);
    assert.ok(q.items[1].missing.includes('zone'));
    assert.equal(q.total, 0);
});

test('legacy car price is used when there is no rate card', () => {
    const q = computeQuote({ items: [{ category: 'Sedan', package: 'Lepas Kunci', zone: 1, carPrice: 400000 }],
        pickupDate: '2026-10-01', returnDate: '2026-10-02', rateCards, zoneCities });
    assert.deepEqual([q.items[0].source, q.total], ['car', 800000]);
});
