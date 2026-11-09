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
