import { uid, color, optColor, newBoard, normalize } from "./normalize.js";

const KEY = "kanban-v1"; // caché local y origen de la migración inicial a la nube
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ink = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#172b4d" : "#fff";
};
const shade = (hex, f) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("");
const paint = hex => (hex = optColor(hex)) ? `style="--bg:${hex};--fg:${ink(hex)}"` : "";

/* ---------- Estado y sincronización con el servidor ---------- */
let state = null;     // documento { current, boards[] }
let version = 0;      // versión del servidor sobre la que se basa `state`
let dirty = false;    // hay cambios sin enviar
let saving = false;   // hay un PUT en curso
let stale = false;    // otro dispositivo o pestaña guardó mientras estábamos ocupados
let saveTimer = null;
const SAVE_DELAY = 400, RETRY_DELAY = 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const notice = msg => { const n = $("#notice"); n.textContent = msg; n.hidden = !msg; };
const channel = "BroadcastChannel" in window ? new BroadcastChannel("kanban-sync") : null;

const api = (path, { body, ...opts } = {}) => fetch(path, {
  credentials: "same-origin", ...opts,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })
});
/* Copia local: respaldo y origen de la migración si el servidor está vacío. */
const cache = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sin espacio o bloqueado: no es crítico */ } };

const board = () => state.boards.find(b => b.id === state.current) || state.boards[0];
const save = () => { cache(); dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, SAVE_DELAY); };
const update = () => { save(); render(); };

/* Adopta el estado del servidor conservando el tablero que se está viendo en este dispositivo. */
function applyServer(s, v) {
  const next = normalize(s);
  if (!next) return false;
  if (state && next.boards.some(b => b.id === state.current)) next.current = state.current;
  state = next; version = v; cache();
  if (dlg.open) dlg.close();
  render();
  return true;
}

async function flush() {
  saveTimer = null; // este temporizador ya se disparó
  if (saving || !dirty) return;
  saving = true; dirty = false;
  try {
    const res = await api("/api/state", { method: "PUT", body: { state, version } });
    if (res.ok) {
      version = (await res.json()).version;
      notice("");
      channel?.postMessage("saved");
    } else if (res.status === 409) {
      const j = await res.json();
      if (applyServer(j.state, j.version)) notice("Otro dispositivo guardó cambios antes que tú: se cargó su versión. Repite tu último cambio si no aparece.");
    } else if (res.status === 401) {
      dirty = true;
      await login("La sesión ha caducado.");
    } else {
      notice("El servidor rechazó los cambios. Exporta una copia para no perderlos.");
    }
  } catch {
    dirty = true;
    notice("Sin conexión con el servidor. Los cambios se enviarán cuando vuelva.");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, RETRY_DELAY);
  } finally {
    saving = false;
    if (dirty && !saveTimer) saveTimer = setTimeout(flush, SAVE_DELAY);
    else if (!dirty && stale) refresh();
  }
}

/* Pide el estado al servidor y lo adopta si otro dispositivo o pestaña lo cambió. */
async function refresh() {
  if (dirty || saving || drag || dlg.open) { stale = true; return; }
  stale = false;
  try {
    const res = await api("/api/state");
    if (res.status === 401) return void await login();
    if (!res.ok) return;
    const j = await res.json();
    if (j.state && j.version !== version) applyServer(j.state, j.version);
  } catch { /* sin conexión: se reintentará al volver a la pestaña */ }
}

/* Carga inicial: login si hace falta y migración de localStorage si el servidor está vacío. */
async function init() {
  for (;;) {
    let res;
    try { res = await api("/api/state"); }
    catch { notice("No se puede conectar con el servidor. Reintentando…"); await sleep(RETRY_DELAY); continue; }
    if (res.status === 401) { notice(""); await login(); continue; }
    if (!res.ok) { notice(`Error del servidor (${res.status}). Reintentando…`); await sleep(RETRY_DELAY); continue; }
    const j = await res.json();
    notice("");
    version = j.version;
    state = normalize(j.state);
    if (state) return void cache();
    let local = null;
    try { local = normalize(JSON.parse(localStorage.getItem(KEY))); } catch { /* sin copia local */ }
    if (!local) { const b = newBoard("Mi tablero"); local = { current: b.id, boards: [b] }; }
    state = local;
    return void save();
  }
}

