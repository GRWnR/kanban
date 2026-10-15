"use strict";
const KEY = "kanban-v1";
const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0", "#0079bf", "#00c2e0", "#51e898"];
const HEX = /^#[0-9a-f]{6}$/i;
const color = value => HEX.test(value) ? value : COLORS[5];
const optColor = value => HEX.test(value) ? value : null;
const ink = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#172b4d" : "#fff";
};
const shade = (hex, f) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("");
const paint = hex => (hex = optColor(hex)) ? `style="--bg:${hex};--fg:${ink(hex)}"` : "";

function newBoard(name) {
  return {
    id: uid(), name, color: COLORS[5],
    labels: [{ id: uid(), name: "Importante", color: COLORS[3] }, { id: uid(), name: "Mejora", color: COLORS[0] }],
    columns: ["Por hacer", "En curso", "Hecho"].map(n => ({ id: uid(), name: n, cards: [] }))
  };
}

/* Valida y completa un estado leído de localStorage o de un archivo importado. */
function normalize(s) {
  if (!s || !Array.isArray(s.boards)) return null;
  const str = v => typeof v === "string" ? v : "";
  const id = v => typeof v === "string" && v ? v : uid();
  const list = v => Array.isArray(v) ? v.filter(x => x && typeof x === "object") : [];
  const boards = list(s.boards).map(b => {
    const labels = list(b.labels).map(l => ({ id: id(l.id), name: str(l.name), color: color(l.color) }));
    const known = new Set(labels.map(l => l.id));
    return {
      id: id(b.id), name: str(b.name) || "Tablero", color: color(b.color), labels,
      columns: list(b.columns).map(c => ({
        id: id(c.id), name: str(c.name) || "Columna", color: optColor(c.color),
        cards: list(c.cards).map(k => ({
          id: id(k.id), title: str(k.title) || "Sin título", desc: str(k.desc),
          labels: (Array.isArray(k.labels) ? k.labels : []).filter(x => known.has(x)), color: optColor(k.color)
        }))
      }))
    };
  });
  return boards.length ? { current: str(s.current), boards } : null;
}

let state;
try { state = normalize(JSON.parse(localStorage.getItem(KEY))); } catch { state = null; }
if (!state) {
  const b = newBoard("Mi tablero");
  state = { current: b.id, boards: [b] };
}
const notice = msg => { const n = $("#notice"); n.textContent = msg; n.hidden = !msg; };
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); notice(""); }
  catch { notice("No se pudieron guardar los cambios en este navegador. Exporta una copia para no perderlos."); }
};
const board = () => state.boards.find(b => b.id === state.current) || state.boards[0];
const update = () => { save(); render(); };

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

/* ---------- Sincronización entre pestañas ---------- */
window.addEventListener("storage", e => {
  if (e.key !== KEY || drag) return;
  let next;
  try { next = normalize(JSON.parse(e.newValue)); } catch { next = null; }
  if (!next) return;
  next.current = state.current;
  state = next;
  if (dlg.open) dlg.close();
  render();
});

render();
