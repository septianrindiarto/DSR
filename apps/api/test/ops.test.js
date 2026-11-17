// Rekap Operasional & Lembur rules (pure). Run: node --test test/ops.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { overtimeHours, cutoffRange, periodOfDate, workingDaysBetween, dayTypeOf, reminderDue, nextCode, recapTotals, parseHM } from '../src/services/ops-core.js';

test('parseHM', () => {
    assert.equal(parseHM('08:00'), 480);
    assert.equal(parseHM('7:30'), 450);
    assert.equal(parseHM('24:00'), null);
    assert.equal(parseHM(''), null);
});

test('overtime = time outside 08:00–17:00 on workdays', () => {
    assert.equal(overtimeHours({ startTime: '06:00', endTime: '20:00' }), 5);      // 2 before + 3 after
    assert.equal(overtimeHours({ startTime: '08:00', endTime: '17:00' }), 0);
    assert.equal(overtimeHours({ startTime: '17:00', endTime: '21:30' }), 4.5);
    assert.equal(overtimeHours({ startTime: '20:00', endTime: '02:00' }), 6);      // crosses midnight
    assert.equal(overtimeHours({ startTime: '15:00', endTime: '09:00' }), 15);     // 18h span − 2h today − 1h tomorrow
    assert.equal(overtimeHours({ startTime: '07:00', endTime: '18:00', workStart: '07:00', workEnd: '19:00' }), 0);
    assert.equal(overtimeHours({ startTime: 'x', endTime: '10:00' }), null);
});

test('rest days and holidays count the whole span', () => {
    assert.equal(overtimeHours({ startTime: '08:00', endTime: '17:00', dayType: 'restday' }), 9);
    assert.equal(overtimeHours({ startTime: '09:00', endTime: '12:15', dayType: 'holiday' }), 3.25);
});

