import { buildApp } from "./app.js";

const production = process.env.NODE_ENV === "production";
const app = await buildApp({
  dataDir: process.env.DATA_DIR || "./data",
  passwordHash: process.env.ADMIN_PASSWORD_HASH,
  production,
  trustProxy: production,
  logger: true
});

try {
  await app.listen({ port: Number(process.env.PORT) || 3000, host: process.env.HOST || "127.0.0.1" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.close().then(() => process.exit(0)));
