/**
 * Amazon Associates (marketplace brasileiro) pela Creators API oficial.
 * Módulo independente da Shopee. Credenciais vêm do ambiente, nunca do frontend.
 * Sem scraping. Nomes de recursos e o endpoint foram lidos na documentação; confirmar com a conta real.
 * Variáveis de ambiente e como obter as credenciais: docs/amazon.md.
 */

export const MARKETPLACE = "www.amazon.com.br";
const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_PADRAO = "https://creatorsapi.amazon";
const RECURSOS = [
  "itemInfo.title", "itemInfo.features", "images.primary.large",
  "offersV2.listings.price", "offersV2.listings.availability", "offersV2.listings.savingBasis",
];

// Buscas do robô. Cada categoria precisa existir em DEPTS (dados.js).
export const BUSCAS_AMAZON = [
  { termo: "fone bluetooth", categoria: "cel" },
  { termo: "air fryer", categoria: "cozinha" },
  { termo: "smartwatch", categoria: "tec" },
];

export class ErroAmazon extends Error {
  constructor(mensagem) { super(mensagem); this.name = "ErroAmazon"; }
}

function erroPorStatus(status) {
  if (status === 429) return new ErroAmazon("Limite de requisições da Amazon atingido. Tente de novo em alguns minutos.");
  if (status === 403) return new ErroAmazon("A conta não tem acesso à Creators API: confira as credenciais e as vendas qualificadas.");
  if (status === 401) return new ErroAmazon("Credenciais recusadas pela Amazon.");
  return new ErroAmazon(`A Amazon respondeu com erro (${status}).`);
}

/** Garante o identificador de afiliado no link. Mantém os outros parâmetros e recusa domínios que não são da Amazon. */
export function comTag(url, tag) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname.endsWith("amazon.com.br")) return null;
    if (!u.searchParams.get("tag")) u.searchParams.set("tag", tag);
    return u.toString();
  } catch {
    return null;
  }
}

/** Converte um item da Amazon no formato do catálogo. Sem preço, sem produto: nada é inventado. */
export function deAmazon(item, categoria, tag, atualizadoEm) {
  const oferta = item.offersV2?.listings?.[0];
  const preco = Number(oferta?.price?.money?.amount);
  const nome = item.itemInfo?.title?.displayValue;
  const link = comTag(item.detailPageURL, tag);
  if (!(preco > 0) || !nome || !link) return null;
  const antigo = Number(oferta.savingBasis?.money?.amount);
  return {
    id: `amazon-${item.asin}`,
    asin: item.asin,
    nome,
    loja: "amazon",
    categoria,
    preco,
    precoAntigo: antigo > preco ? antigo : null,
    imagem: item.images?.primary?.large?.url ?? null,
    disponibilidade: oferta.availability?.type ?? null,
    link,
    atualizadoEm,
  };
}

/**
 * Cliente da Creators API. Cacheia o token até perto de expirar.
 * `versao` é a versão da credencial (3.1 NA, 3.2 EU, 3.3 FE); confirmar qual vale para o Brasil.
 */
export function criarClienteAmazon({ credencialId, credencialSegredo, versao, parceiro, base = API_PADRAO, fetchImpl = fetch, agora = Date.now }) {
  let token = null, expira = 0;

  async function obterToken() {
    if (token && agora() < expira) return token;
    const r = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: credencialId, client_secret: credencialSegredo, scope: "creatorsapi::default" }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    // OAuth2 devolve 400 invalid_client para credencial errada; só o 429 é limite.
    if (!r.ok || !j.access_token) throw erroPorStatus(r.status === 429 ? 429 : 401);
    token = j.access_token;
    expira = agora() + (Number(j.expires_in) - 120) * 1000;
    return token;
  }

  async function chamar(operacao, corpo) {
    const r = await fetchImpl(`${base}/catalog/v1/${operacao}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await obterToken()}`, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
      body: JSON.stringify({ ...corpo, marketplace: MARKETPLACE, partnerTag: parceiro, resources: RECURSOS }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw erroPorStatus(r.status);
    if (j.errors?.length) throw new ErroAmazon(`Amazon: ${j.errors[0].message ?? j.errors[0].code ?? "erro"}`);
    return j;
  }

  return {
    versao,
    parceiro,
    /** Até 10 ASIN por chamada (um lote conta como uma transação na cota). */
    async buscarAsins(asins) {
      const itens = [];
      for (let i = 0; i < asins.length; i += 10) {
        const j = await chamar("getItems", { itemIds: asins.slice(i, i + 10), itemIdType: "ASIN" });
        itens.push(...(j.itemResults?.items ?? []));
      }
      return itens;
    },
    async buscarPalavra(palavras, quantidade = 10) {
      const j = await chamar("searchItems", { keywords: palavras, itemCount: quantidade });
      return j.searchResult?.items ?? [];
    },
  };
}

/**
 * Uma rodada completa: busca por palavra e ASIN da lista. Devolve { produtos, erros } com os produtos já
 * no formato do catálogo. Falha de uma busca não derruba as outras, mas fica registrada em `erros`.
 */
export async function produtosAmazon({ cliente, asins = [], agora = Date.now }) {
  const atualizadoEm = new Date(agora()).toISOString();
  const achados = [], erros = [];
  for (const { termo, categoria } of BUSCAS_AMAZON) {
    try {
      for (const item of await cliente.buscarPalavra(termo)) achados.push(deAmazon(item, categoria, cliente.parceiro, atualizadoEm));
    } catch (e) { erros.push(`busca "${termo}": ${e.message}`); }
  }
  if (asins.length) {
    try {
      for (const item of await cliente.buscarAsins(asins)) achados.push(deAmazon(item, "tec", cliente.parceiro, atualizadoEm));
    } catch (e) { erros.push(`ASIN: ${e.message}`); }
  }
  return { produtos: achados.filter(Boolean), erros };
}
