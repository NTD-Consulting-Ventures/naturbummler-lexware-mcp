import { ConfigError } from './config.js';

export interface EntraPolicy {
  accessPolicy: "assigned" | "tenant";
  tenantId: string;
  audience: string;
  requiredScopes: string[];
  allowedGroups: string[];
  allowedRoles: string[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (value?: string) => (value ?? '').split(/[,\s]+/).filter(Boolean);

/** Die bestehende MCP-API ist die Audience; die Railway-Adresse ist nur die Ressource. */
export function entraEnvironment(env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; policy?: EntraPolicy } {
  if (!env.ENTRA_TENANT_ID && env.NATURBUMMLER_PROFILE !== 'true') return { env };
  const tenantId = env.ENTRA_TENANT_ID?.trim() ?? '';
  const audience = env.ENTRA_API_AUDIENCE?.trim() ?? '';
  if (!uuid.test(tenantId) || !uuid.test(audience)) {
    throw new ConfigError('ENTRA_TENANT_ID und ENTRA_API_AUDIENCE müssen gültige UUIDs sein.');
  }
  const requiredScopes = list(env.ENTRA_SCOPE ?? 'mcp.access');
  if (!requiredScopes.length || requiredScopes.some(s => !/^[A-Za-z0-9._-]+$/.test(s))) {
    throw new ConfigError('ENTRA_SCOPE muss kurze delegierte Scope-Namen enthalten.');
  }
  const accessPolicy = env.ENTRA_ACCESS_POLICY ?? "assigned";
  if (accessPolicy !== "assigned" && accessPolicy !== "tenant") {
    throw new ConfigError("ENTRA_ACCESS_POLICY muss assigned oder tenant sein.");
  }
  const allowedGroups = list(env.ENTRA_ALLOWED_GROUP_IDS);
  const allowedRoles = list(env.ENTRA_ALLOWED_ROLES);
  if (allowedGroups.some(g => !uuid.test(g)) || (accessPolicy === "assigned" && !allowedGroups.length && !allowedRoles.length)) {
    throw new ConfigError('Mindestens eine freigegebene Entra-Gruppe oder App-Rolle ist erforderlich.');
  }
  const identifier = env.ENTRA_IDENTIFIER_URI?.trim() || `api://${audience}`;
  if (!identifier.startsWith('api://') && !identifier.startsWith('https://')) {
    throw new ConfigError('ENTRA_IDENTIFIER_URI muss eine API-Identifier-URI sein.');
  }
  const origin = env.SERVER_URL?.trim() || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '');
  let url: URL;
  try { url = new URL(origin); } catch { throw new ConfigError('SERVER_URL fehlt oder ist ungültig.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new ConfigError('SERVER_URL muss eine reine HTTPS-Origin sein.');
  }
  if (env.OAUTH_VERIFY_AUDIENCE === 'false' || env.MCP_ALLOW_UNAUTHENTICATED === 'true' || env.MCP_AUTH_TOKEN) {
    throw new ConfigError('Das Naturbummler-Profil erlaubt ausschließlich geprüfte Entra-Token.');
  }
  if (env.LEXWARE_READ_ONLY === 'false' || ['LEXWARE_ENABLE_DRAFTS', 'LEXWARE_ENABLE_FINALIZE', 'LEXWARE_ENABLE_URL_UPLOAD'].some(k => env[k] === 'true')) {
    throw new ConfigError('Der Naturbummler-Pilot erlaubt ausschließlich Lesezugriffe.');
  }
  const base = `https://login.microsoftonline.com/${tenantId}`;
  return {
    policy: { accessPolicy, tenantId, audience, requiredScopes, allowedGroups, allowedRoles },
    env: {
      ...env,
      SERVER_URL: url.origin,
      OAUTH_RESOURCE: `${url.origin}/mcp`,
      OAUTH_ISSUER: `${base}/v2.0`,
      OAUTH_JWKS_URL: `${base}/discovery/v2.0/keys`,
      OAUTH_AUTHORIZATION_ENDPOINT: `${base}/oauth2/v2.0/authorize`,
      OAUTH_TOKEN_ENDPOINT: `${base}/oauth2/v2.0/token`,
      OAUTH_REGISTRATION_ENDPOINT: 'none',
      OAUTH_VERIFY_AUDIENCE: 'true',
      OAUTH_AUDIENCE: audience,
      OAUTH_SCOPES_SUPPORTED: requiredScopes.map(s => `${identifier.replace(/\/$/, '')}/${s}`).join(' '),
      OAUTH_ALLOWED_EMAIL_DOMAINS: '',
      LEXWARE_API_BASE_URL: 'https://api.lexware.io',
      LEXWARE_READ_ONLY: 'true',
      LEXWARE_DEBUG_LOGGING: 'false',
    },
  };
}
