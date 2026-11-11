/**
 * Conector oficial da Shopee Brasil via Affiliate Open API (GraphQL).
 * Suporta autenticação SHA256, consulta de ofertas (productOfferV2) e geração de shortlinks com comissão.
 */
import { createHash } from "node:crypto";
import { ConectorMarketplace, ErroConector, ProvedorLinkAfiliado, executarComRetry } from "../base.js";

const SHOPEE_API = "https://open-api.affiliate.shopee.com.br/graphql";

export const BUSCAS_PADRAO_SHOPEE = [
  { termo: "fone bluetooth", categoria: "cel" },
  { termo: "smartwatch", categoria: "tec" },
  { termo: "air fryer", categoria: "cozinha" },
  { termo: "luminaria led", categoria: "casa" },
  { termo: "pincel maquiagem", categoria: "beleza" },
  { termo: "controle gamer", categoria: "tec" },
  { termo: "cama pet", categoria: "pets" },
];

export class ProvedorLinkShopee extends ProvedorLinkAfiliado {
  constructor({ appId, segredo, fetchImpl = fetch } = {}) {
    super();
    this.appId = appId;
    this.segredo = segredo;
    this.fetchImpl = fetchImpl;
  }

  validarLinkAfiliado(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url);
      // Links encurtados de afiliados oficiais da Shopee ou contendo utm_source de afiliado
      const dominiosValidos = ["s.shopee.com.br", "shope.ee", "affiliate.shopee.com.br"];
      if (dominiosValidos.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return true;
      if (u.hostname.endsWith("shopee.com.br") && u.searchParams.get("utm_source")?.startsWith("an_")) return true;
      return false;
    } catch {
      return false;
    }
  }

  async gerarLinkAfiliado({ urlOriginal }) {
    if (!urlOriginal) return null;
    if (this.validarLinkAfiliado(urlOriginal)) return urlOriginal;
    if (!this.appId || !this.segredo) return null;

    const mutation = `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(urlOriginal)} }) { shortLink } }`;
    const body = JSON.stringify({ query: mutation });
    const ts = Math.floor(Date.now() / 1000);
    const assinatura = createHash("sha256").update(`${this.appId}${ts}${body}${this.segredo}`).digest("hex");

    const res = await this.fetchImpl(SHOPEE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinatura}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const j = await res.json().catch(() => ({}));
    if (j.errors?.length) {
      throw new ErroConector("shopee", `Falha ao gerar link: ${j.errors[0].message}`);
    }
    return j.data?.generateShortLink?.shortLink || null;
  }

  async gerarLinksLote(urlsOriginal = []) {
    if (!urlsOriginal.length) return new Map();
    const mapa = new Map();
    const pendentes = [];

    for (const url of urlsOriginal) {
      if (!url) continue;
      if (this.validarLinkAfiliado(url)) {
        mapa.set(url, url);
      } else if (this.appId && this.segredo) {
        pendentes.push(url);
      }
    }

    if (!pendentes.length) return mapa;

    const TAM_LOTE = 40;
    for (let i = 0; i < pendentes.length; i += TAM_LOTE) {
      const pedaco = pendentes.slice(i, i + TAM_LOTE);
      const linksInput = pedaco.map((u) => ({ originUrl: u }));
      const mutation = `mutation { generateBatchShortLink(input: { links: ${JSON.stringify(linksInput).replace(/"originUrl"/g, "originUrl")} }) { links { originUrl shortLink success } } }`;
      const body = JSON.stringify({ query: mutation });
      const ts = Math.floor(Date.now() / 1000);
      const assinatura = createHash("sha256").update(`${this.appId}${ts}${body}${this.segredo}`).digest("hex");

      try {
        const res = await this.fetchImpl(SHOPEE_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinatura}`,
          },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        const j = await res.json().catch(() => ({}));
        const linksRetornados = j.data?.generateBatchShortLink?.links || [];
        for (const item of linksRetornados) {
          if (item.success && item.shortLink) {
            mapa.set(item.originUrl, item.shortLink);
          }
        }
      } catch {
        // Fallback individual se o lote falhar
        for (const u of pedaco) {
          try {
            const short = await this.gerarLinkAfiliado({ urlOriginal: u });
            if (short) mapa.set(u, short);
          } catch {}
        }
      }
    }

    return mapa;
  }
}

export function deShopee(item, categoria, linkAfiliado = null) {
  const preco = Number(item.priceMin ?? item.price);
  if (!(preco > 0) || !item.productName) return null;

  const comissaoEstimada = Number(item.commission) || null;
  const comissaoPct = item.shopeeCommissionRate
    ? Number(item.shopeeCommissionRate) * 100
    : (preco > 0 && comissaoEstimada ? (comissaoEstimada / preco) * 100 : null);

  const desconto = Number(item.priceDiscountRate);
  const precoAntigo = desconto > 0 && desconto < 90
    ? Math.round((preco / (1 - desconto / 100)) * 100) / 100
    : null;

  return {
    id: `shopee-${item.itemId}`,
    externalId: String(item.itemId),
    marketplace: "shopee",
    loja: "shopee",
    nome: item.productName,
    categoria,
    preco,
    precoAntigo,
    nota: Number(item.ratingStar) || 0,
    vendidos: Number(item.sales) || 0,
    imagem: item.imageUrl,
    link: linkAfiliado || item.productLink || null,
    comissaoPct: comissaoPct ? Math.round(comissaoPct * 10) / 10 : null,
    comissaoEstimada,
    atualizadoEm: new Date().toISOString(),
  };
}

export class ConectorShopee extends ConectorMarketplace {
  constructor({
    appId = process.env.SHOPEE_APP_ID,
    segredo = process.env.SHOPEE_SECRET,
    fetchImpl = fetch,
    provedorLink = null,
  } = {}) {
    super("shopee");
    this.appId = appId;
    this.segredo = segredo;
    this.fetchImpl = fetchImpl;
    this.provedorLink = provedorLink || new ProvedorLinkShopee({ appId, segredo, fetchImpl });
  }

  estaConfigurado() {
    return Boolean(this.appId && this.segredo);
  }

  async chamarGraphQL(query) {
    const body = JSON.stringify({ query });
    const ts = Math.floor(Date.now() / 1000);
    const assinatura = createHash("sha256").update(`${this.appId}${ts}${body}${this.segredo}`).digest("hex");

    return executarComRetry(async () => {
      const res = await this.fetchImpl(SHOPEE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinatura}`,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ErroConector("shopee", `Erro HTTP ${res.status}`, res.status);
      }
      if (json.errors?.length) {
        throw new ErroConector("shopee", json.errors[0].message || "Erro GraphQL Shopee");
      }
      return json.data;
    }, { maxTentativas: 2, esperaInicialMs: 400 });
  }

  async buscarPorTermo(termo, limite = 10) {
    const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, sortType: 2, page: 1, limit: ${limite}) {
      nodes { itemId productName price priceMin priceDiscountRate ratingStar sales imageUrl shopName productLink commission shopeeCommissionRate } } }`;
    const data = await this.chamarGraphQL(query);
    return data?.productOfferV2?.nodes ?? [];
  }

  async buscarOfertas({ termos = [], categorias = [], limite = 8 } = {}) {
    if (!this.estaConfigurado()) {
      throw new ErroConector("shopee", "Credenciais da Shopee Open API não configuradas.", 400);
    }

    const buscas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "casa" })) : BUSCAS_PADRAO_SHOPEE;
    const candidatos = [];

    for (const { termo, categoria } of buscas) {
      try {
        const itens = await this.buscarPorTermo(termo, limite);
        for (const item of itens) {
          if (item.productLink) {
            candidatos.push({ item, categoria });
          }
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    // Gerar links de afiliados em lote de forma atômica (elimina erro de rate limit 10030)
    const urlsParaGerar = [...new Set(candidatos.map((c) => c.item.productLink))];
    const mapaLinks = await this.provedorLink.gerarLinksLote(urlsParaGerar);

    const resultados = [];
    const vistos = new Set();

    for (const { item, categoria } of candidatos) {
      if (vistos.has(item.itemId)) continue;
      vistos.add(item.itemId);

      const linkAfiliado = mapaLinks.get(item.productLink);
      if (linkAfiliado) {
        const norm = deShopee(item, categoria, linkAfiliado);
        if (norm) resultados.push(norm);
      }
    }

    this.registrarSucesso(resultados.length);
    return resultados;
  }

  normalizarItem(item, categoria = "casa") {
    return deShopee(item, categoria);
  }
}
