// Busca ofertas na API de afiliados da Shopee, junta com manual.json
// (Mercado Livre e Amazon, links colados à mão) e grava produtos.json.
// Uso: SHOPEE_APP_ID=... SHOPEE_SECRET=... node scripts/atualizar.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// O que o robô procura. Troque à vontade; categoria precisa existir no index.html.
const BUSCAS = [
  { termo: 'fone bluetooth', categoria: 'tec' },
  { termo: 'smartwatch', categoria: 'tec' },
  { termo: 'air fryer', categoria: 'cozinha' },
  { termo: 'luminaria led', categoria: 'casa' },
  { termo: 'pincel maquiagem', categoria: 'beleza' },
  { termo: 'controle gamer', categoria: 'games' },
  { termo: 'cama pet', categoria: 'pets' },
];
const POR_BUSCA = 8;
const SHOPEE_API = 'https://open-api.affiliate.shopee.com.br/graphql';
const { SHOPEE_APP_ID, SHOPEE_SECRET, AMAZON_TAG } = process.env;

const SAIDA = new URL('../produtos.json', import.meta.url);
const MANUAL = new URL('../manual.json', import.meta.url);
const centavos = n => Math.round(n * 100) / 100;

export function deShopee(n, categoria) {
  const preco = Number(n.priceMin);
  const desconto = Number(n.priceDiscountRate) || 0;
  return {
    id: `shopee-${n.itemId}`,
    nome: n.productName,
    loja: 'shopee',
    categoria,
    preco,
    precoAntigo: desconto > 0 && desconto < 100 ? centavos(preco / (1 - desconto / 100)) : preco,
    nota: Number(n.ratingStar) || 0,
    vendidos: Number(n.sales) || 0,
    imagem: n.imageUrl,
    link: n.offerLink,
  };
}

// Formulário "Add to Cart" da Amazon: já cai no carrinho com a sua tag de afiliado.
// ML e Shopee não pagam comissão em link de carrinho, então lá vai pro produto.
export function carrinhoAmazon(asin, tag) {
  const q = new URLSearchParams({ 'ASIN.1': asin, 'Quantity.1': '1', AssociateTag: tag });
  return `https://www.amazon.com.br/gp/aws/cart/add.html?${q}`;
}

// Compara com a rodada anterior pra mostrar "caiu R$ X".
export function marcarQuedas(novos, antigos) {
  const antes = new Map(antigos.map(p => [p.id, p.preco]));
  return novos.map(p => {
    const a = antes.get(p.id);
    return a > p.preco ? { ...p, queda: centavos(a - p.preco) } : p;
  });
}

async function buscarShopee({ termo, categoria }) {
  // Campos de productOfferV2; confira os nomes na documentação do painel de afiliados da Shopee.
  const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, sortType: 2, page: 1, limit: ${POR_BUSCA}) {
    nodes { itemId productName priceMin priceDiscountRate ratingStar sales imageUrl offerLink } } }`;
  const body = JSON.stringify({ query });
  const ts = Math.floor(Date.now() / 1000);
  const assinatura = createHash('sha256').update(`${SHOPEE_APP_ID}${ts}${body}${SHOPEE_SECRET}`).digest('hex');
  const r = await fetch(SHOPEE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${ts}, Signature=${assinatura}` },
    body,
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(`Shopee (${termo}): ${j.errors[0].message}`);
  return j.data.productOfferV2.nodes.map(n => deShopee(n, categoria));
}

async function main() {
  const manual = JSON.parse(await readFile(MANUAL, 'utf8'))
    .map(p => p.loja === 'amazon' && p.asin && AMAZON_TAG ? { ...p, link: carrinhoAmazon(p.asin, AMAZON_TAG) } : p);
  let antigos = [];
  try { antigos = JSON.parse(await readFile(SAIDA, 'utf8')).produtos; } catch { /* primeira rodada */ }

  const shopee = [];
  if (SHOPEE_APP_ID && SHOPEE_SECRET) {
    for (const b of BUSCAS) shopee.push(...await buscarShopee(b));
  } else {
    console.warn('Sem SHOPEE_APP_ID/SHOPEE_SECRET: usando só manual.json');
  }

  const vistos = new Set();
  const produtos = marcarQuedas([...shopee, ...manual], antigos)
    .filter(p => !vistos.has(p.id) && vistos.add(p.id));
  await writeFile(SAIDA, JSON.stringify({ atualizadoEm: new Date().toISOString(), produtos }, null, 2) + '\n');
  console.log(`${produtos.length} produtos (${shopee.length} da Shopee, ${manual.length} manuais)`);
}

// Se a Shopee falhar, sai com erro e o produtos.json antigo continua no ar.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
