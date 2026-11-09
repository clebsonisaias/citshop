/**
 * Robô de afiliados: busca ofertas na API da Shopee, junta com manual.json
 * (Amazon e Mercado Livre, colados à mão) e grava afiliados.json no volume.
 * Roda dentro do servidor (ver servidor.js), na subida e a cada 8 horas.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { criarClienteAmazon, produtosAmazon } from "./amazon.js";

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

// Sem precoAntigo: a Shopee informa só o percentual, e um "de" calculado a partir dele pode enganar.
export function deShopee(n, categoria) {
  return {
    id: `shopee-${n.itemId}`,
    nome: n.productName,
    loja: "shopee",
    categoria,
    preco: Number(n.priceMin),
    precoAntigo: null,
    nota: Number(n.ratingStar) || 0,
    vendidos: Number(n.sales) || 0,
    imagem: n.imageUrl,
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

async function chamarShopee(query, { appId, segredo }) {
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
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// productLink é só a página do produto: sem este link gerado, a compra não rende comissão.
async function linkDeAfiliado(url, credenciais) {
  const data = await chamarShopee(`mutation { generateShortLink(input: { originUrl: ${JSON.stringify(url)} }) { shortLink } }`, credenciais);
  return data.generateShortLink.shortLink;
}

async function buscarShopee({ termo, categoria }, credenciais) {
  // Campos de productOfferV2 conforme o perfil oficial BR (jeffmonteiroo/shopee-br-affiliate-mcp).
  const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, sortType: 2, page: 1, limit: ${POR_BUSCA}) {
    nodes { itemId productName priceMin priceDiscountRate ratingStar sales imageUrl productLink } } }`;
  let nos;
  try {
    nos = (await chamarShopee(query, credenciais)).productOfferV2.nodes;
  } catch (e) {
    throw new Error(`Shopee (${termo}): ${e.message}`);
  }
  const produtos = [];
  for (const n of nos) {
    try {
      produtos.push({ ...deShopee(n, categoria), link: await linkDeAfiliado(n.productLink, credenciais) });
    } catch (e) {
      console.warn(`[afiliados] produto ${n.itemId} ficou de fora, sem link de afiliado: ${e.message}`);
    }
  }
  return produtos;
}

/**
 * Amazon pela Creators API, separada do robô da Shopee: a API só permite guardar oferta por 1 hora,
 * então roda a cada 50 minutos (servidor.js) e grava amazon.json. O resultado ou o erro vai para
 * amazon-status.json, que o admin mostra. Sem credenciais, não faz nada e devolve null.
 */
export async function atualizarAmazon({ env, dadosDir, manual }) {
  if (!env.AMAZON_CREDENCIAL_ID || !env.AMAZON_CREDENCIAL_SEGREDO || !env.AMAZON_PARTNER_TAG) return null;
  const status = { ultimaTentativa: new Date().toISOString(), ok: false, erro: null, total: 0 };
  try {
    const cliente = criarClienteAmazon({
      credencialId: env.AMAZON_CREDENCIAL_ID,
      credencialSegredo: env.AMAZON_CREDENCIAL_SEGREDO,
      versao: env.AMAZON_CREDENCIAL_VERSAO ?? "3.1",
      parceiro: env.AMAZON_PARTNER_TAG,
    });
    const asins = JSON.parse(await readFile(manual, "utf8")).filter((p) => p.loja === "amazon" && p.asin).map((p) => p.asin);
    const { produtos, erros } = await produtosAmazon({ cliente, asins });
    status.ok = erros.length === 0;
    status.erro = erros[0] ?? null;
    status.total = produtos.length;
    // Rodada vazia não apaga a anterior; a vitrine descarta sozinha o que passar de 1 hora.
    if (produtos.length) await writeFile(join(dadosDir, "amazon.json"), JSON.stringify({ atualizadoEm: status.ultimaTentativa, produtos }));
  } catch (e) {
    status.erro = e.message;
  }
  await writeFile(join(dadosDir, "amazon-status.json"), JSON.stringify(status));
  return status;
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
