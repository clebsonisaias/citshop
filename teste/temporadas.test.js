import test from "node:test";
import assert from "node:assert/strict";
import { temporadaDo, temporadasAtivas } from "../publico/temporadas.js";
import { ranquearOfertas } from "../servidor/motor-ofertas/ranking.js";

const em = (iso) => Date.parse(`${iso}T15:00:00Z`);
const ids = (t) => temporadasAtivas(em(t)).map((s) => s.id);

test("temporadas: Natal até 24/12, mesa posta, looks e réveillon até 1/1 (horário de Brasília)", () => {
  assert.deepEqual(ids("2026-10-31"), []);
  assert.deepEqual(ids("2026-11-14"), ["natal", "mesa", "looks", "anonovo"]);
  assert.deepEqual(ids("2026-12-24"), ["natal", "mesa", "looks", "anonovo"]);
  assert.deepEqual(ids("2026-12-25"), ["mesa", "looks", "anonovo"]);
  assert.deepEqual(ids("2027-01-01"), ["mesa", "looks", "anonovo", "aulas"], "1/1: últimas horas do réveillon e começo da volta às aulas");
  assert.deepEqual(temporadasAtivas(Date.parse("2027-01-02T02:59:00Z")).map((s) => s.id), ["mesa", "looks", "anonovo", "aulas"], "1/1 às 23:59 em Brasília ainda vale");
  assert.deepEqual(ids("2027-01-02"), ["aulas"]);
  assert.deepEqual(ids("2027-02-28"), ["aulas"]);
  assert.deepEqual(ids("2027-03-01"), []);
});

test("temporadas: produto entra pela palavra do nome", () => {
  const a = temporadasAtivas(em("2026-11-20"));
  assert.equal(temporadaDo({ nome: "Árvore de Natal 1,80m" }, a), "natal");
  assert.equal(temporadaDo({ nome: "Pisca Pisca 100 LEDs" }, a), "natal");
  assert.equal(temporadaDo({ nome: "Vestido Midi Branco Alcinha" }, a), "looks");
  assert.equal(temporadaDo({ nome: "Camisa Social Vermelha Slim" }, a), "looks");
  assert.equal(temporadaDo({ nome: "Kit 6 Taças de Champanhe Cristal" }, a), "mesa");
  assert.equal(temporadaDo({ nome: "Sousplat Rattan Dourado 35cm" }, a), "mesa");
  assert.equal(temporadaDo({ nome: "Kit Réveillon Chapéu e Óculos" }, a), "anonovo");
  assert.equal(temporadaDo({ nome: "Fone Bluetooth Branco" }, a), null);
  assert.equal(temporadaDo({ nome: "BRANCO - Kit Fone de Ouvido Bluetooth com Conjunto de Pontas" }, a), null);
  assert.equal(temporadaDo({ nome: "Luminária de estaca solar floco de neve" }, a), null, "estaca não é taça");
  assert.equal(temporadaDo({ nome: "Mochila Escolar Rosa com Rodinhas" }, a), null, "volta às aulas só a partir de 1/1");
  assert.equal(temporadaDo({ nome: "Mochila Escolar Rosa com Rodinhas" }, temporadasAtivas(em("2027-01-10"))), "aulas");
  assert.equal(temporadaDo({ nome: "Natal decoração" }, temporadasAtivas(em("2027-02-10"))), null, "fora da data não conta");
});

test("ranking: na temporada, Natal tem cota própria e não perde vaga para o resto de 'casa'", () => {
  const casa = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, nome: `Organizador ${i}`, loja: "shopee", categoria: "casa", preco: 30, comissaoEstimada: 9 }));
  const natal = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, nome: `Enfeite de Natal ${i}`, loja: "shopee", categoria: "casa", preco: 30, comissaoEstimada: 1 }));
  const dentro = ranquearOfertas([...casa, ...natal], { agora: em("2026-12-01") }).map((p) => p.id);
  assert.equal(dentro.filter((id) => id.startsWith("n")).length, 5);
  const fora = ranquearOfertas([...casa, ...natal], { agora: em("2027-02-01") }).map((p) => p.id);
  assert.equal(fora.filter((id) => id.startsWith("n")).length, 0, "fora da data volta a disputar as 25 vagas de casa");
});
