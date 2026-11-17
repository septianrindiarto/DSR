// Login session rules (owner 2026-11-13): one live login, 15-min idle, kick after 5 min idle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceTypeOf, deviceLabel, sessionPolicy, isAlive, loginDecision, IDLE_MINUTES, DRIVER_MOBILE_IDLE_MINUTES } from '../src/services/session-core.js';

const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const UA_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('device type & label', () => {
    assert.equal(deviceTypeOf(UA_WIN), 'desktop');
    assert.equal(deviceTypeOf(UA_ANDROID), 'mobile');
    assert.equal(deviceTypeOf(UA_IPHONE), 'mobile');
    assert.equal(deviceTypeOf(UA_TAB), 'tablet');
    assert.equal(deviceTypeOf(UA_WIN, '?1'), 'mobile');
    assert.equal(deviceLabel(UA_WIN), 'Chrome · Windows');
    assert.equal(deviceLabel(UA_IPHONE), 'Safari · iPhone');
});

test('policy: superadmin exempt, driver on phone longer, others 15 min', () => {
    assert.deepEqual(sessionPolicy({ user: { role: 'superadmin' } }), { exempt: true, idleMinutes: null });
    assert.equal(sessionPolicy({ user: { role: 'admin' }, access: { templateKey: 'sys:agency_admin' }, deviceType: 'mobile' }).idleMinutes, IDLE_MINUTES);
    const drv = { user: { role: 'user' }, access: { templateKey: 'sys:agency_driver', perms: new Set(['driverapp.use']) } };
    assert.equal(sessionPolicy({ ...drv, deviceType: 'mobile' }).idleMinutes, DRIVER_MOBILE_IDLE_MINUTES);
    assert.equal(sessionPolicy({ ...drv, deviceType: 'tablet' }).idleMinutes, DRIVER_MOBILE_IDLE_MINUTES);
    assert.equal(sessionPolicy({ ...drv, deviceType: 'desktop' }).idleMinutes, IDLE_MINUTES);
    // a custom role with only driverapp.use counts as a driver too
    assert.equal(sessionPolicy({ user: {}, access: { templateKey: 'org:9:x', perms: new Set(['driverapp.use']) }, deviceType: 'mobile' }).idleMinutes, DRIVER_MOBILE_IDLE_MINUTES);
});

test('idle timeout', () => {
    const now = Date.parse('2026-11-13T10:00:00Z');
    assert.equal(isAlive({ lastSeen: new Date(now - 14 * 60000), idleMinutes: 15, now }), true);
    assert.equal(isAlive({ lastSeen: new Date(now - 15 * 60000), idleMinutes: 15, now }), false);
    assert.equal(isAlive({ lastSeen: new Date(now - 999 * 60000), idleMinutes: null, now }), true);   // exempt
});

test('login decision: in use → wait; idle ≥ 5 min → may kick; expired → free', () => {
    const now = Date.parse('2026-11-13T10:00:00Z');
    const other = (minAgo) => [{ id: 's1', lastSeen: new Date(now - minAgo * 60000), idleMinutes: 15, userAgent: UA_WIN }];
    assert.deepEqual(loginDecision({ now }), { allow: true, kick: [] });
    const busy = loginDecision({ others: other(2), now });
    assert.equal(busy.allow, false); assert.equal(busy.code, 'USER_ONLINE'); assert.equal(busy.holder.device, 'Chrome · Windows');
    assert.equal(busy.kickableAt, new Date(now + 3 * 60000).toISOString());          // 5 min after last activity
    assert.equal(loginDecision({ others: other(2), force: true, now }).allow, false);   // force does not help before 5 min
    const idle = loginDecision({ others: other(6), now });
    assert.equal(idle.allow, false); assert.equal(idle.code, 'USER_ONLINE_KICKABLE');
    assert.deepEqual(loginDecision({ others: other(6), force: true, now }), { allow: true, kick: ['s1'], kicked: true });
    assert.deepEqual(loginDecision({ others: other(20), now }), { allow: true, kick: ['s1'] });   // expired: login is free
});
