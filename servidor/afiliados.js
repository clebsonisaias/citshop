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
/** ID de Associado da Amazon (conta nova). AMAZON_TAG no Coolify, quando definida, vale por cima. */
export const TAG_AMAZON_PADRAO = "citshop0e-20";
// Comissão da Amazon Brasil por departamento da vitrine (regulamento de comissões padrão do Programa de Associados).
const COMISSAO_AMAZON = {
  beleza: 13, saude: 13, bebe: 13, mercado: 13, moda: 11, pets: 11, livros: 10,
  tec: 8, cel: 8, info: 8, games: 8, eletro: 8, cozinha: 8, casa: 8, cama: 8, moveis: 8, jardim: 8, ferr: 8,
  brinq: 8, esporte: 8, camping: 8, papel: 8, musica: 8,
}; // calçados (calc), automotivo e o resto: 7%
export const comissaoAmazonPct = (p) => COMISSAO_AMAZON[p.categoria ?? p.dept] ?? 7;
/** Amazon: maior % da categoria primeiro; no empate, quem rende mais R$ por venda. Ordem entre si, sem mexer no resto. */
export function ordenarAmazonPorComissao(lista) {
  const amz = lista.filter((p) => p.loja === "amazon")
    .sort((a, b) => comissaoAmazonPct(b) - comissaoAmazonPct(a) || comissaoAmazonPct(b) * b.preco - comissaoAmazonPct(a) * a.preco);
  let i = 0;
  return lista.map((p) => (p.loja === "amazon" ? amz[i++] : p));
}

/** Troca a tag de associado de um link da Amazon (tag= ou AssociateTag=) pela atual; outros links passam iguais. */
export function comTagAmazon(link, tag) {
  try {
    const u = new URL(link);
    if (!tag || !/(^|\.)amazon\.com\.br$/.test(u.hostname)) return link;
    u.searchParams.set(u.searchParams.has("AssociateTag") ? "AssociateTag" : "tag", tag);
    return u.toString();
  } catch { return link; }
}

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
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const ts = Math.floor(Date.now() / 1000);
    const assinatura = createHash("sha256").update(`${appId}${ts}${body}${segredo}`).digest("hex");
    try {
      const r = await fetch(SHOPEE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${assinatura}` },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const j = await r.json().catch(() => ({}));
      if (j.errors?.length) {
        if (tentativa < 3 && /10000|system error/i.test(j.errors[0].message)) {
          await new Promise((res) => setTimeout(res, 1000 * tentativa));
          continue;
        }
        throw new Error(j.errors[0].message);
      }
      return j.data;
    } catch (e) {
      if (tentativa < 3 && /10000|system error/i.test(e.message)) {
        await new Promise((res) => setTimeout(res, 1000 * tentativa));
        continue;
      }
      throw e;
    }
  }
}

// productLink é só a página do produto: sem este link gerado, a compra não rende comissão.
async function linkDeAfiliado(url, credenciais) {
  const data = await chamarShopee(`mutation { generateShortLink(input: { originUrl: ${JSON.stringify(url)} }) { shortLink } }`, credenciais);
  return data.generateShortLink.shortLink;
}

async function buscarShopee({ termo, categoria }, credenciais) {
  // Campos de productOfferV2 conforme o perfil oficial BR (jeffmonteiroo/shopee-br-affiliate-mcp).
  const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, page: 1, limit: ${POR_BUSCA}) {
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
      await new Promise((r) => setTimeout(r, 200));
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
export async function atualizarAfiliados({ env, dadosDir, manual, buscar = buscarShopee, espera = 400 }) {
  const saida = join(dadosDir, "afiliados.json");
  // O motor de ofertas (servidor/motor-ofertas, central de automação) é quem publica afiliados.json: valida, remove
  // duplicados e ranqueia. Com ele ativo (motor-status.json existe), este robô antigo NÃO grava por cima — senão a
  // vitrine perde as ofertas do motor (aconteceu em 12/11: 384 ofertas da Shopee viraram 33).
  try { await readFile(join(dadosDir, "motor-status.json"), "utf8"); return { ignorado: "motor de ofertas ativo", total: 0, shopee: 0, manuais: 0, coleta: 0, buscasComFalha: 0 }; } catch { /* sem motor: segue */ }
  const lista = JSON.parse(await readFile(manual, "utf8"))
    .map((p) => (p.loja === "amazon" && p.asin && env.AMAZON_TAG ? { ...p, link: carrinhoAmazon(p.asin, env.AMAZON_TAG) } : p));
  let antigos = [];
  try { antigos = JSON.parse(await readFile(saida, "utf8")).produtos; } catch { /* primeira rodada */ }

  // Uma busca que falha (ex.: "error [10000]: System Error", instabilidade da API da Shopee) não derruba as outras:
  // fica registrada e a rodada segue. Só é falha da tarefa quando TODAS as buscas falham (API fora ou credencial errada).
  const shopee = [], falhas = [];
  if (env.SHOPEE_APP_ID && env.SHOPEE_SECRET) {
    for (const b of BUSCAS) {
      await new Promise((r) => setTimeout(r, espera));
      try { shopee.push(...await buscar(b, { appId: env.SHOPEE_APP_ID, segredo: env.SHOPEE_SECRET })); } catch (e) { falhas.push(e.message); }
    }
    if (falhas.length === BUSCAS.length) throw new Error(`todas as ${BUSCAS.length} buscas da Shopee falharam; mantendo a lista anterior. Ex.: ${falhas[0]}`);
    if (falhas.length) console.warn(`[afiliados] ${falhas.length} de ${BUSCAS.length} buscas da Shopee falharam: ${falhas.slice(0, 3).join(" | ")}`);
  }
  // Ofertas mandadas pelo robô de coleta (POST /api/robo/afiliados). Valem mais que o manual.json.
  let coleta = [];
  try { coleta = JSON.parse(await readFile(join(dadosDir, "coleta.json"), "utf8")).produtos ?? []; } catch { /* sem coleta ainda */ }
  coleta = coleta.map((p) => (p.loja === "amazon" && p.asin && env.AMAZON_TAG ? { ...p, link: carrinhoAmazon(p.asin, env.AMAZON_TAG) } : p));
  const vistos = new Set();
  const produtos = marcarQuedas([...shopee, ...coleta, ...lista], antigos).filter((p) => !vistos.has(p.id) && vistos.add(p.id));
  await writeFile(saida, JSON.stringify({ atualizadoEm: new Date().toISOString(), produtos }));
  return { total: produtos.length, shopee: shopee.length, manuais: lista.length, coleta: coleta.length, buscasComFalha: falhas.length };
}
