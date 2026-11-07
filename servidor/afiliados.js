/**
 * Robô de afiliados: busca ofertas na API da Shopee, junta com manual.json
 * (Amazon e Mercado Livre, colados à mão) e grava afiliados.json no volume.
 * Roda dentro do servidor (ver servidor.js), na subida e a cada 8 horas.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// O que o robô procura na Shopee. A categoria precisa existir em DEPTS (dados.js).
const BUSCAS = [
  { termo: "fone bluetooth", categoria: "cel" },
  { termo: "smartwatch", categoria: "tec" },
  { termo: "air fryer", categoria: "cozinha" },
  { termo: "luminaria led", categoria: "casa" },
  { termo: "pincel maquiagem", categoria: "beleza" },
  { termo: "controle gamer", categoria: "tec" },
  { termo: "cama pet", categoria: "pets" },
];
const POR_BUSCA = 8;
const SHOPEE_API = "https://open-api.affiliate.shopee.com.br/graphql";
const centavos = (n) => Math.round(n * 100) / 100;

export function deShopee(n, categoria) {
  const preco = Number(n.priceMin);
  const desconto = Number(n.priceDiscountRate) || 0;
  return {
    id: `shopee-${n.itemId}`,
    nome: n.productName,
    loja: "shopee",
    categoria,
    preco,
    precoAntigo: desconto > 0 && desconto < 100 ? centavos(preco / (1 - desconto / 100)) : preco,
    nota: Number(n.ratingStar) || 0,
    vendidos: Number(n.sales) || 0,
    imagem: n.imageUrl,
    link: n.offerLink,
  };
}

// Formulário "Add to Cart" da Amazon: cai direto no carrinho com a tag de afiliado.
// Mercado Livre e Shopee não pagam comissão em link de carrinho; lá vai pro produto.
export function carrinhoAmazon(asin, tag) {
  const q = new URLSearchParams({ "ASIN.1": asin, "Quantity.1": "1", AssociateTag: tag });
  return `https://www.amazon.com.br/gp/aws/cart/add.html?${q}`;
}

/** Compara com a rodada anterior para mostrar "caiu R$ X". */
export function marcarQuedas(novos, antigos) {
  const antes = new Map(antigos.map((p) => [p.id, p.preco]));
  return novos.map((p) => {
    const a = antes.get(p.id);
    return a > p.preco ? { ...p, queda: centavos(a - p.preco) } : p;
  });
}

async function buscarShopee({ termo, categoria }, { appId, segredo }) {
  // Campos de productOfferV2; confira os nomes na documentação do painel de afiliados da Shopee.
  const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, sortType: 2, page: 1, limit: ${POR_BUSCA}) {
    nodes { itemId productName priceMin priceDiscountRate ratingStar sales imageUrl offerLink } } }`;
  const body = JSON.stringify({ query });
  const ts = Math.floor(Date.now() / 1000);
  const assinatura = createHash("sha256").update(`${appId}${ts}${body}${segredo}`).digest("hex");
  const r = await fetch(SHOPEE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${assinatura}` },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(`Shopee (${termo}): ${j.errors[0].message}`);
  return j.data.productOfferV2.nodes.map((n) => deShopee(n, categoria));
}

/** Uma rodada completa. Se a Shopee falhar, lança e o afiliados.json anterior continua valendo. */
export async function atualizarAfiliados({ env, dadosDir, manual }) {
  const saida = join(dadosDir, "afiliados.json");
  const lista = JSON.parse(await readFile(manual, "utf8"))
    .map((p) => (p.loja === "amazon" && p.asin && env.AMAZON_TAG ? { ...p, link: carrinhoAmazon(p.asin, env.AMAZON_TAG) } : p));
  let antigos = [];
  try { antigos = JSON.parse(await readFile(saida, "utf8")).produtos; } catch { /* primeira rodada */ }

  const shopee = [];
  if (env.SHOPEE_APP_ID && env.SHOPEE_SECRET) {
    for (const b of BUSCAS) shopee.push(...await buscarShopee(b, { appId: env.SHOPEE_APP_ID, segredo: env.SHOPEE_SECRET }));
  }
  const vistos = new Set();
  const produtos = marcarQuedas([...shopee, ...lista], antigos).filter((p) => !vistos.has(p.id) && vistos.add(p.id));
  await writeFile(saida, JSON.stringify({ atualizadoEm: new Date().toISOString(), produtos }));
  return { total: produtos.length, shopee: shopee.length, manuais: lista.length };
}
