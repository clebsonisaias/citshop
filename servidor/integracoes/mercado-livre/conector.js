/**
 * Conector para o catálogo público do Mercado Livre Brasil (MLB).
 * Realiza descoberta de produtos via API oficial de busca de sites/MLB.
 * Utiliza ProvedorLinkMercadoLivre para validação e geração de links de afiliados autorizados.
 *
 * REGRA CRÍTICA:
 * Não inventar URLs de afiliados. Produtos sem atribuição de afiliado validada
 * não podem ser marcados como aptos para publicação de afiliados.
 */
import { ConectorMarketplace, ErroConector, ProvedorLinkAfiliado } from "../base.js";

const ML_API_BASE = "https://api.mercadolibre.com";
const SITE_ID = "MLB";

// matt_tool do Gerador de links do painel de afiliados (o link oficial traz matt_word=<etiqueta>&matt_tool=<este número>).
export const MATT_TOOL_PADRAO = "70471590";
/** Põe a atribuição oficial (matt_tool + matt_word) num link do Mercado Livre; outros links passam iguais. */
export function comAtribuicaoML(link, etiqueta = process.env.MERCADO_LIVRE_AFFILIATE_TAG, tool = process.env.MERCADO_LIVRE_MATT_TOOL || MATT_TOOL_PADRAO) {
  try {
    const u = new URL(link);
    if (!etiqueta || !/(^|\.)mercadoli(vre|bre)\.com(\.br)?$/.test(u.hostname) || u.pathname.startsWith("/sec/")) return link;
    u.searchParams.set("matt_tool", tool);
    u.searchParams.set("matt_word", etiqueta);
    return u.toString();
  } catch { return link; }
}

export const BUSCAS_PADRAO_ML = [
  { termo: "furadeira parafusadeira", categoria: "ferr" },
  { termo: "creatina monohidratada", categoria: "esporte" },
  { termo: "jogo de panelas", categoria: "cozinha" },
  { termo: "aspirador de po robo", categoria: "eletro" },
];

/**
 * Mapeamento das categorias principais do Mercado Livre para os departamentos do CITshop.
 */
export const CATEGORIAS_ML_CITSHOP = {
  MLB1051: "cel",     // Celulares e Telefones
  MLB1000: "ele",     // Eletrônicos, Áudio e Vídeo -> tec
  MLB1648: "info",    // Informática
  MLB5726: "eletro",  // Eletrodomésticos
  MLB1574: "casa",    // Casa, Móveis e Decoração
  MLB1430: "calc",    // Calçados, Roupas e Bolsas -> moda
  MLB1276: "esporte", // Esportes e Fitness
  MLB263532: "auto",  // Acessórios para Veículos
  MLB1246: "beleza",  // Beleza e Cuidado Pessoal
  MLB1071: "pets",    // Animais
  MLB1196: "livros",  // Livros
};

/**
 * Provedor de links de afiliados do Mercado Livre.
 * Valida a presença de tags oficiais do programa de afiliados do Mercado Livre (ex: matt_tool, matt_word, etc)
 * ou permite injetar uma função/API externa autorizada de geração de links.
 */
export class ProvedorLinkMercadoLivre extends ProvedorLinkAfiliado {
  constructor({ geradorAutorizado = null, tagAfiliado = process.env.MERCADO_LIVRE_AFFILIATE_TAG } = {}) {
    super();
    this.geradorAutorizado = geradorAutorizado;
    this.tagAfiliado = tagAfiliado;
  }

  validarLinkAfiliado(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url);
      const dominiosValidos = ["mercadolivre.com.br", "mercadolibre.com", "mercadolivre.com", "meli.la"];
      const hostValido = dominiosValidos.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
      if (!hostValido) return false;
      if (u.pathname.startsWith("/sec/")) return true;

