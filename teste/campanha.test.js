import test from "node:test";
import assert from "node:assert/strict";
import { campanhaAtual } from "../servidor/campanha.js";

const em = (data) => campanhaAtual(Date.parse(data));

test("campanha é sempre a próxima data dupla, contando o dia até 23:59 de Brasília", () => {
  assert.equal(em("2026-11-12T12:00:00-03:00"), "12.12");
  assert.equal(em("2026-12-12T23:59:00-03:00"), "12.12");
  assert.equal(em("2026-12-13T00:00:00-03:00"), "1.1", "virada do ano");
  assert.equal(em("2027-01-01T10:00:00-03:00"), "1.1");
  assert.equal(em("2027-01-02T00:00:00-03:00"), "2.2");
  assert.equal(em("2027-02-02T22:00:00-03:00"), "2.2", "22h em Brasília já é dia 3 em UTC");
  assert.equal(em("2027-02-28T10:00:00-03:00"), "3.3");
  assert.equal(em("2027-11-05T10:00:00-03:00"), "11.11");
});
