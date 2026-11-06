import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, color, optColor } from "../public/normalize.js";

test("rechaza entradas que no son un estado", () => {
  for (const v of [null, undefined, 1, "x", {}, { boards: "x" }, { boards: [] }, { boards: [null, 3] }]) {
    assert.equal(normalize(v), null);
  }
});

test("completa campos que faltan con valores por defecto", () => {
  const s = normalize({ boards: [{ columns: [{ cards: [{}] }] }] });
  const b = s.boards[0];
  assert.equal(b.name, "Tablero");
  assert.equal(b.columns[0].name, "Columna");
  assert.equal(b.columns[0].cards[0].title, "Sin título");
  assert.ok(b.id && b.columns[0].id && b.columns[0].cards[0].id);
});

test("descarta etiquetas de tarjeta que no existen en el tablero", () => {
  const s = normalize({
    boards: [{ labels: [{ id: "l1", name: "A" }], columns: [{ cards: [{ title: "t", labels: ["l1", "zz"] }] }] }]
  });
  assert.deepEqual(s.boards[0].columns[0].cards[0].labels, ["l1"]);
});

test("valida colores hexadecimales", () => {
  assert.equal(color("#abcdef"), "#abcdef");
  assert.equal(color("red"), "#0079bf");
  assert.equal(optColor("#ABCDEF"), "#ABCDEF");
  assert.equal(optColor("#abc"), null);
  assert.equal(optColor(undefined), null);
});

test("es idempotente", () => {
  const once = normalize({ boards: [{ name: "X", columns: [{ name: "C", cards: [{ title: "T", desc: "d" }] }] }] });
  assert.deepEqual(normalize(once), once);
});