/* ---------- Diálogos ---------- */
const dlg = $("#dlg"), form = $("#dlgForm");
function openDlg(html, onSubmit) {
  form.innerHTML = html;
  form.onsubmit = e => {
    e.preventDefault();
    if (onSubmit(form, e.submitter) !== false) dlg.close();
  };
  form.querySelectorAll("[data-close]").forEach(b => b.onclick = () => dlg.close());
  if (!dlg.open) dlg.showModal();
  form.querySelector("input[type=text],textarea")?.focus();
}
function ask(title, label, value, ok) {
  openDlg(`<h2>${esc(title)}</h2>
    <label>${esc(label)}<input type="text" name="v" value="${esc(value)}" required maxlength="80"></label>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="primary">Guardar</button></div>`,
    f => { const v = f.v.value.trim(); if (!v) return false; ok(v); });
}
function confirmDlg(msg, ok, action = "Eliminar") {
  openDlg(`<h2>Confirmar</h2><p>${esc(msg)}</p>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="danger">${esc(action)}</button></div>`,
    () => { ok(); });
}

function colorDlg(title, current, fallback, onPick) {
  openDlg(`<h2>${esc(title)}</h2>
    <label>Elige un color<input type="color" name="color" value="${optColor(current) || fallback}"></label>
    <div class="actions"><button type="button" data-clear>Quitar color</button><span class="spacer"></span>
    <button type="button" data-close>Cancelar</button><button class="primary">Guardar</button></div>`,
    f => { onPick(optColor(f.color.value)); });
  form.querySelector("[data-clear]").onclick = () => { onPick(null); dlg.close(); };
}

/* Diálogo de acceso: no se puede cerrar con Esc porque la app no funciona sin sesión. */
function showLogin(message) {
  return new Promise(resolve => {
    const block = e => e.preventDefault();
    dlg.addEventListener("cancel", block);
    openDlg(`<h2>Iniciar sesión</h2>
      <p id="loginErr" class="form-error" role="alert"${message ? "" : " hidden"}>${esc(message)}</p>
      <label>Contraseña<input type="password" name="pw" required autocomplete="current-password"></label>
      <div class="actions"><span class="spacer"></span><button class="primary">Entrar</button></div>`,
      f => {
        const err = $("#loginErr"), pw = f.pw;
        const fail = text => { err.textContent = text; err.hidden = false; pw.value = ""; pw.focus(); };
        api("/api/login", { method: "POST", body: { password: pw.value } }).then(res => {
          if (!res.ok) return fail(res.status === 429 ? "Demasiados intentos. Espera un minuto." : "Contraseña incorrecta.");
          dlg.removeEventListener("cancel", block);
          dlg.close();
          resolve();
        }).catch(() => fail("No se pudo conectar con el servidor."));
        return false; // el diálogo se cierra solo cuando el servidor acepta la contraseña
      });
    form.pw.focus();
  });
}
let loginPromise = null; // evita abrir dos diálogos si varias peticiones reciben 401 a la vez
const login = message => loginPromise ??= showLogin(message).finally(() => { loginPromise = null; });

/* ---------- Render ---------- */
function render() {
  const sel = $("#boardSelect");
  sel.innerHTML = state.boards.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
  const b = board();
  sel.value = b.id;
  $("#deleteBoard").disabled = state.boards.length < 2;

  const bc = color(b.color);
  document.body.style.setProperty("--board-color", bc);
  document.body.style.setProperty("--board-ink", ink(bc));
  document.body.style.setProperty("--bar-ink", ink(shade(bc, 0.7)));
  const lbl = id => b.labels.find(l => l.id === id);
  $("#board").innerHTML = b.columns.map(c => `
    <section class="column${optColor(c.color) ? " colored" : ""}" data-id="${esc(c.id)}" ${paint(c.color)}>
      <div class="col-head" draggable="true">
        <h3>${esc(c.name)}</h3>
        <button class="icon" data-act="color-col" title="Color" aria-label="Color de la columna">🎨</button>
        <button class="icon" data-act="ren-col" title="Renombrar" aria-label="Renombrar columna">✎</button>
        <button class="icon" data-act="del-col" title="Eliminar" aria-label="Eliminar columna">🗑</button>
      </div>
      <div class="cards">${c.cards.map(k => `
        <article class="card${optColor(k.color) ? " colored" : ""}" draggable="true" tabindex="0" role="button" data-id="${esc(k.id)}" ${paint(k.color)}>
          ${k.labels.some(lbl) ? `<div class="chips">${k.labels.filter(lbl).map(id => `<span class="chip" ${paint(lbl(id).color)}>${esc(lbl(id).name)}</span>`).join("")}</div>` : ""}
          <h4>${esc(k.title)}</h4>${k.desc ? `<p>${esc(k.desc)}</p>` : ""}
        </article>`).join("")}</div>
      <button class="add" data-act="add-card">+ Añadir tarjeta</button>
    </section>`).join("") + `<button class="add-col" data-act="add-col">+ Añadir columna</button>`;
}

