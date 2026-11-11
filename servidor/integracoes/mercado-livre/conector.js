/**
 * Conector para o catálogo público do Mercado Livre Brasil (MLB).
 * Realiza descoberta de produtos via API oficial de busca de sites/MLB.
 * Utiliza ProvedorLinkMercadoLivre para validação e geração de links de afiliados autorizados.
 *
 * REGRA CRÍTICA:
 * Não inventar URLs de afiliados. Produtos sem atribuição de afiliado validada
 * não podem ser marcados como aptos para publicação de afiliados.
 */
import { ConectorMarketplace, ErroConector, ProvedorLinkAfiliado, executarComRetry } from "../base.js";

const ML_API_BASE = "https://api.mercadolibre.com";
const SITE_ID = "MLB";

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
      const hostValido = u.hostname === "mercadolivre.com.br" || u.hostname.endsWith(".mercadolivre.com.br") || u.hostname === "mercadolibre.com";
      if (!hostValido) return false;

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
        const u = new URL(urlOriginal);
        u.searchParams.set("matt_tool", "citshop");
        u.searchParams.set("matt_word", this.tagAfiliado);
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

export class ConectorMercadoLivre extends ConectorMarketplace {
  constructor({
    provedorLink = null,
    fetchImpl = fetch,
    base = ML_API_BASE,
  } = {}) {
    super("mercado-livre");
    this.fetchImpl = fetchImpl;
    this.base = base;
    this.provedorLink = provedorLink || new ProvedorLinkMercadoLivre();
  }

  estaConfigurado() {
    // A descoberta de catálogo público funciona sem chaves; a publicação como afiliado requer o provedor de links
    return true;
  }

  async buscarCatalogo(termo, limite = 10) {
    const url = `${this.base}/sites/${SITE_ID}/search?q=${encodeURIComponent(termo)}&limit=${limite}`;
    return executarComRetry(async () => {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new ErroConector("mercado-livre", `Erro HTTP ${res.status} na busca de catálogo`, res.status);
      }
      const json = await res.json().catch(() => ({}));
      return json.results ?? [];
    }, { maxTentativas: 2, esperaInicialMs: 300 });
  }

  async obterDetalhes(itemId) {
    const url = `${this.base}/items/${encodeURIComponent(itemId)}`;
    return executarComRetry(async () => {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new ErroConector("mercado-livre", `Erro HTTP ${res.status} ao consultar item ${itemId}`, res.status);
      }
      return await res.json();
    }, { maxTentativas: 2, esperaInicialMs: 300 });
  }

  async buscarOfertas({ termos = [], categorias = [], limite = 8 } = {}) {
    const buscas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "casa" })) : BUSCAS_PADRAO_ML;
    const resultados = [];

    for (const { termo, categoria } of buscas) {
      try {
        const itens = await this.buscarCatalogo(termo, limite);
        for (const item of itens) {
          // Validação de disponibilidade
          if (item.available_quantity <= 0) continue;

          let linkAfiliado = null;
          try {
            linkAfiliado = await this.provedorLink.gerarLinkAfiliado({
              urlOriginal: item.permalink,
              itemId: item.id,
            });
          } catch {
            linkAfiliado = null;
          }

          const norm = deMercadoLivre(item, categoria, linkAfiliado);
          if (norm) resultados.push(norm);
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    this.registrarSucesso(resultados.length);
    return resultados;
  }

  normalizarItem(item, categoria = "casa") {
    return deMercadoLivre(item, categoria);
  }
}
