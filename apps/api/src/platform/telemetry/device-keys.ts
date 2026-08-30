import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Per-device credential helpers. One key serves both transports:
 *  - HTTP ingest verifies against a SHA-256 digest (cheap per request; the
 *    key itself is 128-bit random, so no slow hash is needed).
 *  - MQTT verifies against a mosquitto `$7$` (PBKDF2-SHA512) entry exported
 *    into the broker's password file.
 */

export function generateDeviceKey(): string {
  return `dk_${randomBytes(16).toString('hex')}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** mosquitto_passwd-compatible hash: $7$<iterations>$<salt b64>$<dk b64>. */
export function mosquittoHash(password: string, iterations = 101): string {
  const salt = randomBytes(12);
  const dk = pbkdf2Sync(password, salt, iterations, 64, 'sha512');
  return `$7$${iterations}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
