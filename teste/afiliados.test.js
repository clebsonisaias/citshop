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
