/**
 * Conector oficial da Shopee Brasil via Affiliate Open API (GraphQL).
 * Suporta autenticação SHA256, consulta de ofertas (productOfferV2) e geração de shortlinks com comissão.
 */
import { createHash } from "node:crypto";
import { ConectorMarketplace, ErroConector, ProvedorLinkAfiliado, executarComRetry } from "../base.js";

const SHOPEE_API = "https://open-api.affiliate.shopee.com.br/graphql";

export const BUSCAS_PADRAO_SHOPEE = [
  // Tecnologia & Celulares
  { termo: "fone bluetooth", categoria: "cel" },
  { termo: "carregador celular rapido", categoria: "cel" },
  { termo: "smartwatch", categoria: "tec" },
  { termo: "caixa de som bluetooth", categoria: "tec" },
  { termo: "ring light tripe", categoria: "tec" },

  // Informática & Games
  { termo: "mouse gamer", categoria: "info" },
  { termo: "teclado mecanico", categoria: "info" },
  { termo: "headset gamer", categoria: "games" },

  // Cozinha & Casa
  { termo: "air fryer fritadeira", categoria: "cozinha" },
  { termo: "garrafa termica", categoria: "cozinha" },
  { termo: "luminaria led", categoria: "casa" },
  { termo: "mop giratorio", categoria: "casa" },
  { termo: "organizador gaveta", categoria: "casa" },

  // Moda, Calçados & Beleza
  { termo: "tenis esportivo", categoria: "calc" },
  { termo: "chinelo nuvem", categoria: "calc" },
  { termo: "mochila impermeavel", categoria: "moda" },
  { termo: "bolsa feminina", categoria: "moda" },
  { termo: "escova secadora", categoria: "beleza" },
  { termo: "maquina cortar cabelo", categoria: "beleza" },

  // Ferramentas, Auto & Pets
  { termo: "parafusadeira furadeira", categoria: "ferr" },
  { termo: "suporte celular veicular", categoria: "auto" },
  { termo: "cama pet cachorro", categoria: "pets" },
];

