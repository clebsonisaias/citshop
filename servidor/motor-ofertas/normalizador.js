/**
 * Normalizador canônico de produtos para a vitrine do CITshop.
 * Garante compatibilidade de categorias com DEPTS e higienização de dados.
 */
import { DEPTS } from "../dados.js";

const centavos = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Mapeia termos ou sinônimos para os departamentos oficiais.
 */
const SINONIMOS_DEPTS = {
  celular: "cel",
  smartphones: "cel",
  tecnologia: "tec",
  eletronicos: "tec",
  audio: "tec",
  informatica: "info",
  computadores: "info",
  eletrodomesticos: "eletro",
  ferramentas: "ferr",
  automotivo: "auto",
  automoveis: "auto",
  brinquedos: "brinq",
  calcados: "calc",
  papelaria: "papel",
  livro: "livros",
  livros: "livros",
};

export function normalizarCategoria(cat) {
  if (!cat) return "casa";
  const c = String(cat).toLowerCase().trim();
  if (DEPTS.includes(c)) return c;
  if (SINONIMOS_DEPTS[c]) return SINONIMOS_DEPTS[c];
  return "casa"; // fallback seguro
}

export function normalizarProduto(item) {
  if (!item || typeof item !== "object") return null;

  const preco = Number(item.preco);
  if (!(preco > 0) || !Number.isFinite(preco)) return null;

  const nome = String(item.nome || "").trim();
  if (!nome) return null;

  const precoAntigo = Number(item.precoAntigo);
  const temPrecoAntigoValido = precoAntigo > preco && Number.isFinite(precoAntigo);

  const marketplace = item.marketplace || item.loja || "afiliado";
  const externalId = item.externalId || item.asin || item.id?.replace(/^(amazon-|shopee-|ml-|shein-)/, "") || null;
  const id = item.id || `${marketplace}-${externalId || Math.random().toString(36).slice(2, 9)}`;

  const fotos = Array.isArray(item.fotos) && item.fotos.length
    ? item.fotos
    : item.imagem ? [item.imagem] : [];

  return {
    id,
    externalId: String(externalId || id),
    marketplace,
    loja: marketplace,
    nome: nome.slice(0, 200),
    descricao: String(item.descricao || "").slice(0, 1000),
    categoria: normalizarCategoria(item.categoria || item.dept),
    dept: normalizarCategoria(item.categoria || item.dept),
    preco: centavos(preco),
    precoAntigo: temPrecoAntigoValido ? centavos(precoAntigo) : null,
    descontoPct: temPrecoAntigoValido ? Math.round(((precoAntigo - preco) / precoAntigo) * 100) : null,
    comissaoPct: item.comissaoPct ? Number(item.comissaoPct) : null,
    comissaoEstimada: item.comissaoEstimada ? centavos(item.comissaoEstimada) : null,
    nota: Number(item.nota) || 0,
    vendidos: Number(item.vendidos) || 0,
    fotos,
    imagem: fotos[0] || null,
    link: item.link || null,
    disponibilidade: item.disponibilidade || "em_estoque",
    atualizadoEm: item.atualizadoEm || new Date().toISOString(),
  };
}
