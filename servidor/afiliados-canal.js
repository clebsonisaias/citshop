// Comissão de afiliado por canal (docs/AFILIADOS.md).
// Todo "Comprar" de oferta de afiliado passa por /ir/<produto>?c=<canal>. Na Shopee, o link de destino é gerado com
// subIds ["citshop", canal]; eles voltam no conversionReport como utmContent, e assim cada venda tem canal.
// Cliques são contados aqui (sem robôs de prévia de link). Comissão de pedido CONCLUÍDO entra no livro financeiro.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lancar } from "./financeiro.js";

export const CANAIS = ["site", "produto", "whatsapp", "telegram", "instagram", "bio", "outros"];
export const canalValido = (c) => (CANAIS.includes(String(c)) ? String(c) : "outros");
/** Canal a partir do utmContent da Shopee (subIds juntos por "-"). Venda sem marca = "sem_canal" (link antigo ou direto). */
export function canalDoUtm(utm) {
  const partes = String(utm ?? "").toLowerCase().split(/[-_,|\s]+/);
  return partes.includes("citshop") ? (CANAIS.find((c) => partes.includes(c)) ?? "outros") : "sem_canal";
}
// Robôs que abrem o link para montar a prévia (não são clientes).
const ROBO = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|python|node-fetch/i;
// Destinos aceitos no redirecionamento (nunca para fora das lojas parceiras).
const DESTINO_OK = /^https:\/\/([a-z0-9-]+\.)*(shopee\.com\.br|shope\.ee|amazon\.com\.br|amzn\.to|mercadolivre\.com\.br|mercadolivre\.com|meli\.la|shein\.com|shein\.top)\//;
const TTL_LINK = 30 * 24 * 60 * 60 * 1000;

export class CanaisAfiliado {
  constructor({ dadosDir, shopee = null, agora = Date.now, log = console, esperaMs = 4000 }) {
    Object.assign(this, { dadosDir, shopee, agora, log, esperaMs });
    this.arqLinks = join(dadosDir, "links-canal.json");
    this.arqCliques = join(dadosDir, "cliques-canal.json");
    this.links = this.lerJson(this.arqLinks, {});
    this.cliques = this.lerJson(this.arqCliques, {}); // { "AAAA-MM-DD": { canal: { loja: n } } }
    this.sujo = false;
    this.gerando = new Map();
  }
  lerJson(f, padrao) { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return padrao; } }
  gravar(f, d) { writeFileSync(`${f}.tmp`, JSON.stringify(d)); renameSync(`${f}.tmp`, f); }
  /** Grava os contadores (chamado a cada minuto e ao gerar link): um clique não regrava arquivo na hora. */
  descarregar() {
    if (!this.sujo) return;
    const dias = Object.keys(this.cliques).sort();
    for (const d of dias.slice(0, Math.max(0, dias.length - 120))) delete this.cliques[d]; // guarda 120 dias
    this.gravar(this.arqCliques, this.cliques);
    this.sujo = false;
  }
  registrarClique(canal, loja, userAgent = "") {
    if (ROBO.test(userAgent)) return false;
    const dia = new Date(this.agora()).toISOString().slice(0, 10);
    const c = ((this.cliques[dia] ??= {})[canal] ??= {});
    c[loja] = (c[loja] ?? 0) + 1;
    this.sujo = true;
    return true;
  }
  /**
   * Destino do clique. Shopee com link original: link com a origem (gerado uma vez por produto+canal e guardado 30 dias).
   * Sem API, sem link original ou com erro na Shopee: o link de afiliado de sempre (o clique nunca fica esperando).
   */
  async destino(produto, canal) {
    const padrao = DESTINO_OK.test(produto.link ?? "") ? produto.link : null;
    if (produto.loja !== "shopee" || !produto.linkOriginal || !this.shopee?.estaConfigurado?.()) return padrao;
    const chave = `${produto.id}|${canal}`, g = this.links[chave];
    if (g && this.agora() - g.em < TTL_LINK && DESTINO_OK.test(g.link)) return g.link;
    // Gera uma vez e guarda quando chegar, mesmo que passe dos 4 s: este clique vai pelo link padrão, os próximos já saem marcados.
    if (!this.gerando.has(chave)) this.gerando.set(chave, this.shopee.gerarLinkComSubIds(produto.linkOriginal, ["citshop", canal])
      .then((link) => (link && DESTINO_OK.test(link) ? (this.guardar(chave, link), link) : null))
      .catch((e) => { this.log.warn?.(`[canal] link ${chave}: ${e.message}`); return null; })
      .finally(() => this.gerando.delete(chave)));
    const link = await Promise.race([this.gerando.get(chave), new Promise((ok) => setTimeout(() => ok(null), this.esperaMs).unref?.())]);
    return link ?? padrao;
  }
  guardar(chave, link) {
    this.links[chave] = { link, em: this.agora() };
    if (Object.keys(this.links).length > 20000) for (const k of Object.keys(this.links).slice(0, 5000)) delete this.links[k];
    this.gravar(this.arqLinks, this.links);
  }
  cliquesNoPeriodo(desdeDia) {
    const total = {};
    for (const [dia, canais] of Object.entries(this.cliques)) {
      if (dia < desdeDia) continue;
      for (const [canal, lojas] of Object.entries(canais)) for (const [loja, n] of Object.entries(lojas)) {
        const t = (total[canal] ??= { total: 0, porLoja: {} });
        t.total += n; t.porLoja[loja] = (t.porLoja[loja] ?? 0) + n;
      }
    }
    return total;
  }
}

/** Vendas da Shopee por canal: pedidos, comissão estimada (em andamento) e confirmada (concluídos). */
export function vendasPorCanal(conversoes) {
  const r = {};
  for (const c of conversoes) {
    const canal = canalDoUtm(c.utm);
    for (const p of c.pedidos) {
      const t = (r[canal] ??= { pedidos: 0, estimada: 0, confirmada: 0, cancelados: 0 });
      t.pedidos++;
      if (p.orderStatus === "COMPLETED") t.confirmada = Math.round((t.confirmada + p.comissao) * 100) / 100;
      else if (p.orderStatus === "CANCELLED") t.cancelados++;
      else t.estimada = Math.round((t.estimada + p.comissao) * 100) / 100;
    }
  }
  return r;
}

/**
 * Livro financeiro: comissão de pedido CONCLUÍDO entra como "afiliado" (uma vez por pedido). Se depois aparecer
 * cancelado/devolvido, entra um ajuste negativo (uma vez). Idempotente: rodar de novo não duplica.
 */
export function lancarComissoesShopee(banco, conversoes, agora) {
  let novos = 0;
  const livro = banco.d.lancamentos ?? [];
  for (const c of conversoes) for (const p of c.pedidos) {
    const chave = `afiliado:shopee:${p.orderId}`;
    if (p.orderStatus === "COMPLETED" && p.comissao > 0) {
      if (lancar(banco, { chave, tipo: "afiliado", valor: p.comissao, referencia: p.orderId, detalhe: { marketplace: "shopee", canal: canalDoUtm(c.utm), conversionId: c.conversionId, itens: p.itens.length } }, agora).novo) novos++;
    } else if (p.orderStatus === "CANCELLED") {
      const lancado = livro.find((l) => l.chave === chave);
      if (lancado && lancar(banco, { chave: `${chave}:cancelado`, tipo: "ajuste", valor: -lancado.valor, referencia: p.orderId, detalhe: { marketplace: "shopee", motivo: "pedido cancelado ou devolvido depois de concluído" } }, agora).novo) novos++;
    }
  }
  return novos;
}
