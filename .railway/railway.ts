import { defineRailway, github, preserve, project, service } from 'railway/iac';

// Eigenes Repository: Dieser benannte Teil verwaltet ausschließlich den Lexware-Dienst.
// Ohne partial würde Railway ausgelassene Dienste als Löschungen behandeln.
export const partial = 'naturbummler-lexware';

export default defineRailway(ctx => {
  if (ctx.projectName !== 'naturbummler-cargo-mcp' || ctx.environment !== 'production') {
    throw new Error('Diese Konfiguration ist nur für naturbummler-cargo-mcp / production vorgesehen.');
  }
  return project('naturbummler-cargo-mcp', {
    resources: [service('naturbummler-lexware-mcp', {
      source: github('NTD-Consulting-Ventures/naturbummler-lexware-mcp', {
        branch: 'codex/naturbummler-entra-railway',
      }),
      build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
      start: 'node dist/server.js',
      healthcheck: '/status',
      healthcheckTimeout: 60,
      replicas: { 'europe-west4-drams3a': 1 },
      deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3, sleepApplication: false },
      env: {
        NATURBUMMLER_PROFILE: 'true',
        SERVER_URL: 'https://naturbummler-lexware-mcp-production.up.railway.app',
        PORT: '8080',
        ENTRA_TENANT_ID: '${{cargo-mcp.ENTRA_TENANT_ID}}',
        ENTRA_API_AUDIENCE: '${{cargo-mcp.ENTRA_CLIENT_ID}}',
        ENTRA_SCOPE: '${{cargo-mcp.ENTRA_SCOPE}}',
        ENTRA_ACCESS_POLICY: 'tenant',
        LEXWARE_API_KEY: preserve(),
        LEXWARE_READ_ONLY: 'true',
        LEXWARE_ENABLE_DRAFTS: 'false',
        LEXWARE_ENABLE_FINALIZE: 'false',
        LEXWARE_ENABLE_URL_UPLOAD: 'false',
        LEXWARE_DEBUG_LOGGING: 'false',
      },
    })],
  });
});