      // Parâmetros oficiais de atribuição do programa de afiliados do Mercado Livre
      const temTool = Boolean(u.searchParams.get("matt_tool"));
      const temTag = Boolean(this.tagAfiliado && (u.searchParams.get("matt_word") === this.tagAfiliado || u.searchParams.get("afiliado") === this.tagAfiliado));
      return temTool || temTag;
    } catch {
      return false;
    }
  }

  async gerarLinkAfiliado({ urlOriginal, itemId, subId }) {
    if (!urlOriginal) return null;

    // Se a URL já possui atribuição válida, aceita
    if (this.validarLinkAfiliado(urlOriginal)) return urlOriginal;

    // Se houver um gerador autorizado configurado (ex: integração oficial futura)
    if (typeof this.geradorAutorizado === "function") {
      const gerado = await this.geradorAutorizado({ urlOriginal, itemId, subId });
      if (this.validarLinkAfiliado(gerado)) return gerado;
    }

    // Se houver tag de afiliado configurada, anexa os parâmetros oficiais autorizados
    if (this.tagAfiliado) {
      try {
        const u = new URL(comAtribuicaoML(urlOriginal, this.tagAfiliado));
        if (subId) u.searchParams.set("sub_id", subId);
        return u.toString();
      } catch {
        return null;
      }
    }

    // Sem mecanismo autorizado, devolve null (nunca inventa link falso)
    return null;
  }
}

/**
 * Converte item da API do Mercado Livre para o schema padrão do CITshop.
 */
export function deMercadoLivre(item, categoria = "casa", linkAfiliado = null) {
  const preco = Number(item.price);
  if (!(preco > 0) || !item.title) return null;
  const antigo = Number(item.original_price);

  return {
    id: `ml-${item.id}`,
    externalId: String(item.id),
    marketplace: "mercado-livre",
    loja: "mercado-livre",
    nome: item.title,
    categoria,
    preco,
    precoAntigo: antigo > preco ? antigo : null,
    imagem: item.thumbnail ? item.thumbnail.replace("-I.jpg", "-O.jpg") : null,
    link: linkAfiliado,
    disponibilidade: item.available_quantity > 0 ? "em_estoque" : "esgotado",
    vendidos: Number(item.sold_quantity) || 0,
    condicao: item.condition || "novo",
    temAtribuicaoAfiliado: Boolean(linkAfiliado),
    atualizadoEm: new Date().toISOString(),
  };
}

// ---------- Conta do Mercado Livre (OAuth do app em developers.mercadolivre.com.br) ----------
// A busca pública (sites/MLB/search) passou a recusar quem não tem login; com o token da conta ela volta a funcionar.
// O token vale 6 h e é renovado com o refresh_token (que é trocado a cada renovação).
const ML_AUTH = "https://auth.mercadolivre.com.br/authorization";
export const urlAutorizacaoML = ({ clientId, redirectUri, state }) =>
  `${ML_AUTH}?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state })}`;
