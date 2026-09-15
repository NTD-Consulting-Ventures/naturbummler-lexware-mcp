import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const keys = vi.hoisted(() => ({ resolver: undefined as unknown }));
vi.mock('jose', async importOriginal => ({
  ...await importOriginal<typeof import('jose')>(),
  createRemoteJWKSet: () => keys.resolver,
}));

const tenant = '11111111-1111-4111-8111-111111111111';
const audience = '22222222-2222-4222-8222-222222222222';
let http: Server;
let base: string;
let approved: string;
let denied: string;
let upstreamCalls = 0;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = 'fixture';
  keys.resolver = jose.createLocalJWKSet({ keys: [jwk] });
  const token = (roles: string[]) => new jose.SignJWT({ tid: tenant, ver: '2.0', oid: 'benutzer',
    sub: 'benutzer', azp: 'client', scp: 'mcp.access', roles })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(audience)
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  approved = await token(['Lexware.Read']);
  denied = await token([]);
  for (const [name, value] of Object.entries({
    NODE_ENV: 'production', VERCEL: '1', NATURBUMMLER_PROFILE: 'true',
    ENTRA_TENANT_ID: tenant, ENTRA_API_AUDIENCE: audience, ENTRA_ALLOWED_ROLES: 'Lexware.Read',
    SERVER_URL: 'https://lexware.example.com', LEXWARE_API_KEY: 'nur-testdaten',
  })) vi.stubEnv(name, value);
  // Nur Lexware wird simuliert. HTTP, MCP, Signatur- und Berechtigungsprüfung laufen echt.
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.lexware.io/')) {
      upstreamCalls++;
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer nur-testdaten');
      expect(url).toBe('https://api.lexware.io/v1/profile');
      return Response.json({ companyName: 'Naturbummler Testdaten' });
    }
    return realFetch(input, init);
  });
  const app = (await import('../src/server.js')).default as Express;
  http = createServer(app);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (http) await new Promise<void>(resolve => http.close(() => resolve()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('liefert Health, Logo und Entra-Discovery; sperrt unautorisierte Anfragen', async () => {
  expect((await realFetch(`${base}/status`)).status).toBe(200);
  expect((await realFetch(`${base}/assets/naturbummler-logo.webp`)).headers.get('content-type')).toContain('image/webp');
  const discovery = await (await realFetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  expect(discovery.authorization_servers).toContain(`https://login.microsoftonline.com/${tenant}/v2.0`);
  expect(discovery.scopes_supported).toEqual([`api://${audience}/mcp.access`]);
  const unauthorized = await realFetch(`${base}/mcp`, { method: 'POST' });
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get('www-authenticate')).toContain('resource_metadata=');
  expect((await realFetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${denied}` } })).status).toBe(403);
  expect(upstreamCalls).toBe(0);
});

it('initialisiert MCP, listet ausschließlich Lese-Tools und liest das Profil', async () => {
  const client = new Client({ name: 'naturbummler-abnahme', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${approved}` } },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.some(tool => /^(create|update|delete|upload)-/.test(tool.name))).toBe(false);
    const profile = await client.callTool({ name: 'get-profile', arguments: {} });
    expect(profile.isError).not.toBe(true);
    expect(profile.structuredContent).toEqual({ companyName: 'Naturbummler Testdaten' });
    expect(upstreamCalls).toBe(1);
    const write = await client.callTool({ name: 'create-contact', arguments: {} });
    expect(write.isError).toBe(true);
    expect(upstreamCalls).toBe(1);
  } finally { await client.close(); }
  expect((await realFetch(`${base}/upload/test`, { method: 'POST' })).status).toBe(404);
});
