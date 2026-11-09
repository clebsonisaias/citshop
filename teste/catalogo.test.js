import test from "node:test";
import assert from "node:assert/strict";
import { filtrarCatalogo, pontuarBusca } from "../publico/catalogo.js";

const produtos = [
  { id: "local-1", nome: "Cafeteira elétrica", descricao: "Prepara café", dept: "eletro", categoriaNome: "Eletrodomésticos", loja: "local", lojaNome: "Casa São João", cidade: "Fortaleza", preco: 180, precoAntigo: 220 },
  { id: "amazon-1", nome: "Cafeteira Espresso", descricao: "Máquina de café", dept: "cozinha", categoriaNome: "Cozinha", loja: "amazon", preco: 150, precoAntigo: 200 },
  { id: "ml-1", nome: "Fone sem fio", descricao: "Bluetooth", dept: "tec", categoriaNome: "Eletrônicos", loja: "ml", preco: 90 },
];

test("busca ignora acentos, encontra categoria e tolera erro simples de digitação", () => {
  assert.ok(pontuarBusca(produtos[0], "eletrica") > 0);
  assert.ok(pontuarBusca(produtos[0], "eletrodomesticos") > 0);
  assert.ok(pontuarBusca(produtos[0], "cafeteir") > 0);
  assert.equal(pontuarBusca(produtos[2], "cafeteira"), 0);
});

test("busca combina termos por relevância e mantém lojas locais à frente", () => {
  const lista = filtrarCatalogo(produtos, { q: "cafeteira cafe", ordem: "relevancia" });
  assert.deepEqual(lista.map((p) => p.id), ["local-1", "amazon-1"]);
});

test("filtros de origem e faixa de preço combinam sem incluir outros vendedores", () => {
  const lista = filtrarCatalogo(produtos, { origem: "amazon", precoMin: "140", precoMax: "160" });
  assert.deepEqual(lista.map((p) => p.id), ["amazon-1"]);
});

test("ordena por preço e desconto dentro do grupo, mantendo a prioridade das lojas locais", () => {
  assert.deepEqual(filtrarCatalogo(produtos, { ordem: "menor" }).map((p) => p.id), ["local-1", "ml-1", "amazon-1"]);
  assert.deepEqual(filtrarCatalogo(produtos, { ordem: "desconto" }).map((p) => p.id), ["local-1", "amazon-1", "ml-1"]);
});

test("filtros de departamento, cidade e subcategoria são aplicados em conjunto", () => {
  const lista = filtrarCatalogo([
    { ...produtos[0], sub: "Expresso" },
    { ...produtos[0], id: "local-2", cidade: "Natal", sub: "Expresso" },
  ], { dept: "eletro", cidade: "Fortaleza", sub: "Expresso" });
  assert.deepEqual(lista.map((p) => p.id), ["local-1"]);
});
