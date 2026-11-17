// Maintenance schedule / replacement units / emergencies (owner 2026-11-13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, maintenanceRange, replacementOn, unitsNeedingReplacement, replacementBlockers } from '../src/services/fleet-events-core.js';

test('overlaps / maintenanceRange', () => {
    assert.equal(overlaps('2026-11-10', '2026-11-12', '2026-11-12', '2026-11-20'), true);
    assert.equal(overlaps('2026-11-10', '2026-11-11', '2026-11-12', null), false);
    assert.equal(overlaps('2026-11-10', null, '2027-01-01', '2027-01-02'), true);
    assert.deepEqual(maintenanceRange({ scheduledDate: '2026-11-14T00:00:00Z', endDate: null }), { from: '2026-11-14', to: '2026-11-14' });
    assert.deepEqual(maintenanceRange({ scheduledDate: '2026-11-14', endDate: '2026-11-16' }), { from: '2026-11-14', to: '2026-11-16' });
});

test('replacementOn picks the active replacement of the unit on that day', () => {
    const reps = [{ contractUnitId: 5, replacementCarId: 9, startDate: '2026-11-14', endDate: '2026-11-16', status: 'active' },
        { contractUnitId: 5, replacementCarId: 8, startDate: '2026-11-01', endDate: '2026-11-03', status: 'ended' }];
    assert.equal(replacementOn(reps, 5, '2026-11-15')?.replacementCarId, 9);
    assert.equal(replacementOn(reps, 5, '2026-11-02'), null);
    assert.equal(replacementOn(reps, 6, '2026-11-15'), null);
});

test('unitsNeedingReplacement: maintenance soon / open off-road emergency, unless covered', () => {
    const units = [{ id: 5, contractId: 1, carId: 3, contractStart: '2026-11-01', contractEnd: '2027-10-31' }];
    const maintenances = [{ id: 7, carId: 3, status: 'scheduled', scheduledDate: '2026-11-15', endDate: '2026-11-16' }];
    const base = { units, maintenances, todayIso: '2026-11-13' };
    assert.equal(unitsNeedingReplacement(base).length, 1);
    assert.equal(unitsNeedingReplacement({ ...base, todayIso: '2026-11-01' }).length, 0);          // beyond 7-day horizon
    assert.equal(unitsNeedingReplacement({ ...base, replacements: [{ contractUnitId: 5, startDate: '2026-11-15', endDate: '2026-11-16', status: 'active' }] }).length, 0);
    const incidents = [{ id: 2, carId: 3, status: 'open', offRoad: true, reportedAt: '2026-11-13T02:00:00Z' }];
    assert.equal(unitsNeedingReplacement({ units, incidents, todayIso: '2026-11-13' })[0].reason, 'emergency');
    assert.equal(unitsNeedingReplacement({ units, incidents: [{ ...incidents[0], offRoad: false }], todayIso: '2026-11-13' }).length, 0);
});

test('replacementBlockers', () => {
    const unit = { id: 5, carId: 3 };
    assert.deepEqual(replacementBlockers({ unit, replacementCarId: 9, startDate: '2026-11-14', endDate: '2026-11-16' }), []);
    assert.equal(replacementBlockers({ unit, replacementCarId: 3, startDate: '2026-11-14' }).length, 1);
    assert.equal(replacementBlockers({ unit, replacementCarId: 9, startDate: '2026-11-14', endDate: '2026-11-10' }).length, 1);
    assert.equal(replacementBlockers({ unit, replacementCarId: 9, startDate: '2026-11-14', endDate: '2026-11-16', busy: [{ label: 'C012', from: '2026-11-15', to: '2026-11-15' }] }).length, 1);
});
