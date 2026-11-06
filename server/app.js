import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { verifyPassword, newToken } from "./auth.js";
import { normalize } from "../public/normalize.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "sid";

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join("; ");

export async function buildApp({ dataDir, passwordHash, production = false, trustProxy = false, logger = false }) {
  if (!passwordHash) throw new Error("Falta ADMIN_PASSWORD_HASH (genéralo con: npm run hash-password)");
  const db = openDb(dataDir);
  const app = Fastify({ logger, trustProxy, bodyLimit: 2 * 1024 * 1024 });
  app.addHook("onClose", async () => db.close());

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  app.addHook("onSend", async (req, reply) => {
    reply.header("Content-Security-Policy", CSP);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });

  // Defensa CSRF adicional: si la petición lleva cuerpo, tiene que ser JSON explícito.
  app.addHook("preValidation", async (req, reply) => {
    if (req.body !== undefined && !req.headers["content-type"]?.startsWith("application/json")) {
      return reply.code(415).send({ error: "unsupported_media_type" });
    }
  });

  const authed = async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (!token || !db.hasSession(token)) return reply.code(401).send({ error: "unauthorized" });
  };

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!verifyPassword(req.body?.password, passwordHash)) return reply.code(401).send({ error: "invalid_credentials" });
    const token = newToken();
    db.createSession(token, SESSION_TTL_MS);
    reply.setCookie(COOKIE, token, {
      httpOnly: true, secure: production, sameSite: "strict", path: "/", maxAge: SESSION_TTL_MS / 1000
    });
    return { ok: true };
  });

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.deleteSession(token);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/state", { preHandler: authed }, async () => db.getState());

  app.put("/api/state", { preHandler: authed }, async (req, reply) => {
    const { state, version } = req.body ?? {};
    const clean = normalize(state);
    if (!clean || !Number.isInteger(version) || version < 0) return reply.code(400).send({ error: "invalid_state" });
    const result = db.saveState(clean, version);
    if (!result.ok) return reply.code(409).send({ error: "conflict", state: result.state, version: result.version });
    return { version: result.version };
  });

  await app.register(fastifyStatic, { root: PUBLIC_DIR });
  return app;
}
