import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deShopee, marcarQuedas, carrinhoAmazon } from './atualizar.mjs';

test('monta link de carrinho da Amazon com a tag', () => {
  assert.equal(
    carrinhoAmazon('B0ABC12345', 'garimpo-20'),
    'https://www.amazon.com.br/gp/aws/cart/add.html?ASIN.1=B0ABC12345&Quantity.1=1&AssociateTag=garimpo-20',
  );
});

test('converte oferta da Shopee e calcula preço antigo', () => {
  const p = deShopee({ itemId: 1, productName: 'Fone', priceMin: '100', priceDiscountRate: 50, ratingStar: '4.7', sales: 10, imageUrl: 'https://img', offerLink: 'https://s.shopee.com.br/x' }, 'tec');
  assert.deepEqual(
    { id: p.id, preco: p.preco, precoAntigo: p.precoAntigo, nota: p.nota, loja: p.loja },
    { id: 'shopee-1', preco: 100, precoAntigo: 200, nota: 4.7, loja: 'shopee' },
  );
  assert.equal(deShopee({ itemId: 2, priceMin: '50', priceDiscountRate: 0 }, 'tec').precoAntigo, 50);
});

test('marca queda só quando o preço baixou', () => {
  assert.equal(marcarQuedas([{ id: 'a', preco: 79.9 }], [{ id: 'a', preco: 99.9 }])[0].queda, 20);
  assert.equal(marcarQuedas([{ id: 'a', preco: 100 }], [{ id: 'a', preco: 80 }])[0].queda, undefined);
  assert.equal(marcarQuedas([{ id: 'novo', preco: 10 }], [])[0].queda, undefined);
});
