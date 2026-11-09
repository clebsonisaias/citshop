import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comTag, criarClienteAmazon, deAmazon, produtosAmazon } from '../servidor/amazon.js';

// Fetch falso: a função `resposta(url, init)` devolve { status, corpo }.
function fetchFalso(resposta) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init, corpo: init?.body ? JSON.parse(init.body) : null });
    const r = resposta(url, init);
    return Response.json(r.corpo ?? {}, { status: r.status ?? 200 });
  };
  f.chamadas = chamadas;
  return f;
}

const TOKEN = { access_token: 'tok', expires_in: 3600 };
const cliente = (fetchImpl) => criarClienteAmazon({
  credencialId: 'id', credencialSegredo: 'segredo', versao: '3.1', parceiro: 'citshop-20', fetchImpl,
});

test('comTag garante a tag sem perder os outros parâmetros e recusa outros domínios', () => {
  assert.equal(comTag('https://www.amazon.com.br/dp/B0H3Q1RHD7', 'citshop-20'), 'https://www.amazon.com.br/dp/B0H3Q1RHD7?tag=citshop-20');
  assert.equal(comTag('https://www.amazon.com.br/x?ref=a&tag=outra-20', 'citshop-20'), 'https://www.amazon.com.br/x?ref=a&tag=outra-20');
  assert.equal(comTag('https://evil.example/dp/B0H3Q1RHD7', 'citshop-20'), null);
});

test('deAmazon não inventa preço: sem oferta, o produto some', () => {
  assert.equal(deAmazon({ asin: 'B0AAAAAAAA', itemInfo: { title: { displayValue: 'X' } }, detailPageURL: 'https://www.amazon.com.br/dp/B0AAAAAAAA' }, 'tec', 'citshop-20', 'agora'), null);
});

test('deAmazon usa o preço de lista só quando a própria API informa', () => {
  const base = { asin: 'B0H3Q1RHD7', itemInfo: { title: { displayValue: 'TV' } }, detailPageURL: 'https://www.amazon.com.br/dp/B0H3Q1RHD7', images: { primary: { large: { url: 'https://img/1.jpg' } } } };
  const comLista = deAmazon({ ...base, offersV2: { listings: [{ price: { money: { amount: 3254.07 } }, savingBasis: { money: { amount: 3999 } }, availability: { type: 'IN_STOCK' } }] } }, 'tec', 'citshop-20', 'agora');
  assert.equal(comLista.preco, 3254.07);
  assert.equal(comLista.precoAntigo, 3999);
  assert.equal(comLista.link, 'https://www.amazon.com.br/dp/B0H3Q1RHD7?tag=citshop-20');
  const semLista = deAmazon({ ...base, offersV2: { listings: [{ price: { money: { amount: 100 } } }] } }, 'tec', 'citshop-20', 'agora');
  assert.equal(semLista.precoAntigo, null);
  assert.equal(semLista.descricao, '');
  const comDestaques = deAmazon({ ...base, itemInfo: { title: { displayValue: 'TV' }, features: { displayValues: ['4K QLED', 'Wi-Fi e Bluetooth'] } }, offersV2: { listings: [{ price: { money: { amount: 100 } } }] } }, 'tec', 'citshop-20', 'agora');
  assert.equal(comDestaques.descricao, '4K QLED · Wi-Fi e Bluetooth');
});

test('o token é reaproveitado e getItems vai em lotes de 10 com marketplace e tag', async () => {
  const f = fetchFalso((url) => (url.includes('/auth/') ? { corpo: TOKEN } : { corpo: { itemResults: { items: [] } } }));
  const asins = Array.from({ length: 11 }, (_, i) => `B0000000${i}`);
  await cliente(f).buscarAsins(asins);
  const tokens = f.chamadas.filter((x) => x.url.includes('/auth/'));
  const itens = f.chamadas.filter((x) => x.url.includes('/getItems'));
  assert.equal(tokens.length, 1);
  assert.equal(itens.length, 2);
  assert.equal(itens[0].corpo.itemIds.length, 10);
  assert.equal(itens[1].corpo.itemIds.length, 1);
  assert.equal(itens[0].corpo.marketplace, 'www.amazon.com.br');
  assert.equal(itens[0].corpo.partnerTag, 'citshop-20');
  assert.equal(itens[0].init.headers['x-marketplace'], 'www.amazon.com.br');
  assert.equal(itens[0].init.headers.Authorization, 'Bearer tok');
});

test('erros da Amazon viram mensagens claras, sem vazar a resposta crua', async () => {
  const f429 = fetchFalso((url) => (url.includes('/auth/') ? { corpo: TOKEN } : { status: 429, corpo: { secreto: 'x' } }));
  await assert.rejects(cliente(f429).buscarPalavra('fone'), (e) => /Limite de requisições/.test(e.message) && !/secreto/.test(e.message));
  const f403 = fetchFalso((url) => (url.includes('/auth/') ? { corpo: TOKEN } : { status: 403 }));
  await assert.rejects(cliente(f403).buscarPalavra('fone'), /não tem acesso à Creators API/);
  const fToken = fetchFalso(() => ({ status: 400, corpo: { error: 'invalid_client' } }));
  await assert.rejects(cliente(fToken).buscarPalavra('fone'), /Credenciais recusadas/);
});

test('uma busca que falha não derruba as outras; o erro fica registrado', async () => {
  const f = fetchFalso((url, init) => {
    if (url.includes('/auth/')) return { corpo: TOKEN };
    const corpo = JSON.parse(init.body);
    if (corpo.keywords === 'air fryer') return { status: 403 };
    return { corpo: { searchResult: { items: [{ asin: 'B0000000A', itemInfo: { title: { displayValue: 'Item' } }, detailPageURL: 'https://www.amazon.com.br/dp/B0000000A', offersV2: { listings: [{ price: { money: { amount: 50 } } }] } }] } } };
  });
  const { produtos, erros } = await produtosAmazon({ cliente: cliente(f), agora: () => Date.parse('2026-11-08T12:00:00Z') });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /air fryer/);
  assert.ok(produtos.length >= 1);
  assert.equal(produtos[0].atualizadoEm, '2026-11-08T12:00:00.000Z');
});
