import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DOC_ID = "main";
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const SNAPSHOT_KEEP = 50;

const sha = token => createHash("sha256").update(token).digest("hex");

/* Abre (o crea) la base de datos. dataDir puede ser ":memory:" para las pruebas. */
export function openDb(dataDir) {
  const memory = dataDir === ":memory:";
  if (!memory) mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(memory ? ":memory:" : join(dataDir, "kanban.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    );
  `);

  const q = {
    getDoc: db.prepare("SELECT data, version FROM documents WHERE id = ?"),
    insertDoc: db.prepare("INSERT INTO documents (id, data, version, updated_at) VALUES (?, ?, 1, ?)"),
    updateDoc: db.prepare("UPDATE documents SET data = ?, version = version + 1, updated_at = ? WHERE id = ?"),
    lastSnapshot: db.prepare("SELECT created_at FROM snapshots ORDER BY id DESC LIMIT 1"),
    addSnapshot: db.prepare("INSERT INTO snapshots (data, created_at) VALUES (?, ?)"),
    pruneSnapshots: db.prepare("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)"),
    addSession: db.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)"),
    getSession: db.prepare("SELECT expires_at FROM sessions WHERE id = ?"),
    delSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at < ?")
  };

  const transaction = fn => {
    db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); db.exec("COMMIT"); return r; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };

  return {
    /* Devuelve { state, version }; version 0 significa que todavía no hay datos. */
    getState() {
      const row = q.getDoc.get(DOC_ID);
      return row ? { state: JSON.parse(row.data), version: row.version } : { state: null, version: 0 };
    },
    /* Guarda si `version` coincide con la actual. Devuelve { ok, version, state? }. */
    saveState(state, version) {
      return transaction(() => {
        const row = q.getDoc.get(DOC_ID);
        const current = row ? row.version : 0;
        if (current !== version) return { ok: false, version: current, state: row ? JSON.parse(row.data) : null };
        const data = JSON.stringify(state), now = Date.now();
        if (row) q.updateDoc.run(data, now, DOC_ID); else q.insertDoc.run(DOC_ID, data, now);
        const last = q.lastSnapshot.get();
        if (!last || now - last.created_at >= SNAPSHOT_EVERY_MS) {
          q.addSnapshot.run(data, now);
          q.pruneSnapshots.run(SNAPSHOT_KEEP);
        }
        return { ok: true, version: current + 1 };
      });
    },
    createSession(token, ttlMs) {
      q.purgeSessions.run(Date.now());
      q.addSession.run(sha(token), Date.now() + ttlMs);
    },
    hasSession(token) {
      const row = q.getSession.get(sha(token));
      return !!row && row.expires_at > Date.now();
    },
    deleteSession(token) { q.delSession.run(sha(token)); },
    close() { db.close(); }
  };
}
