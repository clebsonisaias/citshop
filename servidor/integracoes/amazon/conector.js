/**
 * Conector oficial da Amazon Brasil via Creators API.
 * Suporta OAuth 2.0, busca de itens, consulta de ASINs e garantia de Partner Tag.
 */
import { ConectorMarketplace, ErroConector, executarComRetry } from "../base.js";

export const MARKETPLACE_AMAZON = "www.amazon.com.br";
const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_PADRAO = "https://creatorsapi.amazon";
const RECURSOS = [
  "itemInfo.title",
  "itemInfo.features",
  "images.primary.large",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.savingBasis",
];

export const BUSCAS_PADRAO_AMAZON = [
  { termo: "fone bluetooth", categoria: "cel" },
  { termo: "air fryer", categoria: "cozinha" },
  { termo: "smartwatch", categoria: "tec" },
];

export function comTag(url, tag) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname.endsWith("amazon.com.br")) return null;
    if (!u.searchParams.get("tag") && tag) u.searchParams.set("tag", tag);
    return u.toString();
  } catch {
    return null;
  }
}

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
    externalId: item.asin,
    marketplace: "amazon",
    loja: "amazon",
    nome,
    descricao: (item.itemInfo?.features?.displayValues ?? []).join(" · ").slice(0, 1000),
    categoria,
    preco,
    precoAntigo: antigo > preco ? antigo : null,
    imagem: item.images?.primary?.large?.url ?? null,
    disponibilidade: oferta.availability?.type ?? null,
    link,
    atualizadoEm: atualizadoEm || new Date().toISOString(),
  };
}

export class ConectorAmazon extends ConectorMarketplace {
  constructor({
    credencialId = process.env.AMAZON_CREDENCIAL_ID,
    credencialSegredo = process.env.AMAZON_CREDENCIAL_SEGREDO,
    versao = process.env.AMAZON_CREDENCIAL_VERSAO || "3.1",
    parceiro = process.env.AMAZON_PARTNER_TAG || process.env.AMAZON_TAG || "citshop-20",
    base = API_PADRAO,
    fetchImpl = fetch,
    agora = Date.now,
  } = {}) {
    super("amazon");
    this.credencialId = credencialId;
    this.credencialSegredo = credencialSegredo;
    this.versao = versao;
    this.parceiro = parceiro;
    this.base = base;
    this.fetchImpl = fetchImpl;
    this.agora = agora;
    this.token = null;
    this.expira = 0;
  }

  estaConfigurado() {
    return Boolean(this.credencialId && this.credencialSegredo && this.parceiro);
  }

  async obterToken() {
    if (this.token && this.agora() < this.expira) return this.token;

    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.credencialId,
        client_secret: this.credencialSegredo,
        scope: "creatorsapi::default",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      const status = res.status === 429 ? 429 : 401;
      throw new ErroConector("amazon", status === 429 ? "Limite de requisições da Amazon atingido." : "Credenciais recusadas pela Amazon.", status);
    }

    this.token = json.access_token;
    this.expira = this.agora() + (Number(json.expires_in) - 120) * 1000;
    return this.token;
  }

  async chamarApi(operacao, corpo) {
    const token = await this.obterToken();
    const res = await this.fetchImpl(`${this.base}/catalog/v1/${operacao}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-marketplace": MARKETPLACE_AMAZON,
      },
      body: JSON.stringify({
        ...corpo,
        marketplace: MARKETPLACE_AMAZON,
        partnerTag: this.parceiro,
        resources: RECURSOS,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) throw new ErroConector("amazon", "Limite de requisições atingido.", 429);
      if (res.status === 403) throw new ErroConector("amazon", "Conta sem permissão na Creators API.", 403);
      if (res.status === 401) throw new ErroConector("amazon", "Credenciais recusadas.", 401);
      throw new ErroConector("amazon", `Resposta de erro da API (${res.status})`, res.status);
    }
    if (json.errors?.length) {
      throw new ErroConector("amazon", json.errors[0].message || json.errors[0].code || "Erro na consulta");
    }
    return json;
  }

  async buscarPalavra(palavra, quantidade = 10) {
    return executarComRetry(async () => {
      const res = await this.chamarApi("searchItems", { keywords: palavra, itemCount: quantidade });
      return res.searchResult?.items ?? [];
    }, { maxTentativas: 2, esperaInicialMs: 300 });
  }

  async buscarAsins(asins = []) {
    const itens = [];
    for (let i = 0; i < asins.length; i += 10) {
      const lote = asins.slice(i, i + 10);
      const res = await executarComRetry(async () => {
        return await this.chamarApi("getItems", { itemIds: lote, itemIdType: "ASIN" });
      }, { maxTentativas: 2, esperaInicialMs: 300 });
      itens.push(...(res.itemResults?.items ?? []));
    }
    return itens;
  }

  async buscarOfertas({ termos = [], categorias = [], asins = [], limite = 10 } = {}) {
    if (!this.estaConfigurado()) {
      throw new ErroConector("amazon", "Conector Amazon não configurado com credenciais válidas.", 400);
    }

    const agoraIso = new Date(this.agora()).toISOString();
    const resultados = [];
    const buscas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "tec" })) : BUSCAS_PADRAO_AMAZON;

    for (const { termo, categoria } of buscas) {
      try {
        const itens = await this.buscarPalavra(termo, limite);
        for (const item of itens) {
          const norm = deAmazon(item, categoria, this.parceiro, agoraIso);
          if (norm) resultados.push(norm);
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    if (asins.length) {
      try {
        const itens = await this.buscarAsins(asins);
        for (const item of itens) {
          const norm = deAmazon(item, "tec", this.parceiro, agoraIso);
          if (norm) resultados.push(norm);
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    this.registrarSucesso(resultados.length);
    return resultados;
  }

  normalizarItem(item, categoria = "tec") {
    return deAmazon(item, categoria, this.parceiro, new Date(this.agora()).toISOString());
  }
}
