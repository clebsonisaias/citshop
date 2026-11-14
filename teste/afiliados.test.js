import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atualizarAfiliados, carrinhoAmazon, deShopee, marcarQuedas } from '../servidor/afiliados.js';

test('monta link de carrinho da Amazon com a tag', () => {
  assert.equal(
    carrinhoAmazon('B0ABC12345', 'garimpo-20'),
    'https://www.amazon.com.br/gp/aws/cart/add.html?ASIN.1=B0ABC12345&Quantity.1=1&AssociateTag=garimpo-20',
  );
});

test('converte oferta da Shopee sem inventar preço antigo', () => {
  const p = deShopee({ itemId: 1, productName: 'Fone', priceMin: '100', priceDiscountRate: 50, ratingStar: '4.7', sales: 10, imageUrl: 'https://img', productLink: 'https://shopee.com.br/product/1/1' }, 'tec');
  assert.deepEqual(
    { id: p.id, preco: p.preco, precoAntigo: p.precoAntigo, nota: p.nota, loja: p.loja },
    { id: 'shopee-1', preco: 100, precoAntigo: null, nota: 4.7, loja: 'shopee' },
  );
});

test('marca queda só quando o preço baixou', () => {
  assert.equal(marcarQuedas([{ id: 'a', preco: 79.9 }], [{ id: 'a', preco: 99.9 }])[0].queda, 20);
  assert.equal(marcarQuedas([{ id: 'a', preco: 100 }], [{ id: 'a', preco: 80 }])[0].queda, undefined);
  assert.equal(marcarQuedas([{ id: 'novo', preco: 10 }], [])[0].queda, undefined);
});

