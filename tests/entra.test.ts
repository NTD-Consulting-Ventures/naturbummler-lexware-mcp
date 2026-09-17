import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { loadConfig } from '../src/config.js';
import { createAccessTokenVerifier, buildOAuthMetadata } from '../src/oauth.js';
import { LexwareClient } from '../src/lexware/client.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const audience = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
const env = {
  NATURBUMMLER_PROFILE: 'true', ENTRA_TENANT_ID: tenant,
  ENTRA_API_AUDIENCE: audience, ENTRA_ALLOWED_ROLES: 'Lexware.Read',
  SERVER_URL: 'https://lexware.example.com', LEXWARE_API_KEY: 'nur-testdaten',
};
const config = loadConfig(env);
if (config.auth.mode !== 'oauth') throw new Error('OAuth erwartet');
const oauth = config.auth;
const directOAuth = {
  ...oauth,
  proxyVerifyUrl: undefined,
  issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
  jwksUrl: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
  authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  registrationEndpoint: undefined,
  scopesSupported: [`api://${audience}/mcp.access`],
};
let sign: (claims?: jose.JWTPayload, options?: { aud?: string; iss?: string; noExpiry?: boolean }) => Promise<string>;
let jwks: ReturnType<typeof jose.createLocalJWKSet>;
beforeAll(async () => {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = 'test';
  jwks = jose.createLocalJWKSet({ keys: [jwk] });
  sign = (claims = {}, options = {}) => {
    let jwt = new jose.SignJWT({ sub: 'test-benutzer', oid: 'test-objekt', azp: 'test-client',
      tid: tenant, ver: '2.0', scp: 'mcp.access', roles: ['Lexware.Read'], ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(options.iss ?? directOAuth.issuer).setAudience(options.aud ?? audience).setIssuedAt();
    if (!options.noExpiry) jwt = jwt.setExpirationTime(claims.exp ?? '5m');
    return jwt.sign(privateKey);
  };
});

describe('Naturbummler-Konfiguration', () => {
  it('startet mit vollständigem Entra-Schutz auch vor der späteren Secret-Eingabe', () => {
    expect(loadConfig({ ...env, LEXWARE_API_KEY: '' }).lexwareApiKey).toBe('');
  });
  it('erzwingt Lesen und annonciert den Cargoboard-kompatiblen OAuth-Proxy mit DCR', () => {
    expect(config.capabilities).toEqual({ read: true, drafts: false, finalize: false, urlUpload: false });
    expect(oauth.scopesSupported).toEqual(['mcp.access']);
    expect(buildOAuthMetadata(oauth).registration_endpoint).toBe('https://lexware.example.com/register');
    expect(buildOAuthMetadata(oauth).scopes_supported).toEqual(['mcp.access']);
    expect(oauth.issuer).toBe('https://lexware.example.com/');
    expect(oauth.proxyVerifyUrl).toBe('http://127.0.0.1:8091/__internal/verify');
  });
  it.each([
    { ENTRA_TENANT_ID: 'common' }, { ENTRA_API_AUDIENCE: '' },
    { ENTRA_ALLOWED_ROLES: '' }, { ENTRA_ALLOWED_GROUP_IDS: 'keine-uuid' },
    { ENTRA_SCOPE: '' }, { ENTRA_ACCESS_POLICY: 'all' }, { SERVER_URL: 'http://example.com' },
    { OAUTH_VERIFY_AUDIENCE: 'false' }, { MCP_ALLOW_UNAUTHENTICATED: 'true' },
    { MCP_AUTH_TOKEN: 'irgendein-token' }, { LEXWARE_READ_ONLY: 'false' },
    { LEXWARE_ENABLE_DRAFTS: 'true' }, { LEXWARE_ENABLE_FINALIZE: 'true' },
    { LEXWARE_ENABLE_URL_UPLOAD: 'true' },
  ])('lehnt unsichere Einstellungen ab: %j', changes => {
    expect(() => loadConfig({ ...env, ...changes })).toThrow();
  });
});

describe('Entra-Access-Token', () => {
  it('akzeptiert den delegierten Scope und die freigegebene Rolle', async () => {
    const info = await createAccessTokenVerifier(directOAuth, { jwks })(await sign());
    expect(info.scopes).toEqual(['mcp.access']);
  });
  it('verlangt bei der ausdrücklich gewählten Mandantenfreigabe keine zusätzliche Rolle', async () => {
    const tenantConfig = loadConfig({ ...env, ENTRA_ACCESS_POLICY: 'tenant', ENTRA_ALLOWED_ROLES: '' });
    if (tenantConfig.auth.mode !== 'oauth') throw new Error('OAuth erwartet');
    const verify = createAccessTokenVerifier({ ...tenantConfig.auth, ...directOAuth, entra: tenantConfig.auth.entra }, { jwks });
    await expect(verify(await sign({ roles: [] }))).resolves.toHaveProperty('expiresAt');
    await expect(verify(await sign({ roles: [], scp: 'openid' }))).rejects.toThrow();
    await expect(verify(await sign({ roles: [], tid: 'fremder-mandant' }))).rejects.toThrow();
    await expect(verify(await sign({ roles: [] }, { aud: '00000003-0000-0000-c000-000000000000' }))).rejects.toThrow();
  });
  it('akzeptiert alternativ eine explizit freigegebene Gruppe', async () => {
    const policy = { ...directOAuth.entra!, allowedGroups: [group] };
    await expect(createAccessTokenVerifier({ ...directOAuth, entra: policy }, { jwks })(
      await sign({ roles: [], groups: [group] }),
    )).resolves.toHaveProperty('expiresAt');
  });
  it.each([
    { tid: 'anderer-mandant' }, { tid: undefined }, { ver: '1.0' },
    { oid: undefined }, { azp: undefined }, { scp: undefined, scope: 'mcp.access' },
    { scp: 'openid profile' }, { scp: `api://${audience}/mcp.access` },
    { roles: [] }, { roles: 'Lexware.Read' }, { roles: ['Andere.Rolle'] },
    { roles: [], groups: [group] },
    { roles: [], hasgroups: true, _claim_names: { groups: 'src1' } },
    { idtyp: 'app' }, { exp: 1 },
  ])('verweigert ungültige oder unberechtigte Claims: %j', async claims => {
    await expect(createAccessTokenVerifier(directOAuth, { jwks })(await sign(claims))).rejects.toThrow();
  });
  it.each(['00000003-0000-0000-c000-000000000000', 'https://lexware.example.com/mcp', `api://${audience}`])(
    'lehnt fremde Audience %s ab', async aud => {
      await expect(createAccessTokenVerifier(directOAuth, { jwks })(await sign({}, { aud }))).rejects.toThrow();
    },
  );
  it('verweigert falschen Issuer und fehlenden Ablauf', async () => {
    const verify = createAccessTokenVerifier(directOAuth, { jwks });
    await expect(verify(await sign({}, { iss: 'https://example.com' }))).rejects.toThrow();
    await expect(verify(await sign({}, { noExpiry: true }))).rejects.toThrow();
  });
  it('verweigert eine manipulierte Signatur', async () => {
    const token = await sign();
    const parts = token.split('.');
    parts[2] = 'AAAA' + parts[2].slice(4);
    await expect(createAccessTokenVerifier(directOAuth, { jwks })(parts.join('.'))).rejects.toThrow();
  });
});

describe('Cargoboard-kompatibler OAuth-Proxy', () => {
  const validResponse = {
    active: true,
    client_id: 'claude-dcr-client',
    scopes: ['mcp.access'],
    expires_at: Math.floor(Date.now() / 1000) + 300,
    subject: 'benutzer',
    entra: { tid: tenant, ver: '2.0', oid: 'objekt', azp: 'entra-client', roles: ['Lexware.Read'], groups: [] },
  };

  it('übernimmt nur ein vom lokalen Proxy und Entra bestätigtes Token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(Response.json(validResponse));
    const info = await createAccessTokenVerifier(oauth, { fetchFn })('proxy-token');
    expect(info).toMatchObject({ clientId: 'claude-dcr-client', scopes: ['mcp.access'] });
    expect(fetchFn).toHaveBeenCalledWith(oauth.proxyVerifyUrl, expect.objectContaining({ method: 'POST' }));
  });

  it.each([
    { active: false },
    { ...validResponse, scopes: [] },
    { ...validResponse, entra: { ...validResponse.entra, tid: 'fremder-mandant' } },
    { ...validResponse, entra: { ...validResponse.entra, idtyp: 'app' } },
  ])('verweigert eine ungültige Proxy-Antwort: %j', async response => {
    const fetchFn = vi.fn().mockResolvedValue(Response.json(response));
    await expect(createAccessTokenVerifier(oauth, { fetchFn })('proxy-token')).rejects.toThrow();
  });
});

describe('Schreibsperre vor dem Netzwerk', () => {
  it('sendet ohne Lexware-Schlüssel keinen Netzwerkaufruf', async () => {
    const fetchFn = vi.fn();
    const client = new LexwareClient({ apiKey: '', baseUrl: 'https://api.lexware.io', readOnly: true, fetchFn });
    await expect(client.get('/v1/profile')).rejects.toThrow('LEXWARE_API_KEY fehlt');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sperrt %s', async method => {
    const fetchFn = vi.fn();
    const client = new LexwareClient({ apiKey: 'test', baseUrl: 'https://api.lexware.io', readOnly: true, fetchFn });
    await expect(client.request(method, '/v1/contacts', { idempotent: false })).rejects.toThrow('Lesemodus');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('sperrt auch Multipart-Uploads', async () => {
    const fetchFn = vi.fn();
    const client = new LexwareClient({ apiKey: 'test', baseUrl: 'https://api.lexware.io', readOnly: true, fetchFn });
    await expect(client.postMultipart('/v1/files', { bytes: new Uint8Array(), filename: 'test', contentType: 'text/plain' })).rejects.toThrow('Lesemodus');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('liest Daten und folgt keinen Weiterleitungen mit dem API-Schlüssel', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"companyName":"Testfirma"}', { headers: { "content-type": "application/json" } }));
    const client = new LexwareClient({ apiKey: 'test', baseUrl: 'https://api.lexware.io', readOnly: true, fetchFn });
    await expect(client.get('/v1/profile')).resolves.toEqual({ companyName: 'Testfirma' });
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });
});
