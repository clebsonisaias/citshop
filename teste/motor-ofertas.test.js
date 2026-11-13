import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizarProduto, normalizarCategoria } from "../servidor/motor-ofertas/normalizador.js";
import { deduplicarProdutos } from "../servidor/motor-ofertas/deduplicador.js";
import { validarProduto, filtrarValidos } from "../servidor/motor-ofertas/validador.js";
import { calcularScore, ranquearOfertas } from "../servidor/motor-ofertas/ranking.js";
import { PublicadorOfertas } from "../servidor/motor-ofertas/publicador.js";

test("normalizador: normaliza categorias e higieniza números", () => {
  assert.equal(normalizarCategoria("eletronicos"), "tec");
  assert.equal(normalizarCategoria("ferramentas"), "ferr");
  assert.equal(normalizarCategoria("desconhecido"), "casa");

  const prod = normalizarProduto({
    id: "teste-1",
    nome: " Furadeira Elétrica 500W ",
    preco: "199.90",
    precoAntigo: "249.90",
    categoria: "ferramentas",
    link: "https://amazon.com.br/dp/B01?tag=citshop-20",
    imagem: "https://img.com/foto.jpg",
  });

  assert.equal(prod.nome, "Furadeira Elétrica 500W");
  assert.equal(prod.preco, 199.9);
  assert.equal(prod.precoAntigo, 249.9);
  assert.equal(prod.descontoPct, 20);
  assert.equal(prod.dept, "ferr");
});

test("deduplicador: remove itens repetidos por ID e externalId", () => {
  const lista = [
    { id: "p1", marketplace: "amazon", externalId: "B01", nome: "Item Um" },
    { id: "p1", marketplace: "amazon", externalId: "B01", nome: "Item Um Repetido" },
    { id: "p2", marketplace: "amazon", externalId: "B01", nome: "Item Outro ID mesmo ASIN" },
    { id: "p3", marketplace: "shopee", externalId: "999", nome: "Item Distinto" },
  ];

  const { produtos, totalRemovidos } = deduplicarProdutos(lista);
  assert.equal(produtos.length, 2);
  assert.equal(totalRemovidos, 2);
  assert.equal(produtos[0].id, "p1");
  assert.equal(produtos[1].id, "p3");
});

test("validador: rejeita produtos sem link de afiliado ou com preço zero", () => {
  const invalidoSemLink = {
    id: "shopee-1",
    externalId: "1",
    marketplace: "shopee",
    nome: "Produto Sem Link",
    preco: 50.0,
    imagem: "https://img.com/p.jpg",
    categoria: "casa",
    link: "https://shopee.com.br/product/1/1", // sem tag ou link curto
  };
  assert.equal(validarProduto(invalidoSemLink).valido, false);

  const invalidoPrecoZero = {
    id: "shopee-2",
    externalId: "2",
    marketplace: "shopee",
    nome: "Produto Grátis",
    preco: 0,
    imagem: "https://img.com/p.jpg",
    categoria: "casa",
    link: "https://s.shopee.com.br/short123",
  };
  assert.equal(validarProduto(invalidoPrecoZero).valido, false);

  const valido = {
    id: "shopee-3",
    externalId: "3",
    marketplace: "shopee",
    nome: "Produto Válido",
    preco: 49.9,
    imagem: "https://img.com/p.jpg",
    categoria: "casa",
    link: "https://s.shopee.com.br/short123",
  };
  assert.equal(validarProduto(valido).valido, true);
});

test("ranking: produtos com desconto e comissão ganham maior score", () => {
  const prodComum = { preco: 100, precoAntigo: null, nota: 0, vendidos: 0 };
  const prodTop = { preco: 100, precoAntigo: 200, comissaoPct: 20, nota: 4.8, vendidos: 2000, menor30: true };

  assert.ok(calcularScore(prodTop) > calcularScore(prodComum));
});

test("publicador: preserva produtos da rodada anterior quando um marketplace falha", async () => {
  const dir = await mkdtemp(join(tmpdir(), "citshop-motor-test-"));

  try {
    const publicador = new PublicadorOfertas({ dadosDir: dir, log: { warn: () => {} } });

    // Rodada 1: Ambas lojas têm sucesso
    await publicador.publicar({
      novosColetados: [
        { id: "amazon-1", externalId: "A1", marketplace: "amazon", nome: "Kindle", preco: 400, imagem: "https://img/k.jpg", link: "https://amazon.com.br/dp/A1?tag=citshop-20", categoria: "tec" },
        { id: "shopee-1", externalId: "S1", marketplace: "shopee", nome: "Fone", preco: 50, imagem: "https://img/f.jpg", link: "https://s.shopee.com.br/f1", categoria: "cel" },
      ],
      statusPorLoja: { amazon: { ok: true }, shopee: { ok: true } },
    });

    // Rodada 2: Shopee falha, Amazon traz novo produto
    const res2 = await publicador.publicar({
      novosColetados: [
        { id: "amazon-2", externalId: "A2", marketplace: "amazon", nome: "Echo", preco: 300, imagem: "https://img/e.jpg", link: "https://amazon.com.br/dp/A2?tag=citshop-20", categoria: "tec" },
      ],
      statusPorLoja: { amazon: { ok: true }, shopee: { ok: false, erro: "HTTP 500" } },
    });

    // O produto da Shopee da rodada 1 DEVE ser mantido intacto, e a Amazon atualizada
    assert.equal(res2.porMarketplace.shopee, 1);
    assert.equal(res2.porMarketplace.amazon, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ranking: na Shopee, maior comissão em R$ vem primeiro e a de centavos vai para o fim (sem sumir)", () => {
  const p = (id, comissaoEstimada, extra = {}) => ({ id, loja: "shopee", categoria: "casa", preco: 50, comissaoEstimada, ...extra });
  const lista = [p("centavos", 0.3, { precoAntigo: 100, nota: 4.9, vendidos: 5000, menor30: true }), p("alta", 8), p("media", 2.5), p("sem", null)];
  assert.deepEqual(ranquearOfertas(lista).map((x) => x.id), ["alta", "media", "centavos", "sem"]);
});