/* ---------- Acciones ---------- */
$("#boardSelect").onchange = e => { state.current = e.target.value; update(); };
$("#newBoard").onclick = () => ask("Nuevo tablero", "Nombre", "", v => { const b = newBoard(v); state.boards.push(b); state.current = b.id; update(); });
$("#renameBoard").onclick = () => ask("Renombrar tablero", "Nombre", board().name, v => { board().name = v; update(); });
$("#changeBoardColor").onclick = () => {
  const b = board();
  openDlg(`<h2>Color del tablero</h2>
    <label>Elige un color<input type="color" name="color" value="${color(b.color)}"></label>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="primary">Guardar</button></div>`,
    f => { b.color = color(f.color.value); update(); });
};
$("#deleteBoard").onclick = () => confirmDlg(`¿Eliminar el tablero "${board().name}" y todo su contenido?`, () => {
  const b = board();
  state.boards = state.boards.filter(x => x !== b); state.current = state.boards[0].id; update();
});
$("#manageLabels").onclick = labelsDlg;

$("#exportData").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  a.download = `kanban-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("#importData").onclick = () => $("#importFile").click();
$("#importFile").onchange = async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let next;
  try { next = normalize(JSON.parse(await file.text())); } catch { next = null; }
  if (!next) return openDlg(`<h2>Importar</h2><p>El archivo no es una copia válida de los tableros.</p>
    <div class="actions"><button class="primary">Aceptar</button></div>`, () => {});
  confirmDlg(`¿Reemplazar todos los tableros actuales por los ${next.boards.length} del archivo?`, () => { state = next; update(); }, "Reemplazar");
};

$("#board").addEventListener("click", e => {
  const colEl = e.target.closest(".column"), b = board();
  const col = colEl && b.columns.find(c => c.id === colEl.dataset.id);
  const act = e.target.dataset.act;
  if (act === "add-col") return ask("Nueva columna", "Nombre", "", v => { b.columns.push({ id: uid(), name: v, cards: [] }); update(); });
  if (act === "color-col") return colorDlg("Color de la columna", col.color, "#ebecf0", v => { col.color = v; update(); });
  if (act === "ren-col") return ask("Renombrar columna", "Nombre", col.name, v => { col.name = v; update(); });
  if (act === "del-col") return confirmDlg(`¿Eliminar la columna "${col.name}" y sus ${col.cards.length} tarjetas?`, () => { b.columns = b.columns.filter(c => c !== col); update(); });
  if (act === "add-card") return cardDlg(col, null);
  const cardEl = e.target.closest(".card");
  if (cardEl) cardDlg(col, col.cards.find(k => k.id === cardEl.dataset.id));
});
$("#board").addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".card")) { e.preventDefault(); e.target.click(); }
});

function cardDlg(col, card) {
  const b = board(), isNew = !card;
  const labels = b.labels.length ? b.labels.map(l => `
    <label class="pick"><input type="checkbox" name="lb" value="${esc(l.id)}" ${card?.labels.includes(l.id) ? "checked" : ""}>
    <span class="chip" ${paint(l.color)}>${esc(l.name)}</span></label>`).join("") : "<em>Sin etiquetas (créalas en «Etiquetas»)</em>";
  const cols = b.columns.map(c => `<option value="${esc(c.id)}"${c === col ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  openDlg(`<h2>${isNew ? "Nueva tarjeta" : "Editar tarjeta"}</h2>
    <label>Título<input type="text" name="t" value="${esc(card?.title)}" required maxlength="200"></label>
    <label>Descripción<textarea name="d">${esc(card?.desc)}</textarea></label>
    <label>Columna<select name="col">${cols}</select></label>
    <div><strong>Etiquetas</strong>${labels}</div>
    <div class="color-row"><strong>Color</strong><input type="color" name="c" value="${optColor(card?.color) || "#ffffff"}">
    <label class="pick"><input type="checkbox" name="nc" ${optColor(card?.color) ? "" : "checked"}> Sin color</label></div>
    <div class="actions">${isNew ? "" : `<button type="button" class="danger" data-del>Eliminar</button>`}<span class="spacer"></span>
    <button type="button" data-close>Cancelar</button><button class="primary">Guardar</button></div>`,
    f => {
      const title = f.t.value.trim(); if (!title) return false;
      const ls = [...f.querySelectorAll("[name=lb]:checked")].map(i => i.value);
      const c = f.nc.checked ? null : optColor(f.c.value);
      const dest = b.columns.find(x => x.id === f.col.value) || col;
      if (isNew) dest.cards.push({ id: uid(), title, desc: f.d.value, labels: ls, color: c });
      else {
        Object.assign(card, { title, desc: f.d.value, labels: ls, color: c });
        if (dest !== col) { col.cards = col.cards.filter(k => k !== card); dest.cards.push(card); }
      }
      update();
    });
  form.c.oninput = () => form.nc.checked = false;
  const del = form.querySelector("[data-del]");
  if (del) del.onclick = () => confirmDlg(`¿Eliminar la tarjeta "${card.title}"?`, () => { col.cards = col.cards.filter(k => k !== card); update(); });
}

