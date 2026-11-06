import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";

const PASSWORD = "clave-de-prueba-123";
const passwordHash = hashPassword(PASSWORD);

const sample = () => ({
  current: "b1",
  boards: [{ id: "b1", name: "Prueba", color: "#0079bf", labels: [], columns: [{ id: "c1", name: "Por hacer", cards: [] }] }]
});

async function setup() {
  const app = await buildApp({ dataDir: ":memory:", passwordHash });
  const login = async (password = PASSWORD) => app.inject({ method: "POST", url: "/api/login", payload: { password } });
  const session = async () => {
    const res = await login();
    return { cookie: `sid=${res.cookies[0].value}` };
  };
  return { app, login, session };
}

test("health es público", async () => {
  const { app } = await setup();
  const res = await app.inject({ url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  await app.close();
});

test("login con contraseña incorrecta devuelve 401 y no crea cookie", async () => {
  const { app, login } = await setup();
  const res = await login("otra-clave-equivocada");
  assert.equal(res.statusCode, 401);
  assert.equal(res.cookies.length, 0);
  await app.close();
});

test("login correcto crea cookie HttpOnly SameSite=Strict", async () => {
  const { app, login } = await setup();
  const res = await login();
  assert.equal(res.statusCode, 200);
  const [c] = res.cookies;
  assert.equal(c.name, "sid");
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, "Strict");
  await app.close();
});

test("el estado exige sesión", async () => {
  const { app } = await setup();
  assert.equal((await app.inject({ url: "/api/state" })).statusCode, 401);
  const put = await app.inject({ method: "PUT", url: "/api/state", payload: { state: sample(), version: 0 } });
  assert.equal(put.statusCode, 401);
  await app.close();
});

test("GET inicial vacío, PUT guarda y GET lo devuelve", async () => {
  const { app, session } = await setup();
  const headers = await session();
  const first = await app.inject({ url: "/api/state", headers });
  assert.deepEqual(first.json(), { state: null, version: 0 });

  const put = await app.inject({ method: "PUT", url: "/api/state", headers, payload: { state: sample(), version: 0 } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().version, 1);

  const got = (await app.inject({ url: "/api/state", headers })).json();
  assert.equal(got.version, 1);
  assert.equal(got.state.boards[0].name, "Prueba");
  await app.close();
});

test("PUT con versión antigua devuelve 409 con el estado del servidor", async () => {
  const { app, session } = await setup();
  const headers = await session();
  await app.inject({ method: "PUT", url: "/api/state", headers, payload: { state: sample(), version: 0 } });

  const stale = sample();
  stale.boards[0].name = "Pisando";
  const res = await app.inject({ method: "PUT", url: "/api/state", headers, payload: { state: stale, version: 0 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().version, 1);
  assert.equal(res.json().state.boards[0].name, "Prueba");
  await app.close();
});

test("PUT con datos inválidos devuelve 400 y no modifica nada", async () => {
  const { app, session } = await setup();
  const headers = await session();
  for (const payload of [{ state: null, version: 0 }, { state: { boards: "x" }, version: 0 }, { state: sample(), version: "0" }, {}]) {
    const res = await app.inject({ method: "PUT", url: "/api/state", headers, payload });
    assert.equal(res.statusCode, 400);
  }
  assert.equal((await app.inject({ url: "/api/state", headers })).json().version, 0);
  await app.close();
});

test("PUT normaliza colores y etiquetas desconocidas", async () => {
  const { app, session } = await setup();
  const headers = await session();
  const dirty = sample();
  dirty.boards[0].color = "no-es-un-color";
  dirty.boards[0].columns[0].cards = [{ id: "k1", title: "Tarjeta", labels: ["no-existe"], color: "rojo" }];
  await app.inject({ method: "PUT", url: "/api/state", headers, payload: { state: dirty, version: 0 } });
  const { state } = (await app.inject({ url: "/api/state", headers })).json();
  assert.equal(state.boards[0].color, "#0079bf");
  assert.deepEqual(state.boards[0].columns[0].cards[0].labels, []);
  assert.equal(state.boards[0].columns[0].cards[0].color, null);
  await app.close();
});

test("PUT rechaza Content-Type que no sea JSON (defensa CSRF)", async () => {
  const { app, session } = await setup();
  const headers = { ...(await session()), "content-type": "text/plain" };
  const res = await app.inject({ method: "PUT", url: "/api/state", headers, payload: JSON.stringify({ state: sample(), version: 0 }) });
  assert.equal(res.statusCode, 415);
  await app.close();
});

test("logout invalida la sesión", async () => {
  const { app, session } = await setup();
  const headers = await session();
  assert.equal((await app.inject({ url: "/api/state", headers })).statusCode, 200);
  await app.inject({ method: "POST", url: "/api/logout", headers });
  assert.equal((await app.inject({ url: "/api/state", headers })).statusCode, 401);
  await app.close();
});

test("el login limita los intentos a 5 por minuto", async () => {
  const { app, login } = await setup();
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await login("mal-mal-mal-mal")).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429]);
  await app.close();
});

test("sirve el frontend y las cabeceras de seguridad", async () => {
  const { app } = await setup();
  const res = await app.inject({ url: "/" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  await app.close();
});
