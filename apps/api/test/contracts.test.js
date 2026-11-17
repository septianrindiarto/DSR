// Contracts + fleet care rules (pure). Run: node --test test/contracts.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, activeDays, contractPeriods, billingLines, renewalReminderDue } from '../src/services/contracts-core.js';
import { docStatus, serviceStatus, unitAlerts } from '../src/services/fleetcare-core.js';

test('period range & contract periods', () => {
    assert.deepEqual(periodRange('2026-02'), { from: '2026-02-01', to: '2026-02-28', days: 28 });
    assert.deepEqual(contractPeriods('2026-11-15', '2027-02-10'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('pro-rata active days', () => {
    assert.equal(activeDays({ contractStart: '2026-10-16', contractEnd: '2027-10-15', period: '2026-10' }), 16);
    assert.equal(activeDays({ contractStart: '2026-01-01', contractEnd: '2027-01-01', period: '2026-10' }), 31);
    assert.equal(activeDays({ contractStart: '2026-01-01', contractEnd: '2027-01-01', unitStart: '2026-10-21', period: '2026-10' }), 11);
    assert.equal(activeDays({ contractStart: '2026-01-01', contractEnd: '2026-09-30', period: '2026-10' }), 0);
});

test('billing: full monthly fee even for a partial month (no pro-rata) + excess km', () => {
    const contract = { startDate: '2026-10-16', endDate: '2027-10-15', kmAllowanceMonth: 3100, excessKmRate: 1500 };
    const units = [{ id: 1, carId: 7, monthlyFee: 9300000 }, { id: 2, carId: 8, monthlyFee: 6200000 }];
    const r = billingLines({ contract, units, period: '2026-10', kmUsed: { 1: 4000, 2: null } });
    // 16 of 31 days used → still the full fee and full quota (3100 km); 900 km × 1500 = 1.350.000
    assert.equal(r.lines[0].fee, 9300000);
    assert.equal(r.lines[0].kmAllowed, 3100);
    assert.equal(r.lines[0].excessCharge, 1350000);
    assert.equal(r.lines[1].excessCharge, 0);       // no readings → no excess
    assert.equal(r.total, 9300000 + 1350000 + 6200000);
});

test('renewal reminders 60 / 30 / 7 days, once each', () => {
    assert.deepEqual(renewalReminderDue('2026-12-21', '2026-10-22'), { threshold: 60, daysLeft: 60 });
    assert.equal(renewalReminderDue('2026-12-21', '2026-10-22', { 60: true }), null);
    assert.deepEqual(renewalReminderDue('2026-11-20', '2026-10-22', { 60: true }), { threshold: 30, daysLeft: 29 });
    assert.equal(renewalReminderDue('2026-10-01', '2026-10-22'), null);
});

test('documents: expired / soon / ok', () => {
    assert.equal(docStatus('2026-10-01', '2026-10-22').status, 'expired');
    assert.equal(docStatus('2026-11-10', '2026-10-22').status, 'soon');
    assert.equal(docStatus('2027-06-01', '2026-10-22').status, 'ok');
    assert.equal(docStatus(null, '2026-10-22'), null);
});

test('service due by km or date, whichever first', () => {
    const base = { serviceIntervalKm: 10000, serviceIntervalMonths: 6, lastServiceKm: 40000, lastServiceDate: '2026-06-01' };
    assert.equal(serviceStatus({ ...base, currentOdometer: 49800 }, '2026-10-22').status, 'soon');      // 200 km left
    assert.equal(serviceStatus({ ...base, currentOdometer: 51000 }, '2026-10-22').status, 'overdue');
    assert.equal(serviceStatus({ ...base, currentOdometer: 45000 }, '2026-12-05').status, 'overdue');   // date passed (2026-12-01)
    assert.equal(serviceStatus({ currentOdometer: 1000 }, '2026-10-22').status, 'unknown');
    assert.equal(unitAlerts({ ...base, currentOdometer: 51000, stnkExpiry: '2026-11-01' }, '2026-10-22').length, 2);
});

import { sideOf, otherSide, approvalBlockers, bothApproved } from '../src/services/contracts-core.js';

test('workflow: side of user', () => {
    assert.equal(sideOf({ role: 'superadmin' }), 'super');
    assert.equal(sideOf({ role: 'admin', accountType: 'client' }), 'client');
    assert.equal(sideOf({ role: 'admin', accountType: 'agency' }), 'agency');
    assert.equal(otherSide('client'), 'agency');
    assert.equal(otherSide('agency'), 'client');
});

test('workflow: approval blockers', () => {
    const c = { status: 'draft' };
    assert.deepEqual(approvalBlockers({ contract: c, units: [{ monthlyFee: 100 }], docs: [] }), []);
    assert.equal(approvalBlockers({ contract: c, units: [], docs: [] }).length, 1);
    assert.equal(approvalBlockers({ contract: c, units: [{ monthlyFee: 0 }], docs: [] }).length, 1);
    const docs = [
        { mandatory: true, status: 'uploaded', requiredFrom: 'agency', title: 'Penawaran' },
        { mandatory: false, status: 'pending', requiredFrom: 'client', title: 'Opsional' },
        { mandatory: true, status: 'approved', requiredFrom: 'client', title: 'NPWP' },
    ];
    const b = approvalBlockers({ contract: c, units: [{ monthlyFee: 1 }], docs });
    assert.equal(b.length, 1);
    assert.match(b[0], /Penawaran/);
    assert.equal(approvalBlockers({ contract: { status: 'active' }, units: [{ monthlyFee: 1 }] }).length, 1);
    assert.equal(bothApproved({ agencyApprovedAt: 1, clientApprovedAt: null }), false);
    assert.equal(bothApproved({ agencyApprovedAt: 1, clientApprovedAt: 2 }), true);
});

import { termBlockers } from '../src/services/contracts-core.js';
test('workflow: empty terms block approval, not saving', () => {
    assert.equal(termBlockers({ billingDay: null, package: '' }).length, 2);
    assert.equal(termBlockers({ billingDay: 1, package: 'All In' }).length, 0);
    assert.equal(termBlockers({ billingDay: 1, package: 'All In' }, { overtime: { enabled: true } }).length, 1);
});

// ─── Monthly M codes & amendments (owner 2026-11-13) ────────────────────────
import { monthIndexOf, duePeriods, dayBefore, firstOfNextMonth } from '../src/services/contracts-core.js';

test('M codes: months due up to now, numbered per contract, stop at amendment', () => {
    assert.equal(monthIndexOf('2026-11-05', '2026-11'), 1);
    assert.equal(monthIndexOf('2026-11-05', '2027-02'), 4);
    assert.deepEqual(duePeriods({ startDate: '2026-10-15', endDate: '2027-10-14', todayIso: '2026-11-13' }), ['2026-10', '2026-11']);
    assert.deepEqual(duePeriods({ startDate: '2026-12-01', endDate: '2027-11-30', todayIso: '2026-11-13' }), []);
    assert.deepEqual(duePeriods({ startDate: '2026-09-01', endDate: '2027-08-31', todayIso: '2026-11-13', stopFrom: '2026-11' }), ['2026-09', '2026-10']);
    assert.equal(dayBefore('2026-12-01'), '2026-11-30');
    assert.equal(firstOfNextMonth('2026-12-13'), '2027-01-01');
});

// ─── Contract-month cycles (owner 2026-11-13) ───────────────────────────────
import { contractCycles, cycleInvoiceDate, cycleLine, dueCycles, addMonthsIso } from '../src/services/contracts-core.js';

test('cycles follow the contract start, not the calendar month', () => {
    assert.deepEqual(contractCycles('2026-11-05', '2026-12-01'), [{ index: 1, from: '2026-11-05', to: '2026-12-01', period: '2026-11' }]);
    const yr = contractCycles('2026-11-05', '2027-11-04');
    assert.equal(yr.length, 12);
    assert.deepEqual(yr[1], { index: 2, from: '2026-12-05', to: '2027-01-04', period: '2026-12' });
    assert.equal(addMonthsIso('2027-01-31', 1), '2027-02-28');
    assert.equal(cycleInvoiceDate('2026-11-05', 1), '2026-12-01');     // tagih 1 → 1 Des
    assert.equal(cycleInvoiceDate('2026-11-05', 10), '2026-11-10');
    assert.equal(dueCycles({ startDate: '2026-11-05', endDate: '2027-11-04', todayIso: '2026-12-04' }).length, 1);
});

test('every contract month = the full monthly fee and quota (no pro-rata)', () => {
    const contract = { kmAllowanceMonth: 5000, excessKmRate: 2000 };
    const cycle = { from: '2026-11-05', to: '2026-12-01' };
    const full = cycleLine({ contract, unit: { monthlyFee: 1000000 }, cycle, kmUsed: 500 });
    assert.equal(full.fee, 1000000); assert.equal(full.kmAllowed, 5000); assert.equal(full.excessKm, 0);
    const over = cycleLine({ contract, unit: { monthlyFee: 1000000 }, cycle, kmUsed: 5300 });
    assert.equal(over.excessKm, 300); assert.equal(over.excessCharge, 600000); assert.equal(over.total, 1600000);
    // unit used only 11 days of the month → still the agreed monthly fee and quota (owner 2026-11-13)
    const late = cycleLine({ contract, unit: { monthlyFee: 900000, startDate: '2026-11-21' }, cycle, kmUsed: 5100 });
    assert.equal(late.days, 11); assert.equal(late.fee, 900000);
    assert.equal(late.from, '2026-11-05'); assert.equal(late.activeFrom, '2026-11-21');   // period = contract month assert.equal(late.kmAllowed, 5000); assert.equal(late.total, 900000 + 200000);
    const oneDay = cycleLine({ contract, unit: { monthlyFee: 900000, startDate: '2026-12-01' }, cycle });
    assert.equal(oneDay.fee, 900000);
});

import { openCycles, kmSegments, segmentsKmUsed, kmCheck } from '../src/services/contracts-core.js';

test('openCycles: first month at activation, next on H+1 after tanggal tagih', () => {
    const base = { startDate: '2026-11-05', endDate: '2027-11-04', billingDay: 1 };
    // cycle 1 = 05 Nov–04 Des, tanggal tagih 01 Des → cycle 2 appears on 02 Des
    assert.deepEqual(openCycles({ ...base, todayIso: '2026-10-20' }).map((c) => c.index), [1]);
    assert.deepEqual(openCycles({ ...base, todayIso: '2026-12-01' }).map((c) => c.index), [1]);
    assert.deepEqual(openCycles({ ...base, todayIso: '2026-12-02' }).map((c) => c.index), [1, 2]);
    // billing day 25: cycle 1 tagih 25 Nov → cycle 2 on 26 Nov
    assert.deepEqual(openCycles({ ...base, billingDay: 25, todayIso: '2026-11-26' }).map((c) => c.index), [1, 2]);
    // stopped by an amendment from 05 Jan
    assert.deepEqual(openCycles({ ...base, todayIso: '2027-06-01', stopFrom: '2027-01-05' }).map((c) => c.index), [1, 2]);
});

test('kmSegments: replacement km counts, maintenance days without replacement do not', () => {
    const base = { from: '2026-11-05', to: '2026-12-04', carId: 3 };
    assert.deepEqual(kmSegments(base).map((x) => [x.role, x.from, x.to]), [['unit', '2026-11-05', '2026-12-04']]);
    const withRep = kmSegments({ ...base, replacements: [{ id: 1, carId: 9, from: '2026-11-10', to: '2026-11-12' }] });
    assert.deepEqual(withRep.map((x) => [x.role, x.carId, x.from, x.to]), [
        ['unit', 3, '2026-11-05', '2026-11-09'], ['replacement', 9, '2026-11-10', '2026-11-12'], ['unit', 3, '2026-11-13', '2026-12-04']]);
    // maintenance 20–21 without replacement → gap; open-ended replacement clipped to the month
    const gaps = kmSegments({ ...base, maintenances: [{ from: '2026-11-20', to: '2026-11-21' }], replacements: [{ id: 2, carId: 8, from: '2026-12-01', to: null }] });
    assert.deepEqual(gaps.map((x) => [x.role, x.from, x.to]), [
        ['unit', '2026-11-05', '2026-11-19'], ['unit', '2026-11-22', '2026-11-30'], ['replacement', '2026-12-01', '2026-12-04']]);
    assert.equal(segmentsKmUsed([{ kmStart: 100, kmEnd: 150 }, { kmStart: 10, kmEnd: 40 }, { kmStart: null, kmEnd: null }]), 80);
    assert.equal(segmentsKmUsed([{ kmStart: null, kmEnd: null }]), null);
});

test('kmCheck: KM must equal the operasional km; empty KM only warns', () => {
    const seg = { key: 'u', role: 'unit', carId: 3, from: '2026-11-05', to: '2026-12-04' };
    const oRowsByCar = { 3: [{ date: '2026-11-06', kmStart: 1000, kmEnd: 1100 }, { date: '2026-11-07', kmStart: 1100, kmEnd: 1180 }] };
    assert.deepEqual(kmCheck({ segments: [{ ...seg, kmStart: 1000, kmEnd: 1180 }], oRowsByCar }).issues, []);
    assert.equal(kmCheck({ segments: [{ ...seg, kmStart: 1000, kmEnd: 1180 }], oRowsByCar }).perSeg.u.oKm, 180);
    assert.equal(kmCheck({ segments: [{ ...seg, kmStart: 990, kmEnd: 1180 }], oRowsByCar }).issues.length, 1);    // not equal
    assert.equal(kmCheck({ segments: [{ ...seg, kmStart: 1000, kmEnd: 1500 }], oRowsByCar }).issues.length, 1);
    const empty = kmCheck({ segments: [{ ...seg, kmStart: null, kmEnd: null }], oRowsByCar });
    assert.deepEqual([empty.issues.length, empty.warnings.length], [0, 1]);                                         // optional
    assert.deepEqual(kmCheck({ segments: [{ ...seg, kmStart: 500, kmEnd: 700 }] }).issues, []);                     // no O forms
    assert.equal(kmCheck({ segments: [{ ...seg, kmStart: 900, kmEnd: 800 }] }).issues.length, 1);                   // akhir < awal
    assert.equal(kmCheck({ segments: [{ ...seg, kmStart: 990, kmEnd: 1500 }], prevKmEnd: 1000 }).warnings.length, 1);
    // replacement segment checked against the replacement car's forms
    const rep = { key: 'r', role: 'replacement', carId: 9, from: '2026-11-10', to: '2026-11-12', kmStart: 50, kmEnd: 90 };
    assert.equal(kmCheck({ segments: [rep], oRowsByCar: { 9: [{ date: '2026-11-11', kmStart: 50, kmEnd: 90 }], 3: oRowsByCar[3] } }).issues.length, 0);
});