function labelsDlg() {
  const b = board();
  const row = l => `<div class="lbl-row" data-id="${esc(l?.id)}">
    <input type="text" value="${esc(l?.name)}" placeholder="Nombre" maxlength="40">
    <input type="color" value="${color(l?.color)}">
    <button type="button" class="danger" data-rm title="Eliminar" aria-label="Eliminar etiqueta">🗑</button></div>`;
  openDlg(`<h2>Etiquetas de «${esc(b.name)}»</h2><div id="lblList" class="lbl-list">${b.labels.map(row).join("")}</div>
    <button type="button" id="lblAdd">+ Nueva etiqueta</button>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="primary">Guardar</button></div>`,
    f => {
      const next = [];
      f.querySelectorAll(".lbl-row").forEach(r => {
        const [n, c] = r.querySelectorAll("input"), name = n.value.trim();
        if (!name) return;
        next.push({ id: r.dataset.id || uid(), name, color: color(c.value) });
      });
      const keep = new Set(next.map(l => l.id));
      b.labels = next;
      b.columns.forEach(c => c.cards.forEach(k => k.labels = k.labels.filter(id => keep.has(id))));
      update();
    });
  const list = $("#lblList");
  list.onclick = e => e.target.closest("[data-rm]")?.closest(".lbl-row").remove();
  $("#lblAdd").onclick = () => { list.insertAdjacentHTML("beforeend", row()); list.lastElementChild.querySelector("input").focus(); };
}

/* ---------- Drag & drop ---------- */
let drag = null;
const boardEl = $("#board");
boardEl.addEventListener("dragstart", e => {
  const card = e.target.closest?.(".card"), head = e.target.closest?.(".col-head");
  drag = card ? card : head ? head.parentElement : null;
  if (!drag) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "");
  requestAnimationFrame(() => drag?.classList.add("dragging"));
});
const after = (container, sel, pos, horiz) => {
  let best = { off: -Infinity, el: null };
  container.querySelectorAll(sel + ":not(.dragging)").forEach(el => {
    const r = el.getBoundingClientRect();
    const off = pos - (horiz ? r.left + r.width / 2 : r.top + r.height / 2);
    if (off < 0 && off > best.off) best = { off, el };
  });
  return best.el;
};
boardEl.addEventListener("dragover", e => {
  if (!drag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (drag.classList.contains("card")) {
    const cards = e.target.closest?.(".column")?.querySelector(".cards");
    if (cards) cards.insertBefore(drag, after(cards, ".card", e.clientY, false));
  } else {
    boardEl.insertBefore(drag, after(boardEl, ".column", e.clientX, true) || $(".add-col"));
  }
});
boardEl.addEventListener("drop", e => e.preventDefault());
boardEl.addEventListener("dragend", e => {
  if (!drag) return;
  drag.classList.remove("dragging");
  drag = null;
  // Arrastre cancelado (Esc o soltado fuera del tablero): se descarta el movimiento.
  if (e.dataTransfer.dropEffect === "none") return render();
  const b = board();
  const cards = new Map(b.columns.flatMap(c => c.cards).map(k => [k.id, k]));
  const cols = new Map(b.columns.map(c => [c.id, c]));
  b.columns = [...boardEl.querySelectorAll(".column")].map(el => {
    const c = cols.get(el.dataset.id);
    c.cards = [...el.querySelectorAll(".card")].map(k => cards.get(k.dataset.id));
    return c;
  });
  update();
});

/* ---------- Sincronización entre pestañas y dispositivos ---------- */
if (channel) channel.onmessage = () => refresh();
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
window.addEventListener("online", () => { if (dirty) flush(); });
dlg.addEventListener("close", () => { if (stale) refresh(); });

$("#logout").onclick = async () => {
  clearTimeout(saveTimer);
  while (saving) await sleep(50);
  if (dirty) await flush();
  if (dirty) return notice("No se puede cerrar la sesión: hay cambios sin enviar al servidor.");
  try { await api("/api/logout", { method: "POST" }); } catch { /* sin conexión: se limpia igualmente en local */ }
  try { localStorage.removeItem(KEY); } catch { /* nada que limpiar */ }
  location.reload();
};

/* ---------- Arranque ---------- */
const shell = document.querySelectorAll(".topbar, #board");
shell.forEach(el => el.inert = true); // sin datos cargados no se puede interactuar
await init();
shell.forEach(el => el.inert = false);
render();
