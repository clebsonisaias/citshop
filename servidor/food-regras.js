// CITshop Food: regras puras (sem banco nem rede), testadas em teste/food.test.js.
// Horário de funcionamento, cardápio com grupos de opções, preço calculado no servidor e situação do pedido.
import { randomBytes } from "node:crypto";

const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const reais = (n) => Math.round(Number(n) * 100) / 100;
const id8 = () => randomBytes(4).toString("hex");
const idOk = (v) => typeof v === "string" && /^[a-f0-9]{8}$/.test(v);

// ---------- situação operacional (separada do pagamento) ----------
export const SITUACOES = ["aguardando", "aceito", "preparo", "pronto", "aguardando_saida", "saiu", "entregue", "concluido", "cancelado"];
export const ROTULO_SITUACAO = {
  aguardando: "Aguardando confirmação", aceito: "Aceito", preparo: "Em preparação", pronto: "Pronto",
  aguardando_saida: "Aguardando retirada/entregador", saiu: "Saiu para entrega", entregue: "Entregue", concluido: "Concluído", cancelado: "Cancelado",
};
// Cozinha só mexe no preparo; atendente e dono mexem em tudo (inclusive cancelar). Ninguém aqui mexe no pagamento.
const DA_COZINHA = new Set(["aceito", "preparo", "pronto"]);
export const podeMudar = (papel, para) => SITUACOES.includes(para) && (papel === "cozinha" ? DA_COZINHA.has(para) : true);
export const ATIVAS = new Set(["aguardando", "aceito", "preparo", "pronto", "aguardando_saida", "saiu"]);

// ---------- horário (America/Sao_Paulo, independente do fuso do servidor) ----------
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function horaLocal(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minutos: Number(p.hour) * 60 + Number(p.minute), data: `${p.year}-${p.month}-${p.day}` };
}
const minutosDe = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Horários: [{ dia: 0-6 (0 = domingo), abre: "18:00", fecha: "23:30" }]; fecha antes de abre = passa da meia-noite. */
export function lerHorarios(v) {
  return (Array.isArray(v) ? v : []).map((h) => ({ dia: Number(h?.dia), abre: String(h?.abre ?? ""), fecha: String(h?.fecha ?? "") }))
    .filter((h) => Number.isInteger(h.dia) && h.dia >= 0 && h.dia <= 6 && minutosDe(h.abre) != null && minutosDe(h.fecha) != null && h.abre !== h.fecha)
    .slice(0, 21);
}

/** { aberto, motivo } agora. Fechamento manual e pausa vêm antes do horário; feriado fecha o dia. */
export function situacaoLoja(food = {}, t) {
  if (food.fechadoManual) return { aberto: false, motivo: "Fechado no momento" };
  if (food.pausadoAte && Date.parse(food.pausadoAte) > t) return { aberto: false, motivo: "Pausado: volta logo", pausadoAte: food.pausadoAte };
  const agora = horaLocal(t), ontem = (agora.dia + 6) % 7;
  if ((food.feriados ?? []).includes(agora.data)) return { aberto: false, motivo: "Fechado hoje (feriado)" };
  const horarios = food.horarios ?? [];
  if (!horarios.length) return { aberto: false, motivo: "Horário não informado" };
  const aberto = horarios.some((h) => {
    const a = minutosDe(h.abre), f = minutosDe(h.fecha);
    if (a < f) return h.dia === agora.dia && agora.minutos >= a && agora.minutos < f;
    return (h.dia === agora.dia && agora.minutos >= a) || (h.dia === ontem && agora.minutos < f); // passa da meia-noite
  });
  return aberto ? { aberto: true, motivo: "Aberto agora" } : { aberto: false, motivo: "Fechado agora" };
}

// ---------- cardápio ----------
/**
 * Item do cardápio vindo do painel. Grupos de opções (tamanho, sabor, borda, adicionais, bebida do combo):
 * { nome, min, max, opcoes: [{ nome, preco }] }. Ids existentes são mantidos (o pedido guarda um retrato, mas o
 * carrinho do cliente aponta para eles); ids novos são criados aqui.
 */
export function lerItem(b) {
  const preco = reais(String(b?.preco ?? "0").replace(",", "."));
  const grupos = (Array.isArray(b?.grupos) ? b.grupos : []).slice(0, 10).map((g) => {
    const opcoes = (Array.isArray(g?.opcoes) ? g.opcoes : []).slice(0, 40).map((o) => ({
      id: idOk(o?.id) ? o.id : id8(), nome: txt(o?.nome, 60), preco: Math.max(0, reais(String(o?.preco ?? "0").replace(",", ".")) || 0), ativo: o?.ativo !== false,
    })).filter((o) => o.nome);
    const max = Math.min(Math.max(1, Math.floor(Number(g?.max) || 1)), opcoes.length || 1);
    const min = Math.min(Math.max(0, Math.floor(Number(g?.min) || 0)), max);
    return { id: idOk(g?.id) ? g.id : id8(), nome: txt(g?.nome, 60), min, max, opcoes };
  }).filter((g) => g.nome && g.opcoes.length);
  const item = {
    nome: txt(b?.nome, 80), descricao: String(b?.descricao ?? "").trim().slice(0, 400), categoria: txt(b?.categoria, 40) || "Cardápio",
    preco: Number.isFinite(preco) && preco >= 0 ? preco : NaN, ativo: b?.ativo !== false, grupos,
    estacao: txt(b?.estacao, 20) || null, // chapa, forno, bebidas... (impressora/tela por estação)
  };
  if (item.nome.length < 2) return { erro: "Dê um nome ao item." };
  if (!Number.isFinite(item.preco) || item.preco > 100000) return { erro: "Preço inválido." };
  if (item.preco === 0 && !grupos.some((g) => g.min > 0 && g.opcoes.some((o) => o.preco > 0))) return { erro: "Informe o preço (ou um grupo obrigatório com preço, como o tamanho)." };
  return { item };
}

