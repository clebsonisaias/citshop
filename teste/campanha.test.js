import test from "node:test";
import assert from "node:assert/strict";
import { campanhaAtual } from "../servidor/campanha.js";

test("campanha 12.12 vale até 23:59 de 12/12 (Brasília) e depois some", () => {
  assert.equal(campanhaAtual(Date.parse("2026-11-12T12:00:00-03:00")), "12.12");
  assert.equal(campanhaAtual(Date.parse("2026-12-12T23:59:00-03:00")), "12.12");
  assert.equal(campanhaAtual(Date.parse("2026-12-13T00:00:00-03:00")), null);
});
