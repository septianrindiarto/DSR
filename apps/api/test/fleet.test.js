// Vehicle types per agency (pure). Run: node --test test/fleet.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { carTypesOf, matchType, planTypeChange, DEFAULT_CAR_TYPES } from '../src/services/fleet-core.js';

test('default list until the agency saves one; cleaned and de-duplicated', () => {
    assert.deepEqual(carTypesOf(null), DEFAULT_CAR_TYPES);
    assert.deepEqual(carTypesOf({ types: [' Hiace  Commuter ', 'hiace commuter', '', 'Bus'] }), ['Hiace Commuter', 'Bus']);
    assert.equal(matchType(['City Car'], 'city car'), 'City Car');
    assert.equal(matchType(['City Car'], 'Truk'), null);
});

test('removing a used type is blocked unless it is renamed', () => {
    const usage = { MPV: 3, Sport: 1 };
    assert.equal(planTypeChange({ next: ['MPV', 'Minibus'], usage }).errors.length, 1);
    const ok = planTypeChange({ next: ['MPV', 'Minibus'], renames: [{ from: 'Sport', to: 'minibus' }], usage });
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.renames, [{ from: 'Sport', to: 'Minibus' }]);
    assert.equal(planTypeChange({ next: [], usage: {} }).errors[0], 'Minimal satu tipe kendaraan.');
});