/** POST /oauth/token (troca do código ou renovação). Devolve { accessToken, refreshToken, expiraEmSeg, userId }. */
export async function pedirTokenML(params, fetchImpl = fetch) {
  const r = await fetchImpl(`${ML_API_BASE}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(15_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(d.message || d.error || `Mercado Livre respondeu ${r.status}`);
  return { accessToken: d.access_token, refreshToken: d.refresh_token ?? null, expiraEmSeg: Number(d.expires_in) || 21600, userId: d.user_id ?? null };
}

// Melhor anúncio de um produto de catálogo: mais vendido, frete grátis, maior desconto, menor preço.
const notaAnuncio = (i) => [Number(i.sold_quantity) || 0, i.shipping?.free_shipping ? 1 : 0, i.original_price > i.price ? 1 - i.price / i.original_price : 0, -i.price];
const melhorAnuncio = (lista) => lista.filter((i) => Number(i.price) > 0).sort((a, b) => {
  const x = notaAnuncio(a), y = notaAnuncio(b);
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k];
  return 0;
})[0] ?? null;
const linkDoAnuncio = (id) => `https://produto.mercadolivre.com.br/${String(id).replace(/^MLB-?/i, "MLB-")}`;

export class ConectorMercadoLivre extends ConectorMarketplace {
  constructor({
    provedorLink = null,
    fetchImpl = fetch,
    base = ML_API_BASE,
    accessToken = process.env.MERCADO_LIVRE_ACCESS_TOKEN || null,
    obterToken = null, // async () => token da conta conectada no admin (renovado sozinho); ver app.js
    limiteDiario = 150, // consultas por dia: o Mercado Livre bloqueia app que consulta demais (EXCESSIVE_API_CALL)
    termosPorRodada = 3,
  } = {}) {
    super("mercado-livre");
    Object.assign(this, { fetchImpl, base, accessToken, obterToken, limiteDiario, termosPorRodada, rodizio: 0, cota: { dia: "", n: 0 } });
    this.provedorLink = provedorLink || new ProvedorLinkMercadoLivre();
  }

  estaConfigurado() {
    return Boolean(this.provedorLink?.tagAfiliado);
  }

  /** GET na API com o token da conta (quando houver) e o teto diário de consultas. */
  async get(caminho) {
    const dia = new Date().toISOString().slice(0, 10);
    if (this.cota.dia !== dia) this.cota = { dia, n: 0 };
    if (this.cota.n >= this.limiteDiario) throw new ErroConector("mercado-livre", "Limite diário de consultas ao Mercado Livre atingido (proteção contra bloqueio).", 429);
    this.cota.n++;
    const token = (this.obterToken && (await this.obterToken())) || this.accessToken;
    const res = await this.fetchImpl(`${this.base}${caminho}`, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const msg = res.status === 401 || res.status === 403
        ? `Mercado Livre recusou a busca (HTTP ${res.status})${token ? "" : ": conecte a conta do Mercado Livre no admin"}`
        : `Erro HTTP ${res.status} no Mercado Livre`;
      throw new ErroConector("mercado-livre", msg, res.status);
    }
    return res.json();
  }

  /**
   * Anúncios para o termo. Tenta a busca de anúncios; se ela for recusada (403), usa a busca de produtos de catálogo
   * e o melhor anúncio de cada um (1 consulta a mais por produto).
   */
  async buscarCatalogo(termo, limite = 6) {
    const q = encodeURIComponent(termo);
    try {
      return (await this.get(`/sites/${SITE_ID}/search?q=${q}&limit=${limite}`)).results ?? [];
    } catch (e) {
      if (e.codigoStatus !== 403) throw e;
    }
    const catalogo = (await this.get(`/products/search?status=active&site_id=${SITE_ID}&q=${q}&limit=${limite}`)).results ?? [];
    const itens = [];
    for (const c of catalogo.slice(0, limite)) {
      try {
        const a = melhorAnuncio((await this.get(`/products/${encodeURIComponent(c.id)}/items?limit=5`)).results ?? []);
        if (!a?.item_id) continue;
        itens.push({
          id: a.item_id, title: c.name, price: a.price, original_price: a.original_price, condition: a.condition,
          thumbnail: c.pictures?.[0]?.secure_url ?? c.pictures?.[0]?.url ?? null, available_quantity: 1,
          sold_quantity: a.sold_quantity, permalink: linkDoAnuncio(a.item_id),
        });
      } catch (e) {
        if (e.codigoStatus === 429) break;
      }
    }
    return itens;
  }

  async obterDetalhes(itemId) {
    return this.get(`/items/${encodeURIComponent(itemId)}`);
  }

  /** Poucos termos por rodada, em rodízio (a lista inteira é coberta ao longo das rodadas). Se todos falharem, lança. */
  async buscarOfertas({ termos = [], categorias = [], limite = 6 } = {}) {
    const todas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "casa" })) : BUSCAS_PADRAO_ML;
    const buscas = Array.from({ length: Math.min(this.termosPorRodada, todas.length) }, (_, k) => todas[(this.rodizio + k) % todas.length]);
    this.rodizio = (this.rodizio + buscas.length) % Math.max(1, todas.length);
    const resultados = [];
    let falhas = 0, ultimoErro = null;

    for (const { termo, categoria } of buscas) {
      try {
        for (const item of await this.buscarCatalogo(termo, limite)) {
          if (item.available_quantity <= 0) continue;
          let linkAfiliado = null;
          try { linkAfiliado = await this.provedorLink.gerarLinkAfiliado({ urlOriginal: item.permalink, itemId: item.id }); } catch { linkAfiliado = null; }
          const norm = deMercadoLivre(item, categoria, linkAfiliado);
          if (norm) resultados.push(norm);
        }
      } catch (e) {
        falhas++; ultimoErro = e;
        this.registrarErro(e);
      }
    }
    // Tudo falhou: lança, para o motor manter os produtos do Mercado Livre da rodada anterior.
    if (buscas.length && falhas === buscas.length) throw ultimoErro;
    this.registrarSucesso(resultados.length);
    return resultados;
  }

  normalizarItem(item, categoria = "casa") {
    return deMercadoLivre(item, categoria);
  }
}
