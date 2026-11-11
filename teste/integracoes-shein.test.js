import test from "node:test";
import assert from "node:assert/strict";
import { ConectorShein, ProvedorLinkShein, deShein } from "../servidor/integracoes/shein/conector.js";
import { validarLinkAfiliado, validarProduto } from "../servidor/motor-ofertas/validador.js";

test("ProvedorLinkShein: valida links oficiais de afiliados da SHEIN", () => {
  const provedor = new ProvedorLinkShein({ affiliateId: "1626555752" });
  assert.equal(provedor.validarLinkAfiliado("https://shein.top/abc1234"), true);
  assert.equal(provedor.validarLinkAfiliado("https://br.shein.com/Vestido-p-12345.html?aff_id=1626555752&url_from=affiliate"), true);
  assert.equal(provedor.validarLinkAfiliado("https://m.shein.com/br/product-123.html?ref=shein_affiliate"), true);
  assert.equal(provedor.validarLinkAfiliado("https://br.shein.com/Vestido-p-12345.html"), false);
});

test("ProvedorLinkShein: gera link de afiliado atribuído com aff_id", async () => {
  const provedor = new ProvedorLinkShein({ affiliateId: "1626555752" });
  const gerado = await provedor.gerarLinkAfiliado({
    urlOriginal: "https://br.shein.com/Camisa-Oversized-p-998877.html",
    subId: "citshop",
  });
  assert.ok(gerado.includes("aff_id=1626555752"));
  assert.ok(gerado.includes("url_from=affiliate"));
  assert.ok(gerado.includes("sub_id=citshop"));
  assert.equal(provedor.validarLinkAfiliado(gerado), true);
});

test("deShein: normaliza produto da SHEIN corretamente para o CITshop", () => {
  const item = {
    goodsId: "98765432",
    title: "Vestido Midi Canelado Feminino Básico",
    price: "49.90",
    retailPrice: "79.90",
    imageUrl: "https://img.ltwebstatic.com/vestido.jpg",
    commissionRate: 18,
    commission: 8.98,
  };

  const link = "https://br.shein.com/vestido-p-98765432.html?aff_id=1626555752&url_from=affiliate";
  const norm = deShein(item, "moda", link);

  assert.equal(norm.id, "shein-98765432");
  assert.equal(norm.marketplace, "shein");
  assert.equal(norm.loja, "shein");
  assert.equal(norm.preco, 49.9);
  assert.equal(norm.precoAntigo, 79.9);
  assert.equal(norm.link, link);
  assert.equal(norm.comissaoPct, 18);
});

test("ValidadorMotor: rejeita produto SHEIN sem link atribuído e aprova com link oficial", () => {
  assert.equal(validarLinkAfiliado("https://br.shein.com/vestido-p-1.html", "shein"), false);
  assert.equal(validarLinkAfiliado("https://br.shein.com/vestido-p-1.html?aff_id=1626555752", "shein"), true);
  assert.equal(validarLinkAfiliado("https://shein.top/v8y321", "shein"), true);

  const produtoInvalido = {
    id: "shein-1",
    externalId: "1",
    loja: "shein",
    marketplace: "shein",
    nome: "Bolsa Transversal",
    categoria: "moda",
    preco: 39.9,
    imagem: "https://img.ltwebstatic.com/bolsa.jpg",
    link: "https://br.shein.com/bolsa-1.html",
  };
  assert.equal(validarProduto(produtoInvalido).valido, false);

  const produtoValido = {
    ...produtoInvalido,
    link: "https://br.shein.com/bolsa-1.html?aff_id=1626555752&url_from=affiliate",
  };
  assert.equal(validarProduto(produtoValido).valido, true);
});