/**
 * Preço de uma unidade com as escolhas do cliente: { [grupoId]: [opcaoId, ...] }. Confere mínimo e máximo de cada
 * grupo e ignora nada: opção desconhecida ou desativada é erro (o cardápio mudou; o cliente escolhe de novo).
 */
export function precoItem(item, escolhas = {}) {
  let unitario = item.preco;
  const opcoes = [];
  for (const g of item.grupos ?? []) {
    const ids = [...new Set(Array.isArray(escolhas?.[g.id]) ? escolhas[g.id].map(String) : [])];
    if (ids.length < g.min) return { erro: g.min === 1 ? `Escolha ${g.nome.toLowerCase()} de ${item.nome}.` : `Escolha pelo menos ${g.min} em ${g.nome} de ${item.nome}.` };
    if (ids.length > g.max) return { erro: `Escolha no máximo ${g.max} em ${g.nome} de ${item.nome}.` };
    for (const idOp of ids) {
      const o = g.opcoes.find((x) => x.id === idOp && x.ativo !== false);
      if (!o) return { erro: `Uma opção de ${item.nome} não está mais disponível. Escolha de novo.` };
      unitario += o.preco;
      opcoes.push({ grupo: g.nome, nome: o.nome, preco: o.preco });
    }
  }
  const sobra = Object.keys(escolhas ?? {}).find((k) => !(item.grupos ?? []).some((g) => g.id === k));
  if (sobra) return { erro: `Uma opção de ${item.nome} não está mais disponível. Escolha de novo.` };
  return { unitario: reais(unitario), opcoes };
}

/** Linhas do pedido com retrato de nome, opções e preços; subtotal calculado aqui (nunca vem do aparelho). */
export function montarItens(cardapioDaLoja, pedidos) {
  if (!Array.isArray(pedidos) || !pedidos.length) return { erro: "O carrinho está vazio." };
  if (pedidos.length > 30) return { erro: "Pedido grande demais: no máximo 30 itens diferentes." };
  const linhas = [];
  for (const p of pedidos) {
    const item = cardapioDaLoja.find((i) => i.id === String(p?.itemId) && i.ativo);
    if (!item) return { erro: "Um item do carrinho não está mais no cardápio." };
    const quantidade = Math.floor(Number(p?.quantidade) || 0);
    if (quantidade < 1 || quantidade > 50) return { erro: "Quantidade inválida." };
    const r = precoItem(item, p?.escolhas);
    if (r.erro) return r;
    linhas.push({ itemId: item.id, nome: item.nome, categoria: item.categoria, estacao: item.estacao ?? null, quantidade, unitario: r.unitario, opcoes: r.opcoes, total: reais(r.unitario * quantidade), observacao: txt(p?.observacao, 140) });
  }
  return { itens: linhas, subtotal: reais(linhas.reduce((s, l) => s + l.total, 0)) };
}

// ---------- comanda (dados; o CITshop Print transforma em ESC/POS) ----------
export const TIPOS_COMANDA = ["completa", "cozinha", "expedicao", "cliente"];
/** Comanda sem dado desnecessário: a de cozinha não leva valores, telefone nem endereço. */
export function comandaDe(pedido, loja, tipo = "completa") {
  const c = pedido.comprador ?? {}, cozinha = tipo === "cozinha";
  return {
    tipo, restaurante: loja.nome, numero: pedido.numero, pedidoId: pedido.id, em: pedido.criadoEm,
    cliente: c.nome ?? "", telefone: cozinha || tipo === "cliente" ? "" : c.whatsapp ?? "",
    modalidade: pedido.receber === "entrega" ? "ENTREGA" : "RETIRADA",
    endereco: cozinha ? "" : pedido.receber === "entrega" ? c.endereco ?? "" : "",
    itens: pedido.itens.map((i) => ({ quantidade: i.quantidade, nome: i.nome, opcoes: i.opcoes.map((o) => `${o.grupo}: ${o.nome}`), observacao: i.observacao, ...(cozinha ? {} : { total: i.total }) })),
    observacao: c.observacao ?? "",
    ...(cozinha ? {} : { subtotal: pedido.subtotal, taxaEntrega: pedido.entrega?.valor ?? 0, desconto: pedido.desconto ?? 0, total: pedido.valorTotal, pagamento: pedido.pagamentoForma, situacaoPagamento: pedido.status === "approved" ? "PAGO" : pedido.status === "na_entrega" ? "COBRAR NA ENTREGA" : "PENDENTE" }),
  };
}
