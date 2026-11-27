import test from "node:test";
import assert from "node:assert/strict";
import { campanhaAtual } from "../servidor/campanha.js";

const em = (data) => campanhaAtual(Date.parse(data));

test("campanha só existe no próprio dia da data dupla (horário de Brasília)", () => {
  assert.equal(em("2026-11-12T12:00:00-03:00"), null, "véspera de mês: nada");
  assert.equal(em("2026-12-12T00:00:00-03:00"), "12.12");
  assert.equal(em("2026-12-12T23:59:00-03:00"), "12.12");
  assert.equal(em("2026-12-13T00:00:00-03:00"), null, "passou o dia, some");
  assert.equal(em("2027-01-01T10:00:00-03:00"), "1.1");
  assert.equal(em("2027-02-02T22:00:00-03:00"), "2.2", "22h em Brasília já é dia 3 em UTC");
  assert.equal(em("2027-11-11T08:00:00-03:00"), "11.11");
});

import { estadoBlackFriday, janelaBlackFriday, proximaCampanha } from "../servidor/campanha.js";
test("contagem: próxima data dupla e dias que faltam (0 no dia)", () => {
  assert.deepEqual(proximaCampanha(Date.parse("2026-11-12T12:00:00-03:00")), { nome: "12.12", dias: 30 });
  assert.deepEqual(proximaCampanha(Date.parse("2026-12-12T20:00:00-03:00")), { nome: "12.12", dias: 0 });
  assert.deepEqual(proximaCampanha(Date.parse("2026-12-13T08:00:00-03:00")), { nome: "1.1", dias: 19 });
  assert.deepEqual(proximaCampanha(Date.parse("2027-01-31T08:00:00-03:00")), { nome: "2.2", dias: 2 });
});

test("Black Friday: ativa da 4ª sexta de novembro até o fim da Cyber Monday (Brasília)", () => {
  assert.equal(janelaBlackFriday(2026).diaInicio, 27);
  assert.equal(janelaBlackFriday(2027).diaInicio, 26);
  assert.equal(em("2026-11-26T23:59:00-03:00"), null, "véspera ainda não começou");
  assert.equal(em("2026-11-27T00:00:00-03:00"), "Black Friday", "começou 00:00 de sexta");
  assert.equal(em("2026-11-29T18:00:00-03:00"), "Black Friday", "fim de semana da Black");
  assert.equal(em("2026-11-30T23:59:00-03:00"), "Black Friday", "Cyber Monday ainda vale");
  assert.equal(em("2026-12-01T00:00:00-03:00"), null, "terça já encerrou");
  assert.equal(estadoBlackFriday(Date.parse("2026-11-27T10:00:00-03:00")).fase, "ativa");
  assert.equal(estadoBlackFriday(Date.parse("2026-11-30T10:00:00-03:00")).fase, "cyber");
  assert.equal(estadoBlackFriday(Date.parse("2026-11-20T10:00:00-03:00")).fase, "antes");
  assert.equal(estadoBlackFriday(Date.parse("2026-12-05T10:00:00-03:00")).fase, "encerrada");
});