export function inferirCategoriaShopee(nome = "") {
  const n = String(nome).toLowerCase();
  if (/fone|headset|auricular|tws|carregador|cabo tipo c|lightning|iphone|samsung|redmi|xiaomi|celular|smartphone|pelicula|capinha/i.test(n)) return "cel";
  if (/smartwatch|relogio inteligente|bluetooth|caixa de som|ring light|tripé|dvr|camera|alexa|smart/i.test(n)) return "tec";
  if (/mouse|teclado|notebook|computador|pc|gamer|monitor|gabinete|ssd|memoria ram|hdmi|usb/i.test(n)) return "info";
  if (/air fryer|fritadeira|liquidificador|batedeira|cafeteira|panela|garrafa termica|cozinha|pote|faca|forma/i.test(n)) return "cozinha";
  if (/aspirador|ventilador|ferro de passar|umidificador|eletrodomestico/i.test(n)) return "eletro";
  if (/luminaria|led|cortina|tapete|organizador|almofada|decoracao|quadro|prateleira|sala|espelho/i.test(n)) return "casa";
  if (/lencol|travesseiro|edredom|cobertor|colchao|cama/i.test(n)) return "cama";
  if (/tenis|sapato|sandalia|chinelo|bota|calcado/i.test(n)) return "calc";
  if (/vestido|blusa|camisa|camiseta|shorts|calca|mochila|bolsa|carteira|relogio|oculos/i.test(n)) return "moda";
  if (/maquiagem|pincel|escova|secador|batom|perfume|serum|creme|shampoo|cabelo|barbeador|depilador/i.test(n)) return "beleza";
  if (/creatina|whey|suplemento|vitamina|termogenico|saude/i.test(n)) return "saude";
  if (/furadeira|parafusadeira|chave|ferramenta|alicate|trena|disco|broca/i.test(n)) return "ferr";
  if (/automotivo|carro|moto|veicular|pneu|capacete/i.test(n)) return "auto";
  if (/pet|cachorro|gato|racao|coleira|arranhador|bebedouro/i.test(n)) return "pets";
  if (/treino|academia|corda|elastico|esporte|bicicleta|bola/i.test(n)) return "esporte";
  if (/brinquedo|bebe|boneca|carrinho|jogos/i.test(n)) return "brinq";
  return "casa";
}

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
  const preco = Number(item.priceMax ?? item.priceMin ?? item.price);
  if (!(preco > 0) || !item.productName) return null;

  const comissaoEstimada = Number(item.commission) || null;
  const comissaoPct = item.shopeeCommissionRate
    ? Number(item.shopeeCommissionRate) * 100
    : item.sellerCommissionRate
      ? Number(item.sellerCommissionRate) * 100
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
    categoria: categoria || inferirCategoriaShopee(item.productName),
    preco,
    precoAntigo,
    nota: Number(item.ratingStar) || 0,
    vendidos: Number(item.sales) || 0,
    imagem: item.imageUrl,
    link: item.offerLink || linkAfiliado || item.productLink || null,
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
        throw new ErroConector("shopee", json.errors[0].message || "Erro GraphQL Shopee", 400);
      }
      return json.data;
    }, { maxTentativas: 2, esperaInicialMs: 400 });
  }

  async buscarPorTermo(termo, limite = 12) {
    const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, page: 1, limit: ${limite}) {
      nodes { itemId productName priceMax priceDiscountRate sales imageUrl productLink offerLink commission sellerCommissionRate } } }`;
    const data = await this.chamarGraphQL(query);
    return data?.productOfferV2?.nodes ?? [];
  }

  async buscarOfertas({ termos = [], categorias = [], limite = 12, paginasGerais = 6 } = {}) {
    if (!this.estaConfigurado()) {
      throw new ErroConector("shopee", "Credenciais da Shopee Open API não configuradas.", 400);
    }

    const candidatos = [];

    // 1. Puxar páginas de melhores ofertas em destaque da Shopee Brasil
    for (let p = 1; p <= paginasGerais; p++) {
      try {
        const query = `{ productOfferV2(page: ${p}, limit: 50) {
          nodes { itemId productName priceMax priceDiscountRate sales imageUrl productLink offerLink commission sellerCommissionRate } } }`;
        const data = await this.chamarGraphQL(query);
        const nodes = data?.productOfferV2?.nodes ?? [];
        for (const item of nodes) {
          if (item.productLink || item.offerLink) {
            candidatos.push({ item, categoria: inferirCategoriaShopee(item.productName) });
          }
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    // 2. Buscas específicas por categoria/termo para garantir variedade
    const buscas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "casa" })) : BUSCAS_PADRAO_SHOPEE;
    for (const { termo, categoria } of buscas) {
      try {
        const itens = await this.buscarPorTermo(termo, limite);
        for (const item of itens) {
          if (item.productLink || item.offerLink) {
            candidatos.push({ item, categoria: categoria || inferirCategoriaShopee(item.productName) });
          }
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    // 3. Gerar links para itens que ainda não tenham link curto de afiliado
    const semLinkCurto = candidatos.filter((c) => !c.item.offerLink && c.item.productLink).map((c) => c.item.productLink);
    const urlsParaGerar = [...new Set(semLinkCurto)];
    const mapaLinks = urlsParaGerar.length ? await this.provedorLink.gerarLinksLote(urlsParaGerar) : new Map();

    const resultados = [];
    const vistos = new Set();

    for (const { item, categoria } of candidatos) {
      if (vistos.has(item.itemId)) continue;
      vistos.add(item.itemId);

      const linkAfiliado = item.offerLink || mapaLinks.get(item.productLink) || item.productLink;
      if (linkAfiliado && this.provedorLink.validarLinkAfiliado(linkAfiliado)) {
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
