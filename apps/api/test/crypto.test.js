// AES-256-GCM helpers. Run: node --test test/crypto.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import * as C from '../src/services/crypto.service.js';

const K1 = randomBytes(32).toString('base64');
const K2 = randomBytes(32).toString('base64');
const withKeys = (env) => { Object.assign(process.env, env); C._resetKeysForTests(); };

test('field round-trip, random IV, legacy passthrough', () => {
    withKeys({ DATA_ENCRYPTION_KEY: K1, DATA_ENCRYPTION_KEY_ID: 'k1', DATA_ENCRYPTION_OLD_KEYS: '' });
    const a = C.encryptField('1234-5678-9012'), b = C.encryptField('1234-5678-9012');
    assert.ok(a.startsWith('enc:v1:k1:'));
    assert.notEqual(a, b);                                   // random IV
    assert.equal(C.decryptField(a), '1234-5678-9012');
    assert.equal(C.decryptField('plain'), 'plain');          // legacy value
    assert.equal(C.encryptField(a), a);                      // idempotent
    assert.equal(C.encryptField(null), null);
});

test('tampered ciphertext is rejected (GCM auth tag)', () => {
    withKeys({ DATA_ENCRYPTION_KEY: K1, DATA_ENCRYPTION_KEY_ID: 'k1' });
    const e = C.encryptField('secret');
    const parts = e.split(':');
    parts[5] = Buffer.from('xxxxxx').toString('base64');
    assert.equal(C.decryptField(parts.join(':')), '[terenkripsi]');
});

test('key rotation: old values still readable with OLD_KEYS', () => {
    withKeys({ DATA_ENCRYPTION_KEY: K1, DATA_ENCRYPTION_KEY_ID: 'k1', DATA_ENCRYPTION_OLD_KEYS: '' });
    const old = C.encryptField('NPWP 01.234');
    withKeys({ DATA_ENCRYPTION_KEY: K2, DATA_ENCRYPTION_KEY_ID: 'k2', DATA_ENCRYPTION_OLD_KEYS: `k1:${K1}` });
    assert.equal(C.decryptField(old), 'NPWP 01.234');
    assert.ok(C.encryptField('x').startsWith('enc:v1:k2:'));
});

test('file stream encryption round-trip + plain passthrough', async () => {
    withKeys({ DATA_ENCRYPTION_KEY: K1, DATA_ENCRYPTION_KEY_ID: 'k1', DATA_ENCRYPTION_OLD_KEYS: '' });
    const plain = randomBytes(200_000);
    const chunks = [];
    await pipeline(Readable.from([plain.subarray(0, 70_000), plain.subarray(70_000)]), C.createEncryptStream(),
        new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } }));
    const enc = Buffer.concat(chunks);
    assert.ok(C.isEncryptedBuffer(enc));
    assert.ok(!enc.includes(plain.subarray(1000, 1064)));
    assert.deepEqual(C.decryptBuffer(enc), plain);
    assert.deepEqual(C.decryptBuffer(plain), plain);
    const t = Buffer.from(enc); t[t.length - 20] ^= 1;
    assert.throws(() => C.decryptBuffer(t));
    assert.deepEqual(C.decryptBuffer(C.encryptBuffer(plain)), plain);
});

test('production refuses to start without a key', () => {
    withKeys({ DATA_ENCRYPTION_KEY: '', NODE_ENV: 'production' });
    delete process.env.DATA_ENCRYPTION_KEY; C._resetKeysForTests();
    assert.throws(() => C.assertEncryptionConfigured(), /required in production/);
    process.env.NODE_ENV = 'test';
});

test('blind index is deterministic and case-insensitive', () => {
    withKeys({ DATA_ENCRYPTION_KEY: K1, DATA_ENCRYPTION_KEY_ID: 'k1' });
    assert.equal(C.blindIndex(' ABC '), C.blindIndex('abc'));
});
