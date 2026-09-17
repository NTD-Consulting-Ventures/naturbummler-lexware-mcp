import { spawn, type ChildProcess } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";

const publicPort = Number(process.env.PORT || "8080");
const authPort = Number(process.env.AUTH_INTERNAL_PORT || "8091");
const appPort = Number(process.env.APP_INTERNAL_PORT || "8092");

for (const [name, port] of [["PORT", publicPort], ["AUTH_INTERNAL_PORT", authPort], ["APP_INTERNAL_PORT", appPort]] as const) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} ist kein gültiger Port`);
}
if (new Set([publicPort, authPort, appPort]).size !== 3) throw new Error("Gateway-, Auth- und App-Port müssen verschieden sein");

const python = process.env.AUTH_PYTHON || "/opt/auth-venv/bin/python";
const children: ChildProcess[] = [];
let shuttingDown = false;

function start(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.push(child);
  child.once("error", error => {
    console.error(`[gateway] Kindprozess konnte nicht starten: ${error.message}`);
    if (!shuttingDown) process.exit(1);
  });
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[gateway] Kindprozess beendet (code=${code ?? "-"}, signal=${signal ?? "-"})`);
      process.exit(code || 1);
    }
  });
  return child;
}

start(python, ["auth_gateway.py"], { ...process.env, AUTH_INTERNAL_PORT: String(authPort) });
start(process.execPath, ["dist/server.js"], {
  ...process.env,
  PORT: String(appPort),
  __PORT: String(appPort),
  OAUTH_PROXY_VERIFY_URL: `http://127.0.0.1:${authPort}/__internal/verify`,
});

const authPaths = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/authorize",
  "/token",
  "/register",
  "/revoke",
  "/auth/callback",
  "/consent",
];

export function routeTarget(pathname: string): "auth" | "app" {
  return authPaths.some(path => pathname === path || pathname.startsWith(`${path}/`)) ? "auth" : "app";
}

function proxy(req: IncomingMessage, res: ServerResponse, port: number): void {
  const headers = { ...req.headers, host: `127.0.0.1:${port}`, "x-forwarded-proto": "https" };
  const upstream = http.request(
    { host: "127.0.0.1", port, method: req.method, path: req.url, headers },
    upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(503, { "content-type": "application/json" });
    res.end('{"status":"starting"}');
  });
  req.pipe(upstream);
}

async function serviceReady(port: number, path: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

const gateway = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", "http://gateway.invalid").pathname;
  if (pathname === "/status") {
    const [authReady, appReady] = await Promise.all([
      serviceReady(authPort, "/__internal/status"),
      serviceReady(appPort, "/status"),
    ]);
    res.writeHead(authReady && appReady ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: authReady && appReady ? "ok" : "starting" }));
    return;
  }
  proxy(req, res, routeTarget(pathname) === "auth" ? authPort : appPort);
});

gateway.listen(publicPort, "0.0.0.0", () => {
  console.error(`[gateway] Naturbummler Lexware MCP auf Port ${publicPort}`);
});

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  gateway.close();
  for (const child of children) child.kill(signal);
  const timer = setTimeout(() => process.exit(0), 5000);
  timer.unref();
  Promise.all(children.map(child => new Promise<void>(resolve => child.once("exit", () => resolve()))))
    .finally(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