test('grava o link de afiliado gerado e deixa de fora quem não tem link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'afiliados-'));
  const manual = join(dir, 'manual.json');
  writeFileSync(manual, '[]');
  const mutacoes = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.includes('generateShortLink')) {
      mutacoes.push(query);
      if (query.includes('/produto-ruim')) return Response.json({ errors: [{ message: 'sem permissão' }] });
      return Response.json({ data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/abc' } } });
    }
    return Response.json({ data: { productOfferV2: { nodes: [
      { itemId: 1, productName: 'Fone', priceMin: '99.9', priceDiscountRate: 10, ratingStar: '4.5', sales: 3, imageUrl: 'https://img/1', productLink: 'https://shopee.com.br/product/1/1' },
      { itemId: 2, productName: 'Ruim', priceMin: '10', priceDiscountRate: 0, ratingStar: '4', sales: 1, imageUrl: 'https://img/2', productLink: 'https://shopee.com.br/produto-ruim' },
    ] } } });
  };
  try {
    const r = await atualizarAfiliados({ env: { SHOPEE_APP_ID: 'app', SHOPEE_SECRET: 'segredo' }, dadosDir: dir, manual });
    const produtos = JSON.parse(readFileSync(join(dir, 'afiliados.json'), 'utf8')).produtos;
    assert.deepEqual(produtos.map((p) => [p.id, p.link]), [['shopee-1', 'https://s.shopee.com.br/abc']]);
    assert.equal(r.total, 1);
    assert.equal(mutacoes.length, 14); // 7 buscas × 2 produtos
  } finally {
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("robô de afiliados: uma busca da Shopee com erro não derruba as outras; todas com erro mantém a lista anterior", async (t) => {
  const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { atualizarAfiliados } = await import("../servidor/afiliados.js");
  const dir = mkdtempSync(join(tmpdir(), "cit-afil-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manual = join(dir, "manual.json");
  writeFileSync(manual, "[]");
  const env = { SHOPEE_APP_ID: "app", SHOPEE_SECRET: "x" };
  let n = 0;
  const produto = () => ({ id: `shopee-${++n}`, nome: `P${n}`, loja: "shopee", preco: 10, link: "https://s.shopee.com.br/x" });
  const instavel = async (b) => { if (n === 0 && !instavel.falhou) { instavel.falhou = true; throw new Error(`Shopee (${b.termo}): error [10000]: System Error`); } return [produto()]; };
  const r = await atualizarAfiliados({ env, dadosDir: dir, manual, buscar: instavel, espera: 0 });
  assert.equal(r.buscasComFalha, 1);
  assert.ok(r.shopee > 0, "as outras buscas entraram");
  const antes = readFileSync(join(dir, "afiliados.json"), "utf8");
  await assert.rejects(atualizarAfiliados({ env, dadosDir: dir, manual, buscar: async () => { throw new Error("error [10000]: System Error"); }, espera: 0 }), /todas as \d+ buscas/);
  assert.equal(readFileSync(join(dir, "afiliados.json"), "utf8"), antes, "lista anterior preservada");
});

test("robô de afiliados: com o motor de ofertas ativo, não grava por cima da lista do motor", async (t) => {
  const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { atualizarAfiliados } = await import("../servidor/afiliados.js");
  const dir = mkdtempSync(join(tmpdir(), "cit-afil-motor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "manual.json"), "[]");
  writeFileSync(join(dir, "motor-status.json"), JSON.stringify({ ultimaExecucao: new Date().toISOString() }));
  const doMotor = JSON.stringify({ produtos: Array.from({ length: 384 }, (_, i) => ({ id: `shopee-${i}`, loja: "shopee" })) });
  writeFileSync(join(dir, "afiliados.json"), doMotor);
  let chamou = false;
  const r = await atualizarAfiliados({ env: { SHOPEE_APP_ID: "a", SHOPEE_SECRET: "b" }, dadosDir: dir, manual: join(dir, "manual.json"), buscar: async () => { chamou = true; return []; }, espera: 0 });
  assert.equal(r.ignorado, "motor de ofertas ativo");
  assert.equal(chamou, false, "nem gasta chamada na API da Shopee");
  assert.equal(readFileSync(join(dir, "afiliados.json"), "utf8"), doMotor, "lista do motor intacta");
});

test("Amazon: link gravado com a tag antiga sai com o ID de Associado atual", async () => {
  const { comTagAmazon, TAG_AMAZON_PADRAO } = await import("../servidor/afiliados.js");
  assert.equal(TAG_AMAZON_PADRAO, "citshop0e-20");
  assert.equal(comTagAmazon("https://www.amazon.com.br/dp/B01?tag=citshop-20", "citshop0e-20"), "https://www.amazon.com.br/dp/B01?tag=citshop0e-20");
  assert.match(comTagAmazon("https://www.amazon.com.br/gp/aws/cart/add.html?ASIN.1=B01&Quantity.1=1&AssociateTag=citshop-20", "citshop0e-20"), /AssociateTag=citshop0e-20/);
  assert.equal(comTagAmazon("https://www.amazon.com.br/dp/B02", "citshop0e-20"), "https://www.amazon.com.br/dp/B02?tag=citshop0e-20");
  assert.equal(comTagAmazon("https://s.shopee.com.br/x?tag=y", "citshop0e-20"), "https://s.shopee.com.br/x?tag=y", "outras lojas não mudam");
});

test("Amazon: categorias de comissão alta (13%) vêm antes; as outras lojas ficam no lugar", async () => {
  const { ordenarAmazonPorComissao, comissaoAmazonPct } = await import("../servidor/afiliados.js");
  const lista = [
    { id: "tv", loja: "amazon", categoria: "tec", preco: 2000 },
    { id: "s1", loja: "shopee", categoria: "casa", preco: 10 },
    { id: "creme", loja: "amazon", categoria: "beleza", preco: 60 },
    { id: "racao", loja: "amazon", categoria: "pets", preco: 150 },
    { id: "perfume", loja: "amazon", categoria: "beleza", preco: 300 },
  ];
  assert.deepEqual(ordenarAmazonPorComissao(lista).map((p) => p.id), ["perfume", "s1", "creme", "racao", "tv"]);
  assert.deepEqual([comissaoAmazonPct({ categoria: "saude" }), comissaoAmazonPct({ categoria: "calc" })], [13, 7]);
});

test("Mercado Livre: link sai com o matt_tool oficial do painel (70471590) e a etiqueta; link gravado com matt_tool=citshop é corrigido", async () => {
  const { comAtribuicaoML, MATT_TOOL_PADRAO } = await import("../servidor/integracoes/mercado-livre/conector.js");
  assert.equal(MATT_TOOL_PADRAO, "70471590");
  const u = new URL(comAtribuicaoML("https://produto.mercadolivre.com.br/MLB-1-kit-_JM?matt_tool=citshop&matt_word=clebsonisaias138", "clebsonisaias138"));
  assert.deepEqual([u.searchParams.get("matt_tool"), u.searchParams.get("matt_word")], ["70471590", "clebsonisaias138"]);
  assert.equal(comAtribuicaoML("https://s.shopee.com.br/x", "clebsonisaias138"), "https://s.shopee.com.br/x");
  assert.equal(comAtribuicaoML("https://www.mercadolivre.com.br/p/MLB1", undefined), "https://www.mercadolivre.com.br/p/MLB1", "sem etiqueta não inventa atribuição");
});
