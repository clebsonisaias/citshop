import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarHistorico, categoria, comoEbook } from "../servidor/coletor.js";

const DIA = 86_400_000;
const agora = Date.parse("2026-11-20T15:00:00Z");
const dia = (n) => new Date(agora - n * DIA).toISOString().slice(0, 10);
const tv = (preco) => ({ id: "amazon-TV", nome: "TV", loja: "amazon", preco });

test("primeira vez que o produto aparece: grava o preço e não marca nada", () => {
  const { produtos, historico } = aplicarHistorico([tv(100)], {}, agora);
  assert.equal(produtos[0].queda, undefined);
  assert.equal(produtos[0].menor30, undefined);
  assert.deepEqual(historico["amazon-TV"], [[dia(0), 100]]);
});

test("baixou mais de 3% em relação aos últimos 7 dias: marca queda e menor preço em 30 dias", () => {
  const h = { "amazon-TV": [[dia(20), 110], [dia(3), 120], [dia(1), 118]] };
  const { produtos } = aplicarHistorico([tv(99.9)], h, agora);
  assert.equal(produtos[0].queda, 20.1);
  assert.equal(produtos[0].menor30, true);
});

test("oscilação pequena ou preço acima do mínimo não ganha selo", () => {
  const h = { "amazon-TV": [[dia(10), 90], [dia(2), 101]] };
  const { produtos } = aplicarHistorico([tv(100)], h, agora);
  assert.equal(produtos[0].queda, undefined); // caiu só 1%
  assert.equal(produtos[0].menor30, undefined); // já esteve a 90
});

test("histórico guarda um preço por dia, esquece o que passou de 30 dias e limpa marca velha", () => {
  const h = { "amazon-TV": [[dia(40), 500], [dia(5), 120], [dia(0), 115]], "amazon-SUMIU": [[dia(2), 10]] };
  const { produtos, historico } = aplicarHistorico([{ ...tv(120), queda: 50, menor30: true }], h, agora);
  assert.deepEqual(historico["amazon-TV"], [[dia(5), 120], [dia(0), 120]]);
  assert.deepEqual(historico["amazon-SUMIU"], [[dia(2), 10]]); // fora da vitrine hoje, mas dentro dos 30 dias
  assert.equal(produtos[0].queda, undefined);
  assert.equal(produtos[0].menor30, undefined);
});

test("eBook Kindle vai sem ASIN (o carrinho da Amazon não aceita eBook) e com o formato no nome", () => {
  const e = comoEbook({ id: "amazon-B0X", asin: "B0X", nome: "A loja container", categoria: "livros", link: "https://www.amazon.com.br/dp/B0X?tag=t-20" });
  assert.equal(e.asin, undefined);
  assert.equal(e.nome, "A loja container (eBook Kindle)");
  assert.equal(comoEbook({ nome: "Box Kindle Edition" }).nome, "Box Kindle Edition");
});

test("categoria reconhece livros e games", () => {
  assert.equal(categoria("Livro de receitas da vovó"), "livros");
  assert.equal(categoria("Controle sem fio para PS5 DualSense"), "games");
  assert.equal(categoria("Fone Bluetooth"), "cel");
});
