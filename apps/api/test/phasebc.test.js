// Phase B/C pure rules. Run: node --test test/phasebc.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestOvertime, reminderDue } from '../src/services/phasebc-core.js';

test('overtime: hours beyond 12 h per day, with-driver packages only', () => {
    const s = '2026-10-01T06:00:00+07:00';
    assert.equal(suggestOvertime({ startedAt: s, endedAt: '2026-10-01T20:30:00+07:00', totalDays: 1, pkg: 'All In' }), 3);  // 14.5 h → 3
    assert.equal(suggestOvertime({ startedAt: s, endedAt: '2026-10-01T17:00:00+07:00', totalDays: 1, pkg: 'Mobil dan Driver' }), 0);
    assert.equal(suggestOvertime({ startedAt: s, endedAt: '2026-10-02T20:00:00+07:00', totalDays: 2, pkg: 'All In' }), 14);   // 38 h − 24
    assert.equal(suggestOvertime({ startedAt: s, endedAt: '2026-10-02T20:00:00+07:00', totalDays: 1, pkg: 'Lepas Kunci' }), 0);
});

test('claim reminder every 30 min after 30 min', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    assert.equal(reminderDue({ createdAt: '2026-10-01T09:45:00Z', now }), false);
    assert.equal(reminderDue({ createdAt: '2026-10-01T09:20:00Z', now }), true);
    assert.equal(reminderDue({ createdAt: '2026-10-01T08:00:00Z', lastReminderAt: '2026-10-01T09:40:00Z', now }), false);
    assert.equal(reminderDue({ createdAt: '2026-10-01T08:00:00Z', lastReminderAt: '2026-10-01T09:29:00Z', now }), true);
});
