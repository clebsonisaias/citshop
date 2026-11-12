/**
 * Dados da CITshop num arquivo JSON no volume persistente, gravado de forma atômica.
 * ponytail: JSON em memória aguenta centenas de lojas e milhares de produtos;
 * passar para SQLite se crescer além disso.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DIAS_TESTE = 30;
export const DEPTS = ["tec", "cel", "info", "eletro", "cozinha", "casa", "cama", "moda", "calc", "beleza", "brinq", "esporte", "ferr", "auto", "pets", "papel", "livros", "games", "bebe", "saude", "mercado", "camping", "moveis", "jardim", "musica"];

export class Banco {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.caminho = join(dir, "citshop.json");
    this.d = existsSync(this.caminho) ? JSON.parse(readFileSync(this.caminho, "utf8")) : { lojas: [], produtos: [] };
  }
  get lojas() { return this.d.lojas; }
  get produtos() { return this.d.produtos; }
  loja(id) { return this.lojas.find((l) => l.id === id); }
  lojaPorEmail(email) { return this.lojas.find((l) => l.email === email); }
  lojaPorSlug(slug) { return this.lojas.find((l) => l.slug === slug); }
  produto(id) { return this.produtos.find((p) => p.id === id); }
  cliquesContato(chave) { return this.d.metricasContato?.[chave]?.total ?? 0; }
  registrarCliqueContato(chave, em) {
    if (!this.d.metricasContato) this.d.metricasContato = {};
    const anterior = this.d.metricasContato[chave] ?? { total: 0 };
    this.d.metricasContato[chave] = { total: anterior.total + 1, ultimoCliqueEm: em };
    this.salvar();
    return this.d.metricasContato[chave].total;
  }
  salvar() {
    const tmp = `${this.caminho}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.d));
    renameSync(tmp, this.caminho);
  }
}

/** Regra de cobrança: loja aparece se não está suspensa e (é parceira de comissão fixa, está no teste ou tem assinatura ativa). */
export function lojaVisivel(loja, agora = Date.now()) {
  if (!loja || loja.suspensa) return false;
  if (loja.modeloCobranca === "comissao_fixa") return true;
  return agora <= Date.parse(loja.testeAte) || loja.assinatura?.status === "authorized";
}

/** Estoque: modo "quantidade" (número; vazio = sem contagem, conta como "tem") ou "simples" (padrão: tem ou esgotado). */
export function temEstoque(produto, loja) {
  if (loja?.modoEstoque === "quantidade") return produto.estoque == null || produto.estoque > 0;
  return !produto.esgotado;
}

export function statusLoja(loja, agora = Date.now()) {
  if (loja.suspensa) return "suspensa";
  if (loja.modeloCobranca === "comissao_fixa") return "parceira";
  if (loja.assinatura?.status === "authorized") return "ativa";
  return agora <= Date.parse(loja.testeAte) ? "teste" : "vencida";
}

/** Lojas locais (pagantes ou em teste) sempre antes dos afiliados, mantendo a ordem dentro de cada grupo. */
export function ordenarVitrine(lista) {
  return [...lista.filter((p) => p.loja === "local"), ...lista.filter((p) => p.loja !== "local")];
}

// Nomes de páginas e rotas fixas do site: uma loja com esse nome ganha um sufixo (carrinho-2) em vez de roubar a rota.
export const SLUGS_RESERVADOS = new Set(["api", "bio", "admin", "painel", "contato", "p", "og", "uploads", "webhook", "black-friday", "termos", "privacidade", "carrinho", "cupons", "alertas", "vendor", "mercadopago", "avaliar", "saude"]);

export function slugUnico(nome, lojas) {
  const base = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "loja";
  let slug = base;
  for (let i = 2; lojas.some((l) => l.slug === slug) || SLUGS_RESERVADOS.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}
