import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter, requestLogger } from '../src/common/http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const PASSWORD = 'correct horse battery';

describe('JWT authentication (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let usersFile: string;
  const env = { ...process.env };

  const writeUsers = (users: { email: string; role: string }[]) =>
    fs.writeFileSync(
      usersFile,
      JSON.stringify(users.map((u) => ({ ...u, name: u.email, passwordHash: bcrypt.hashSync(PASSWORD, 4) }))),
    );

  beforeAll(async () => {
    usersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ahd-auth-')), 'users.json');
    writeUsers([
      { email: 'cs@example.com', role: 'cs' },
      { email: 'sales@example.com', role: 'sales' },
      { email: 'leaver@example.com', role: 'cs' },
    ]);
    process.env.JWT_SECRET = SECRET;
    process.env.AUTH_USERS_FILE = usersFile;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.use(requestLogger);
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app.close();
    process.env = env;
  });

  const login = (email: string, password = PASSWORD) =>
    fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  const getWith = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { headers });

  it('rejects data requests without a session', async () => {
    const res = await getWith('/accounts');
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ code: 'unauthenticated' });
  });

  it('treats a malformed session cookie as signed out (401, not 500)', async () => {
    for (const cookie of ['ah_session=%', 'ah_session=%E0%A4%A', 'other=1; ah_session=%zz']) {
      const res = await getWith('/accounts', { cookie });
      expect(res.status).toBe(401);
      expect(await json(res)).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('keeps /status public but without details', async () => {
    const res = await getWith('/status');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ status: 'ok', data: { loaded: true } });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await login('cs@example.com', 'nope');
    const unknown = await login('ghost@example.com');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const [a, b] = [await json(wrong), await json(unknown)];
    expect(a.code).toBe('invalid_credentials');
    expect(b.message).toBe(a.message);
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('refuses users outside Customer Success, even with the right password', async () => {
    const res = await login('sales@example.com');
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: 'access_denied' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('signs a CS user in with an httpOnly, SameSite=Strict cookie that grants access', async () => {
    const res = await login('CS@Example.com '); // case/whitespace-insensitive
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.user).toEqual({ email: 'cs@example.com', name: 'cs@example.com', role: 'cs' });

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^ah_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    const cookie = setCookie.split(';')[0];
    expect((await getWith('/accounts', { cookie })).status).toBe(200);
    expect(await json(await getWith('/auth/me', { cookie }))).toMatchObject({ user: { email: 'cs@example.com' } });
    // API clients can use the same token as a bearer token.
    expect((await getWith('/summary', { authorization: `Bearer ${body.accessToken}` })).status).toBe(200);
  });

  it('rejects tampered, foreign-secret and expired tokens', async () => {
    const { accessToken } = await json(await login('cs@example.com'));
    const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('a') ? 'bb' : 'aa');
    const foreign = new JwtService({ secret: 'some-other-secret-that-is-long-enough!!' }).sign(
      { sub: 'cs@example.com', name: 'x', role: 'cs' },
      { issuer: 'account-health-api', audience: 'account-health-dashboard' },
    );
    const expired = new JwtService({ secret: SECRET }).sign(
      { sub: 'cs@example.com', name: 'x', role: 'cs' },
      { issuer: 'account-health-api', audience: 'account-health-dashboard', expiresIn: -10 },
    );

    for (const t of [tampered, foreign]) {
      const res = await getWith('/accounts', { authorization: `Bearer ${t}` });
      expect(res.status).toBe(401);
      expect((await json(res)).code).toBe('invalid_session');
    }
    const res = await getWith('/accounts', { authorization: `Bearer ${expired}` });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('session_expired');
  });

  it('rejects an unsigned ("alg: none") token', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'cs@example.com', role: 'cs', iss: 'account-health-api', aud: 'account-health-dashboard' })}.`;
    expect((await getWith('/accounts', { authorization: `Bearer ${none}` })).status).toBe(401);
  });

  it('applies role changes and removals to existing sessions immediately', async () => {
    const { accessToken } = await json(await login('leaver@example.com'));
    const auth = { authorization: `Bearer ${accessToken}` };
    expect((await getWith('/accounts', auth)).status).toBe(200);

    // Ensure a new mtime even on coarse-grained filesystems.
    const bump = () => fs.utimesSync(usersFile, new Date(), new Date(Date.now() + 5_000));

    writeUsers([{ email: 'cs@example.com', role: 'cs' }, { email: 'leaver@example.com', role: 'sales' }]);
    bump();
    expect((await getWith('/accounts', auth)).status).toBe(403);

    writeUsers([{ email: 'cs@example.com', role: 'cs' }]);
    fs.utimesSync(usersFile, new Date(), new Date(Date.now() + 10_000));
    const res = await getWith('/accounts', auth);
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('account_removed');
  });

  it('locks sign-in after repeated failures', async () => {
    for (let i = 0; i < 5; i++) expect((await login('cs@example.com', `bad-${i}`)).status).toBe(401);
    const res = await login('cs@example.com'); // even the right password is refused while locked
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: 'too_many_attempts' });
  });

  it('clears the cookie on logout', async () => {
    const res = await fetch(`${base}/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/ah_session=;.*Expires=Thu, 01 Jan 1970/i);
  });

  it('validates the login body', async () => {
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('invalid_login_request');
  });
});
