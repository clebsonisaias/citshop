// Financeiro do CITshop (docs/FINANCEIRO_E_SPLIT.md).
// - Livro de lançamentos (banco.d.lancamentos): só cresce. Correção vira um novo lançamento (reembolso, chargeback,
//   ajuste), nunca edição ou exclusão. Cada lançamento tem uma `chave` única: processar o mesmo evento duas vezes
//   não lança duas vezes (idempotência).
// - Valores são a receita do CITshop (mensalidades e comissões), não o volume vendido pelas lojas.
// - O pedido guarda um retrato financeiro (`pedido.financeiro`) no momento da venda; pedidos antigos nunca são
//   recalculados com regras novas.
import { randomUUID } from "node:crypto";
import { COMISSAO_PARCEIRO_POR_UNIDADE, reais2 } from "./planos.js";

export const TIPOS_LANCAMENTO = ["mensalidade", "comissao", "afiliado", "reembolso", "chargeback", "ajuste"];

/** Comissão por unidade da loja: parceiro especial paga R$ 1 (ou o valor combinado); loja de mensalidade, nunca. */
export const comissaoPorUnidade = (loja) => (loja?.modeloCobranca === "comissao_fixa" ? reais2(loja.comissaoPorVenda ?? COMISSAO_PARCEIRO_POR_UNIDADE) : 0);

/** Retrato financeiro do pedido no momento da venda (unidades, comissão por unidade e total, valores). */
export function retratoFinanceiro({ loja, unidades, valorProdutos, frete = 0 }) {
  const porUnidade = comissaoPorUnidade(loja);
  return {
    moeda: "BRL", modelo: loja?.modeloCobranca === "comissao_fixa" ? "parceiro" : "mensal",
    unidades, comissaoPorUnidade: porUnidade, comissaoTotal: reais2(porUnidade * unidades),
    valorProdutos: reais2(valorProdutos), frete: reais2(frete), valorTotal: reais2(valorProdutos + frete),
  };
}

/** Lança no livro. Se a chave já existe, devolve o lançamento existente e não lança de novo. */
export function lancar(banco, { chave, tipo, valor, lojaId = null, pedidoId = null, referencia = null, detalhe = {} }, agora) {
  if (!TIPOS_LANCAMENTO.includes(tipo)) throw new Error(`tipo de lançamento inválido: ${tipo}`);
  const livro = (banco.d.lancamentos ??= []);
  const existente = livro.find((l) => l.chave === chave);
  if (existente) return { lancamento: existente, novo: false };
  const lancamento = { id: randomUUID(), chave, tipo, valor: reais2(valor), moeda: "BRL", lojaId, pedidoId, referencia, detalhe, em: new Date(agora).toISOString() };
  livro.push(lancamento);
  return { lancamento, novo: true };
}

/** Venda paga de parceiro: lança a comissão do retrato (uma vez por pedido). */
export function lancarComissao(banco, pedido, agora) {
  // Pedido de antes do 2.0 (sem retrato): usa a taxa gravada nele, nunca recalcula com a regra de hoje.
  const f = pedido.financeiro ?? (pedido.taxaMarketplace > 0 ? { comissaoTotal: pedido.taxaMarketplace, unidades: pedido.quantidade, comissaoPorUnidade: null } : null);
  if (!f || f.comissaoTotal <= 0) return null;
  return lancar(banco, {
    chave: `comissao:${pedido.id}`, tipo: "comissao", valor: f.comissaoTotal, lojaId: pedido.lojaId, pedidoId: pedido.id, referencia: pedido.mpPagamentoId ?? null,
    detalhe: { unidades: f.unidades, comissaoPorUnidade: f.comissaoPorUnidade },
  }, agora);
}

/** Reembolso, cancelamento após aprovação ou chargeback: lança a devolução da comissão (só se ela foi lançada). */
export function estornarComissao(banco, pedido, statusMp, agora) {
  const comissao = (banco.d.lancamentos ?? []).find((l) => l.chave === `comissao:${pedido.id}`);
  if (!comissao) return null;
  const tipo = statusMp === "charged_back" ? "chargeback" : "reembolso";
  return lancar(banco, {
    chave: `estorno:${pedido.id}`, tipo, valor: -comissao.valor, lojaId: pedido.lojaId, pedidoId: pedido.id, referencia: pedido.mpPagamentoId ?? null,
    detalhe: { statusMp, comissaoOriginal: comissao.id },
  }, agora);
}

/** Registro de eventos recebidos do Mercado Pago (auditoria e diagnóstico). Guarda os 5.000 últimos. */
export function registrarEvento(banco, evento, agora) {
  const lista = (banco.d.eventosMp ??= []);
  lista.push({ em: new Date(agora).toISOString(), ...evento });
  if (lista.length > 5000) lista.splice(0, lista.length - 5000);
}

/** Resumo do livro por tipo (e por loja, se pedido). */
export function resumoLivro(lancamentos, { lojaId, desde } = {}) {
  const totais = Object.fromEntries(TIPOS_LANCAMENTO.map((t) => [t, 0]));
  for (const l of lancamentos) {
    if (lojaId && l.lojaId !== lojaId) continue;
    if (desde && Date.parse(l.em) < desde) continue;
    totais[l.tipo] = reais2(totais[l.tipo] + l.valor);
  }
  return { ...totais, liquido: reais2(Object.values(totais).reduce((s, v) => s + v, 0)) };
}
