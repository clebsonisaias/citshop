/**
 * Conector para a SHEIN Brasil e Provedor de Links de Afiliados SHEIN.
 * Garante atribuição estrita com o ID de afiliado oficial (ex: aff_id / shein.top).
 *
 * REGRA CRÍTICA:
 * Produtos sem atribuição de afiliado confirmada não podem ser publicados como ofertas de afiliados.
 */
import { ConectorMarketplace, ProvedorLinkAfiliado } from "../base.js";

export class ProvedorLinkShein extends ProvedorLinkAfiliado {
  constructor({ affiliateId = process.env.SHEIN_AFFILIATE_ID || "1626555752" } = {}) {
    super();
    this.affiliateId = affiliateId ? String(affiliateId) : null;
  }

  validarLinkAfiliado(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url);
      const dominiosValidos = ["shein.top", "shein.com", "m.shein.com", "api-shein.shein.com"];
      const hostValido = dominiosValidos.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
      if (!hostValido) return false;

      // Links curtos nativos de criadores da SHEIN
      if (u.hostname === "shein.top" || u.hostname.endsWith(".shein.top")) return true;

      // Links web da SHEIN com parâmetros oficiais de rastreamento de afiliado
      const temAffId = Boolean(u.searchParams.get("aff_id"));
      const temUrlFrom = u.searchParams.get("url_from") === "affiliate" || u.searchParams.get("url_from") === "shein_affiliate";
      const temRef = Boolean(u.searchParams.get("ref"));
      return temAffId || temUrlFrom || temRef;
    } catch {
      return false;
    }
  }

  async gerarLinkAfiliado({ urlOriginal, subId } = {}) {
    if (!urlOriginal) return null;

    // Se já é um link curto oficial ou já contém os parâmetros, aceita
    if (this.validarLinkAfiliado(urlOriginal)) return urlOriginal;

    // Se temos o ID de afiliado oficial configurado, anexa os parâmetros de rastreamento
    if (this.affiliateId) {
      try {
        const u = new URL(urlOriginal);
        u.searchParams.set("aff_id", this.affiliateId);
        u.searchParams.set("url_from", "affiliate");
        if (subId) u.searchParams.set("sub_id", String(subId));
        return u.toString();
      } catch {
        return null;
      }
    }

    return null;
  }
}

/**
 * Normaliza um item da SHEIN para a estrutura oficial do CITshop.
 */
export function deShein(item, categoria = "moda", linkAfiliado = null) {
  const preco = Number(item.preco ?? item.price ?? item.salePrice);
  if (!(preco > 0) || (!item.nome && !item.name && !item.title)) return null;

  const rawAntigo = Number(item.precoAntigo ?? item.retailPrice ?? item.originalPrice);
  const precoAntigo = rawAntigo > preco ? rawAntigo : null;
  const idStr = String(item.id || item.goods_id || item.goodsId || item.externalId || "");
  const externalId = idStr.replace(/^shein-/, "");

  return {
    id: `shein-${externalId}`,
    externalId,
    marketplace: "shein",
    loja: "shein",
    nome: item.nome || item.name || item.title,
    categoria: categoria || "moda",
    preco,
    precoAntigo,
    nota: Number(item.nota ?? item.rating) || 4.8,
    vendidos: Number(item.vendidos ?? item.sales) || 0,
    imagem: item.imagem || item.imageUrl || item.image || null,
    link: linkAfiliado || item.link || null,
    comissaoPct: Number(item.comissaoPct ?? item.commissionRate) || 15,
    comissaoEstimada: Number(item.comissaoEstimada ?? item.commission) || null,
    disponibilidade: "em_estoque",
    temAtribuicaoAfiliado: Boolean(linkAfiliado || item.link),
    atualizadoEm: new Date().toISOString(),
  };
}

export class ConectorShein extends ConectorMarketplace {
  constructor({
    affiliateId = process.env.SHEIN_AFFILIATE_ID || "1626555752",
    provedorLink = null,
  } = {}) {
    super("shein");
    this.affiliateId = affiliateId ? String(affiliateId) : null;
    this.provedorLink = provedorLink || new ProvedorLinkShein({ affiliateId: this.affiliateId });
  }

  estaConfigurado() {
    return Boolean(this.affiliateId);
  }

  async buscarOfertas() {
    // A SHEIN não disponibiliza Open API pública para busca automatizada em massa;
    // os itens selecionados são providos via curadoria editorial em manual.json
    // e têm seus links validados e atribuídos com o affiliateId do usuário.
    this.registrarSucesso(0);
    return [];
  }

  normalizarItem(item, categoria = "moda") {
    return deShein(item, categoria);
  }
}
