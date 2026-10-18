import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';

/**
 * DATABASE_SSL_CA_FILE: the way to give the API the AWS RDS CA bundle without pasting a 170 kB PEM into .env. The
 * failure it prevents is "self-signed certificate in certificate chain" on every query, so a wrong path or a file that
 * is not a PEM must stop the process at boot, naming the variable.
 */
const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app:pw@payantra.c1a2b3.ap-south-1.rds.amazonaws.com:5432/payantra',
  DATABASE_SSL: 'true',
  SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  RAZORPAY_KEY_ID: 'rzp_test_Ab12Cd34Ef56',
  RAZORPAY_KEY_SECRET: 'k9Qw3rT7yU1iO5pA8sD2fG4h',
  RAZORPAY_WEBHOOK_SECRET: 'wh_7fGh3KjL9mNq2RsT5vXz',
};
const parse = (over: NodeJS.ProcessEnv) => parseEnv({ ...BASE, ...over });

const dir = mkdtempSync(join(tmpdir(), 'payantra-ca-'));
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
const goodFile = join(dir, 'ca.pem');
const notPem = join(dir, 'notes.txt');
writeFileSync(goodFile, PEM);
writeFileSync(notPem, 'this is not a certificate');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('DATABASE_SSL_CA_FILE', () => {
  it('leaves the CA undefined when neither option is set', () => {
    expect(parse({}).DATABASE_SSL_CA).toBeUndefined();
  });

  it('still accepts the PEM inline, with \\n for newlines', () => {
    expect(parse({ DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----' }).DATABASE_SSL_CA).toContain('\nMIIB\n');
  });

  it('reads the PEM from an absolute path', () => {
    expect(parse({ DATABASE_SSL_CA_FILE: goodFile }).DATABASE_SSL_CA).toBe(PEM);
  });

  it('resolves a relative path from the server folder, not from the working directory', () => {
    // The real RDS bundle ships in server/certs; the test would pass from any cwd.
    const ca = parse({ DATABASE_SSL_CA_FILE: './certs/global-bundle.pem' }).DATABASE_SSL_CA;
    expect(ca).toContain('-----BEGIN CERTIFICATE-----');
    expect((ca!.match(/BEGIN CERTIFICATE/g) ?? []).length).toBeGreaterThan(10); // the global bundle holds many roots
  });

  it('refuses to guess when both are set', () => {
    expect(() => parse({ DATABASE_SSL_CA: PEM, DATABASE_SSL_CA_FILE: goodFile })).toThrow(/DATABASE_SSL_CA_FILE: set either/);
  });

  it('stops at boot when the file does not exist, naming the path and the reason', () => {
    expect(() => parse({ DATABASE_SSL_CA_FILE: join(dir, 'missing.pem') })).toThrow(/DATABASE_SSL_CA_FILE: cannot read ".*missing\.pem" \(ENOENT\)/);
  });

  it('stops at boot when the file is not a PEM certificate', () => {
    expect(() => parse({ DATABASE_SSL_CA_FILE: notPem })).toThrow(/does not contain a PEM certificate/);
  });

  it('treats a blank value as unset, like every other optional variable', () => {
    expect(parse({ DATABASE_SSL_CA_FILE: '   ' }).DATABASE_SSL_CA).toBeUndefined();
  });
});
