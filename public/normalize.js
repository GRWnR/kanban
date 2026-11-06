/* Módulo compartido entre el navegador y el servidor: valida y completa un estado. */
export const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
export const COLORS = ["#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0", "#0079bf", "#00c2e0", "#51e898"];
export const HEX = /^#[0-9a-f]{6}$/i;
export const color = value => HEX.test(value) ? value : COLORS[5];
export const optColor = value => HEX.test(value) ? value : null;

export function newBoard(name) {
  return {
    id: uid(), name, color: COLORS[5],
    labels: [{ id: uid(), name: "Importante", color: COLORS[3] }, { id: uid(), name: "Mejora", color: COLORS[0] }],
    columns: ["Por hacer", "En curso", "Hecho"].map(n => ({ id: uid(), name: n, cards: [] }))
  };
}

/* Valida y completa un estado leído de la red, de localStorage o de un archivo importado. */
export function normalize(s) {
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
