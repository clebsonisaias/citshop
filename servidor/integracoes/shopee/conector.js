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
}

export function deShopee(item, categoria, linkAfiliado = null) {
  const preco = Number(item.priceMin ?? item.price);
  if (!(preco > 0) || !item.productName) return null;

  return {
    id: `shopee-${item.itemId}`,
    externalId: String(item.itemId),
    marketplace: "shopee",
    loja: "shopee",
    nome: item.productName,
    categoria,
    preco,
    precoAntigo: null, // Shopee não informa De confiável, apenas percentual; não inventar
    nota: Number(item.ratingStar) || 0,
    vendidos: Number(item.sales) || 0,
    imagem: item.imageUrl,
    link: linkAfiliado || item.productLink || null,
    comissaoPct: Number(item.commissionRate) || null,
    comissaoEstimada: Number(item.commission) || null,
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
      nodes { itemId productName priceMin priceDiscountRate ratingStar sales imageUrl productLink commissionRate commission } } }`;
    const data = await this.chamarGraphQL(query);
    return data?.productOfferV2?.nodes ?? [];
  }

  async buscarOfertas({ termos = [], categorias = [], limite = 8 } = {}) {
    if (!this.estaConfigurado()) {
      throw new ErroConector("shopee", "Credenciais da Shopee Open API não configuradas.", 400);
    }

    const buscas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "casa" })) : BUSCAS_PADRAO_SHOPEE;
    const resultados = [];

    for (const { termo, categoria } of buscas) {
      try {
        const itens = await this.buscarPorTermo(termo, limite);
        for (const item of itens) {
          let linkAfiliado = null;
          try {
            linkAfiliado = await this.provedorLink.gerarLinkAfiliado({ urlOriginal: item.productLink });
          } catch (e) {
            // Se não conseguiu gerar link de afiliado, produto não pode ser publicado
            continue;
          }
          if (linkAfiliado) {
            const norm = deShopee(item, categoria, linkAfiliado);
            if (norm) resultados.push(norm);
          }
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    this.registrarSucesso(resultados.length);
    return resultados;
  }

  normalizarItem(item, categoria = "casa") {
    return deShopee(item, categoria);
  }
}