test('cut-off ranges', () => {
    assert.deepEqual(cutoffRange('2026-10'), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(cutoffRange('2026-10', 25), { from: '2026-09-26', to: '2026-10-25' });
    assert.deepEqual(cutoffRange('2026-01', 20), { from: '2025-12-21', to: '2026-01-20' });
    assert.deepEqual(cutoffRange('2026-03', 28), { from: '2026-03-01', to: '2026-03-28' }); // Feb 2026 has 28 days
    assert.equal(periodOfDate('2026-10-25', 25), '2026-10');
    assert.equal(periodOfDate('2026-10-26', 25), '2026-11');
    assert.equal(periodOfDate('2026-12-30', 25), '2027-01');
    assert.equal(periodOfDate('2026-10-31'), '2026-10');
});

test('working days skip weekends and holidays', () => {
    // Fri 2026-10-23 → Fri 2026-10-30 = Mon..Fri = 5
    assert.equal(workingDaysBetween('2026-10-23', '2026-10-30'), 5);
    assert.equal(workingDaysBetween('2026-10-23', '2026-10-30', new Set(['2026-10-28'])), 4);
    assert.equal(dayTypeOf('2026-10-24'), 'restday');
    assert.equal(dayTypeOf('2026-10-28', new Set(['2026-10-28'])), 'holiday');
    assert.equal(dayTypeOf('2026-10-27'), 'workday');
});

test('reminders every 5 working days, escalate after 2', () => {
    assert.equal(reminderDue({ submittedOn: '2026-10-23', today: '2026-10-29' }), null);
    assert.deepEqual(reminderDue({ submittedOn: '2026-10-23', today: '2026-10-30' }), { number: 1, escalate: false });
    const two = [{ on: '2026-10-30' }, { on: '2026-11-06' }];
    assert.equal(reminderDue({ submittedOn: '2026-10-23', reminders: two, today: '2026-11-12' }), null);
    assert.deepEqual(reminderDue({ submittedOn: '2026-10-23', reminders: two, today: '2026-11-13' }), { number: 3, escalate: true });
});

test('codes and totals', () => {
    assert.equal(nextCode('R', []), 'R001');
    assert.equal(nextCode('R', ['R009', 'R010', 'C120', 'Rx']), 'R011');
    assert.equal(nextCode('M', ['M099']), 'M100');
    assert.deepEqual(recapTotals([{ hours: '2.5', amount: '50000' }, { hours: 1.25, amount: null }]), { count: 2, hours: 3.75, amount: 50000 });
});

// ─── forms (lembur / perjalanan dinas) — parameterised matrix ───
import { roundMinutes, splitTiers, spklCompute, tripCompute, policyOf, policyBlockers, SAMPLE_POLICY, hourlyRateOf } from '../src/services/ops-core.js';

const BANDS = SAMPLE_POLICY.overtime.rounding;   // 0–29 → 0 · 30–45 → ½ · 46–59 → 1

test('minute rounding by bands (none = exact)', () => {
    assert.equal(roundMinutes(29, BANDS), 0);
    assert.equal(roundMinutes(30, BANDS), 0.5);
    assert.equal(roundMinutes(45, BANDS), 0.5);
    assert.equal(roundMinutes(46, BANDS), 1);
    assert.equal(roundMinutes(200, BANDS), 3);
    assert.equal(roundMinutes(215, BANDS), 3.5);
    assert.equal(roundMinutes(90, []), 1.5);
    assert.equal(roundMinutes(75, [{ from: 0, to: 14, hours: 0 }, { from: 15, to: 59, hours: 0.25 }]), 1.25);   // own bands
});

test('tiers are whatever the contract sets', () => {
    const wd = SAMPLE_POLICY.overtime.tiers.workday;
    assert.deepEqual(splitTiers(3, wd).map((t) => t.hours), [1, 2]);
    assert.deepEqual(splitTiers(11, SAMPLE_POLICY.overtime.tiers.holiday).map((t) => t.hours), [8, 1, 2]);
    assert.deepEqual(splitTiers(5, [{ from: 0, to: 2, mult: 1.25 }, { from: 2, to: null, mult: 1.75 }]).map((t) => t.hours), [2, 3]);
});

test('overtime pay from the matrix: driving / waiting split and break', () => {
    const policy = { overtime: { ...SAMPLE_POLICY.overtime, baseSalary: 4483000 } };
    const r = spklCompute({ rows: [{ start: '08:00', end: '21:30', waitMinutes: 200 }], policy });
    assert.equal(r.overtimeMinutes, 270);
    assert.equal(r.waitHours, 3);
    assert.equal(r.driveHours, 1);
    assert.equal(r.tiers.h15, 1);
    const hourly = 4483000 / 173;
    assert.equal(r.amount, Math.round(hourly * 1.5 + 3 * 0.3 * hourly));
    const b = spklCompute({ rows: [{ start: '06:00', end: '21:00', waitMinutes: 60 }], policy });
    assert.equal(b.breakMinutes, 60);
    assert.equal(b.waitHours, 0);
    assert.equal(b.driveHours, 5);
    assert.ok(b.warnings.length === 1);
    // a flat contract: Rp 25.000 per hour, ×1 every hour, waiting 50%
    const flat = { overtime: { enabled: true, hourlyRate: 25000, tiers: { workday: [{ from: 0, to: null, mult: 1 }] }, waitingPct: 50 } };
    const f = spklCompute({ rows: [{ start: '17:00', end: '20:00', waitMinutes: 60 }], policy: flat });
    assert.equal(f.amount, 2 * 25000 + 1 * 0.5 * 25000);
});

test('no business defaults; blockers list what is missing', () => {
    const empty = policyOf({});
    assert.equal(empty.overtime.enabled, false);
    assert.equal(empty.overtime.divisor, null);
    assert.equal(empty.sign.city, '');
    assert.deepEqual(policyBlockers({}), []);                       // nothing switched on → nothing required
    const b = policyBlockers({ overtime: { enabled: true }, trip: { enabled: true } });
    assert.ok(b.length >= 5);
    assert.deepEqual(policyBlockers({ overtime: { ...SAMPLE_POLICY.overtime, baseSalary: 4000000 }, trip: { enabled: true, dailyAllowance: 0, lodgingPerNight: 150000 } }), []);
});

test('older v1 policies convert', () => {
    const p = policyOf({ overtime: { method: 'pp35', baseSalary: 1730000, divisor: 173, rounding: 'sucofindo', waitingPct: 30, breakEvery: 5 }, trip: { dailyAllowance: 65000, lodging: { reimburse: 200000, disediakan: 0 } } });
    assert.equal(hourlyRateOf(p), 10000);
    assert.equal(p.overtime.tiers.workday.length, 2);
    assert.equal(p.overtime.rounding.length, 3);
    assert.equal(p.trip.lodgingPerNight, 200000);
    assert.equal(policyOf({ overtime: { method: 'none' } }).overtime.enabled, false);
});

test('perjalanan dinas allowance: one lodging rate per claimed night', () => {
    const policy = { trip: { enabled: true, dailyAllowance: 65000, lodgingPerNight: 200000 } };
    const r = tripCompute({ departDate: '2025-06-16', returnDate: '2025-06-18', legs: [{ lodging: true }, { lodging: 'reimburse' }, { lodging: 'disediakan' }], policy });
    assert.equal(r.days, 3);
    assert.equal(r.amount, 3 * 65000 + 400000);
    assert.equal(tripCompute({ departDate: '2025-06-18', returnDate: '2025-06-16', policy }), null);
});

import { codePrefixOf, afterApproval } from '../src/services/ops-core.js';
test('form codes and two-sided approval', () => {
    assert.equal(codePrefixOf('overtime'), 'L');
    assert.equal(codePrefixOf('trip'), 'T');
    assert.equal(codePrefixOf('expense'), 'O');
    assert.equal(afterApproval({ agencyApproved: true, clientApproved: false }), 'verified');
    assert.equal(afterApproval({ agencyApproved: false, clientApproved: true }), 'submitted');
    assert.equal(afterApproval({ agencyApproved: true, clientApproved: true }), 'approved');
});

test('v1 defaults nobody filled convert to empty', () => {
    const p = policyOf({ overtime: { method: 'pp35', baseSalary: 0, divisor: 173, waitingPct: 30, breakEvery: 5, rounding: 'sucofindo' },
        trip: { dailyAllowance: 0, lodging: { disediakan: 0, reimburse: 0 } },
        sign: { approverTitle: 'Fungsi Umum', knowerTitle: 'User', executorTitle: 'Pengemudi', city: 'Bandung' } });
    assert.equal(p.overtime.enabled, false);
    assert.equal(p.overtime.divisor, null);
    assert.equal(p.overtime.tiers.workday.length, 0);
    assert.equal(p.trip.enabled, false);
    assert.equal(p.sign.city, '');
});

// ─── Agency default policy (Pengaturan, 2026-11-09) ─────────────────────────
import { effectivePolicy, dailyRatesOf, dailyLineAmount, LEGACY_DAILY_RATES } from '../src/services/ops-core.js';

test('contract without own terms uses the agency default; own terms win', () => {
    const def = { overtime: { enabled: true, hourlyRate: 40000 }, trip: { enabled: true, dailyAllowance: 100000, lodgingPerNight: 200000 } };
    assert.equal(effectivePolicy({}, def).source, 'default');
    assert.equal(effectivePolicy({}, def).overtime.hourlyRate, 40000);
    assert.equal(effectivePolicy({ source: 'default', overtime: { enabled: true, hourlyRate: 1 } }, def).overtime.hourlyRate, 40000);
    const own = effectivePolicy({ overtime: { enabled: true, hourlyRate: 55000 } }, def);
    assert.equal(own.source, 'own'); assert.equal(own.overtime.hourlyRate, 55000);
});

test('daily rates: agency default, else legacy until configured', () => {
    assert.deepEqual(dailyRatesOf(null), { ...LEGACY_DAILY_RATES, configured: false });
    const r = dailyRatesOf({ overtime: { enabled: true, baseSalary: 4325000, divisor: 173 }, trip: { enabled: false } });
    assert.equal(r.overtime, 25000); assert.equal(r.lodging, 0); assert.equal(r.configured, true);
    assert.equal(dailyLineAmount({ price: 700000, overtimeHours: 2, nights: 1 }, { overtime: 50000, lodging: 150000 }), 950000);
});

test('lembur pay 0 says why (no rate / no multiplier for the day type)', async () => {
    const { spklCompute, SAMPLE_POLICY } = await import('../src/services/ops-core.js');
    const noRate = spklCompute({ rows: [{ start: '06:00', end: '19:00' }], dayType: 'workday', workStart: '07:00', workEnd: '18:00', policy: { overtime: { ...SAMPLE_POLICY.overtime } } });
    assert.equal(noRate.hours, 2); assert.equal(noRate.amount, 0); assert.deepEqual(noRate.missing, ['rate']);
    const ok = spklCompute({ rows: [{ start: '06:00', end: '19:00' }], dayType: 'workday', workStart: '07:00', workEnd: '18:00', policy: { overtime: { ...SAMPLE_POLICY.overtime, hourlyRate: 25000 } } });
    assert.equal(ok.amount, 25000 * (1.5 + 2)); assert.deepEqual(ok.missing, []);
});

test('lembur over several days: each date with its own jenis hari, summed', async () => {
    const { spklComputeDays, SAMPLE_POLICY, hhmm } = await import('../src/services/ops-core.js');
    const policy = { overtime: { ...SAMPLE_POLICY.overtime, hourlyRate: 20000 } };
    const r = spklComputeDays({
        rows: [
            { date: '2026-11-13', dayType: 'workday', start: '06:00', end: '19:00', waitMinutes: 0 },   // 2h outside 07–18
            { date: '2026-11-15', dayType: 'restday', start: '08:00', end: '12:00', waitMinutes: 60 },  // 4h, 1h waiting
        ],
        workStart: '07:00', workEnd: '18:00', policy,
    });
    assert.equal(r.days.length, 2);
    assert.equal(r.hours, 6);
    assert.equal(r.waitHours, 1);
    assert.deepEqual(r.byMult, [{ mult: 1.5, hours: 1 }, { mult: 2, hours: 4 }]);
    assert.equal(hhmm(1.5), '01:30');
    assert.ok(r.amount > 0);
});
