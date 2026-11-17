// RBAC v2 — permission rules (pure, no DB). Run: node --test test/access.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALL_PERMS, SYSTEM_TEMPLATES, CLIENT_ALLOWED, effectivePermissions, defaultTemplateKey,
    canAssign, diffFromTemplate, legalComplete,
} from '../src/services/access-core.js';

const tpl = (k) => SYSTEM_TEMPLATES[k].permissions;

test('existing users map to a template without any data change', () => {
    assert.equal(defaultTemplateKey({ role: 'admin', accountType: 'agency' }), 'sys:agency_admin');
    assert.equal(defaultTemplateKey({ role: 'agent', accountType: 'agency' }), 'sys:agency_staff');
    assert.equal(defaultTemplateKey({ role: 'user', accountType: 'agency' }), 'sys:agency_staff');
    assert.equal(defaultTemplateKey({ role: 'demo', accountType: 'agency' }), 'sys:agency_viewer');
    assert.equal(defaultTemplateKey({ role: 'admin', accountType: 'client' }), 'sys:client_admin');
    assert.equal(defaultTemplateKey({ role: 'client_admin' }), 'sys:client_admin');   // legacy
    assert.equal(defaultTemplateKey({ role: 'client' }), 'sys:client_user');          // legacy
});

test('superadmin has everything', () => {
    assert.equal(effectivePermissions({ role: 'superadmin' }, []).size, ALL_PERMS.length);
});

test('template + grants − revokes', () => {
    const u = { role: 'user', accountType: 'agency', permGrants: ['finance.view'], permRevokes: ['orders.edit'] };
    const p = effectivePermissions(u, tpl('sys:agency_staff'));
    assert.ok(p.has('finance.view'));
    assert.ok(!p.has('orders.edit'));
    assert.ok(p.has('orders.view'));
});

test('client accounts are capped: never fleet / finance / order edit, even if granted', () => {
    const u = { role: 'admin', accountType: 'client', permGrants: ['fleet.view', 'finance.post', 'orders.edit', 'orders.delete'] };
    const p = effectivePermissions(u, ALL_PERMS);
    for (const x of p) assert.ok(CLIENT_ALLOWED.has(x), x);
    assert.ok(!p.has('fleet.view') && !p.has('orders.edit') && !p.has('finance.post'));
});

test('legacy access-request grants still work (grant_<feature> → feature.view)', () => {
    const u = { role: 'user', accountType: 'agency', permissions: { grant_analytics: true, grant_access_requests: true } };
    const p = effectivePermissions(u, tpl('sys:agency_viewer'));
    assert.ok(p.has('analytics.view'));
    assert.ok(p.has('orders.claim'));
});

test('agency in legal setup mode cannot create or claim orders', () => {
    const u = { role: 'admin', accountType: 'agency' };
    const setup = effectivePermissions(u, tpl('sys:agency_admin'), 'setup');
    assert.ok(!setup.has('orders.create') && !setup.has('orders.claim'));
    assert.ok(setup.has('fleet.create') && setup.has('settings.edit'));   // can still set up
    const active = effectivePermissions(u, tpl('sys:agency_admin'), 'active');
    assert.ok(active.has('orders.create') && active.has('orders.claim'));
});

test('unknown permission strings are ignored', () => {
    const p = effectivePermissions({ role: 'user', accountType: 'agency', permGrants: ['root.everything'] }, ['orders.view', 'x.y']);
    assert.deepEqual([...p], ['orders.view']);
});

test('no escalation: cannot grant what you do not hold', () => {
    const actorPerms = effectivePermissions({ role: 'user', accountType: 'agency' }, tpl('sys:agency_staff'));
    const r = canAssign({ actorRole: 'user', actorAccountType: 'agency', actorPerms, targetAccountType: 'agency', targetPerms: new Set(['finance.post']) });
    assert.equal(r.ok, false);
    const ok = canAssign({ actorRole: 'user', actorAccountType: 'agency', actorPerms, targetAccountType: 'agency', targetPerms: new Set(['orders.view']) });
    assert.equal(ok.ok, true);
});

test('client admin cannot assign agency users or non-client permissions', () => {
    const actorPerms = effectivePermissions({ role: 'admin', accountType: 'client' }, tpl('sys:client_admin'));
    assert.equal(canAssign({ actorRole: 'admin', actorAccountType: 'client', actorPerms, targetAccountType: 'agency', targetPerms: new Set(['orders.view']) }).ok, false);
    assert.equal(canAssign({ actorRole: 'admin', actorAccountType: 'client', actorPerms, targetAccountType: 'client', targetPerms: new Set(['users.view', 'orders.create']) }).ok, true);
});

test('diffFromTemplate stores only the deltas', () => {
    const d = diffFromTemplate(['a.view', 'orders.view', 'orders.edit'].filter((x) => ALL_PERMS.includes(x)), new Set(['orders.view', 'fleet.view']));
    assert.deepEqual(d, { grants: ['fleet.view'], revokes: ['orders.edit'] });
});

test('legal completeness needs all 4 files + NIB + NPWP + phone', () => {
    const docs = { nib: { url: 'a' }, akta: { url: 'b' }, npwp: { url: 'c' }, ktp: { url: 'd' } };
    assert.equal(legalComplete({ legalDocs: docs, nib: '123', npwp: '01.2', phone1: '0812' }), true);
    assert.equal(legalComplete({ legalDocs: { ...docs, ktp: null }, nib: '123', npwp: '01.2', phone1: '0812' }), false);
    assert.equal(legalComplete({ legalDocs: docs, nib: '', npwp: '01.2', phone1: '0812' }), false);
});
