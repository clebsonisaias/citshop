// CITshop Food: regras puras (sem banco nem rede), testadas em teste/food.test.js.
// Horário de funcionamento, cardápio com grupos de opções, preço calculado no servidor e situação do pedido.
import { randomBytes } from "node:crypto";
import { calcularItem } from "../publico/food-preco.js";

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

// ---------- cardápio (motor universal: publico/food-preco.js, o mesmo cálculo do navegador) ----------
export const LIMITES = { grupos: 20, opcoes: 60, variacoes: 12, datas: 60 };
const dinheiro = (v) => { const n = reais(String(v ?? "0").replace(",", ".")); return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : NaN; };
const inteiro = (v, min, max, padrao) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const estoqueDe = (v) => (v === "" || v == null ? null : inteiro(v, 0, 99999, null));
const lerDatas = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-LIMITES.datas);
const lerHorario = (h) => (h && /^\d{2}:\d{2}$/.test(h.de) && /^\d{2}:\d{2}$/.test(h.ate) && h.de !== h.ate ? { de: h.de, ate: h.ate } : null);
const id = (v) => (idOk(v) ? v : id8());

/** Grupo de personalização vindo do painel (ou de um modelo). Limites e regras são do restaurante. */
export function lerGrupo(g) {
  const opcoes = (Array.isArray(g?.opcoes) ? g.opcoes : []).slice(0, LIMITES.opcoes).map((o) => ({
    id: id(o?.id), nome: txt(o?.nome, 60), descricao: txt(o?.descricao, 120), preco: dinheiro(o?.preco) || 0, ativo: o?.ativo !== false,
    maxQtd: inteiro(o?.maxQtd, 1, 20, 1), estoque: estoqueDe(o?.estoque), datas: lerDatas(o?.datas),
  })).filter((o) => o.nome);
  const capacidade = opcoes.reduce((s, o) => s + o.maxQtd, 0) || 1;
  const max = inteiro(g?.max, 1, capacidade, 1), min = inteiro(g?.min, 0, max, 0);
  return {
    id: id(g?.id), nome: txt(g?.nome, 60), descricao: txt(g?.descricao, 160), tipo: g?.tipo === "remover" ? "remover" : "escolha",
    min, max, regra: ["maior", "media"].includes(g?.regra) ? g.regra : "soma", incluidas: inteiro(g?.incluidas, 0, max, 0),
    estacao: txt(g?.estacao, 20) || null, ativo: g?.ativo !== false, opcoes,
  };
}

/** Item do cardápio vindo do painel: preço-base, variações (com regras próprias por grupo), grupos, estoque, datas e horário. */
export function lerItem(b) {
  const grupos = (Array.isArray(b?.grupos) ? b.grupos : []).slice(0, LIMITES.grupos).map(lerGrupo).filter((g) => g.nome && g.opcoes.length);
  const idsGrupo = new Set(grupos.map((g) => g.id));
  const variacoes = (Array.isArray(b?.variacoes) ? b.variacoes : []).slice(0, LIMITES.variacoes).map((v) => ({
    id: id(v?.id), nome: txt(v?.nome, 40), preco: dinheiro(v?.preco), ativo: v?.ativo !== false,
    grupos: Object.fromEntries(Object.entries(v?.grupos ?? {}).filter(([gid]) => idsGrupo.has(gid)).map(([gid, r]) => {
      const g = grupos.find((x) => x.id === gid), cap = g.opcoes.reduce((s, o) => s + o.maxQtd, 0);
      const regra = {};
      if (r?.ativo === false) regra.ativo = false;
      if (r?.max != null && r.max !== "") regra.max = inteiro(r.max, 1, cap, g.max);
      if (r?.min != null && r.min !== "") regra.min = inteiro(r.min, 0, regra.max ?? g.max, g.min);
      const precos = Object.fromEntries(Object.entries(r?.precos ?? {}).filter(([oid, p]) => g.opcoes.some((o) => o.id === oid) && p !== "" && p != null).map(([oid, p]) => [oid, dinheiro(p) || 0]));
      if (Object.keys(precos).length) regra.precos = precos;
      return [gid, regra];
    }).filter(([, r]) => Object.keys(r).length)),
  })).filter((v) => v.nome);
  const item = {
    nome: txt(b?.nome, 80), descricao: String(b?.descricao ?? "").trim().slice(0, 400), categoria: txt(b?.categoria, 40) || "Cardápio",
    preco: variacoes.length ? 0 : dinheiro(b?.preco), ativo: b?.ativo !== false, grupos, variacoes,
    estoque: estoqueDe(b?.estoque), datas: lerDatas(b?.datas), horario: lerHorario(b?.horario),
    estacao: txt(b?.estacao, 20) || null, modeloId: idOk(b?.modeloId) ? b.modeloId : null,
  };
  if (item.nome.length < 2) return { erro: "Dê um nome ao item." };
  if (variacoes.some((v) => !Number.isFinite(v.preco))) return { erro: "Confira o preço de cada tamanho/variação." };
  if (!Number.isFinite(item.preco)) return { erro: "Preço inválido." };
  if (!variacoes.length && item.preco === 0 && !grupos.some((g) => g.min > 0 && g.opcoes.some((o) => o.preco > 0))) return { erro: "Informe o preço (ou crie tamanhos/variações com preço)." };
  return { item };
}

/** Compatível com a versão anterior: preço de uma unidade em R$ e as opções escolhidas. */
export function precoItem(item, escolhas = {}, quando = {}, variacaoId) {
  const r = calcularItem(item, { escolhas, variacaoId }, quando);
  return r.erro ? r : { unitario: r.unitarioC / 100, opcoes: r.opcoes, variacao: r.variacao };
}

/**
 * Linhas do pedido com o retrato completo (variação, grupos, opções, quantidades e preços do momento) e o consumo de
 * estoque somado do pedido inteiro. Nada do aparelho é usado como preço. `quando` = data/hora do cardápio.
 */
export function montarItens(cardapioDaLoja, pedidos, quando = {}) {
  if (!Array.isArray(pedidos) || !pedidos.length) return { erro: "O carrinho está vazio." };
  if (pedidos.length > 30) return { erro: "Pedido grande demais: no máximo 30 itens diferentes." };
  const linhas = [], consumo = { itens: {}, opcoes: {} };
  for (const p of pedidos) {
    const item = cardapioDaLoja.find((i) => i.id === String(p?.itemId) && i.ativo);
    if (!item) return { erro: "Um item do carrinho não está mais no cardápio." };
    const quantidade = Math.floor(Number(p?.quantidade) || 0);
    if (quantidade < 1 || quantidade > 50) return { erro: "Quantidade inválida." };
    const r = calcularItem(item, { variacaoId: p?.variacaoId, escolhas: p?.escolhas }, quando);
    if (r.erro) return r;
    if (item.estoque != null) consumo.itens[item.id] = (consumo.itens[item.id] ?? 0) + quantidade;
    for (const [oid, q] of Object.entries(r.consumo)) consumo.opcoes[oid] = (consumo.opcoes[oid] ?? 0) + q * quantidade;
    linhas.push({
      itemId: item.id, nome: item.nome, categoria: item.categoria, estacao: item.estacao ?? null, variacao: r.variacao, quantidade,
      base: r.baseC / 100, adicionais: r.adicionaisC / 100, unitario: r.unitarioC / 100, opcoes: r.opcoes.map(({ cobradoGrupoC, ...o }) => o),
      total: (r.unitarioC * quantidade) / 100, observacao: txt(p?.observacao, 140), dataCardapio: quando.data ?? null,
    });
  }
  // Estoque do pedido inteiro (item e opção), conferido antes de reservar.
  for (const [iid, q] of Object.entries(consumo.itens)) { const i = cardapioDaLoja.find((x) => x.id === iid); if (q > i.estoque) return { erro: i.estoque ? `Só restam ${i.estoque} de ${i.nome}.` : `${i.nome} esgotou.` }; }
  for (const [oid, q] of Object.entries(consumo.opcoes)) {
    const o = cardapioDaLoja.flatMap((i) => i.grupos.flatMap((g) => g.opcoes)).find((x) => x.id === oid);
    if (q > o.estoque) return { erro: o.estoque ? `Só restam ${o.estoque} de ${o.nome}.` : `${o.nome} esgotou.` };
  }
  const subtotalC = linhas.reduce((s, l) => s + Math.round(l.total * 100), 0);
  return { itens: linhas, subtotal: subtotalC / 100, consumo };
}

/** Reserva (sinal 1) ou devolve (sinal -1) o estoque do pedido. Síncrono: dois pedidos não pegam a mesma unidade. */
export function moverEstoqueFood(cardapioDaLoja, consumo, sinal) {
  for (const [iid, q] of Object.entries(consumo?.itens ?? {})) { const i = cardapioDaLoja.find((x) => x.id === iid); if (i && i.estoque != null) i.estoque = Math.max(0, i.estoque - sinal * q); }
  const opcoes = cardapioDaLoja.flatMap((i) => i.grupos.flatMap((g) => g.opcoes));
  for (const [oid, q] of Object.entries(consumo?.opcoes ?? {})) { const o = opcoes.find((x) => x.id === oid); if (o && o.estoque != null) o.estoque = Math.max(0, o.estoque - sinal * q); }
}

/** Leitura da composição: ["Tamanho: Grande", "Sabores: Calabresa, Frango", "SEM: cebola", "Adicionais: 2x Queijo"]. */
export function opcoesAgrupadas(opcoes = [], variacao = null) {
  const m = new Map();
  for (const o of opcoes) {
    const k = o.tipo === "remover" ? "SEM" : o.grupo;
    m.set(k, [...(m.get(k) ?? []), `${(o.qtd ?? 1) > 1 ? `${o.qtd}x ` : ""}${o.nome}`]);
  }
  return [...(variacao ? [`Tamanho: ${variacao.nome}`] : []), ...[...m].map(([g, n]) => `${g}: ${n.join(", ")}`)];
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
    itens: pedido.itens.map((i) => ({ quantidade: i.quantidade, nome: i.nome, opcoes: opcoesAgrupadas(i.opcoes, i.variacao), observacao: i.observacao, ...(cozinha ? {} : { total: i.total }) })),
    observacao: c.observacao ?? "",
    ...(cozinha ? {} : { subtotal: pedido.subtotal, taxaEntrega: pedido.entrega?.valor ?? 0, desconto: pedido.desconto ?? 0, total: pedido.valorTotal, pagamento: pedido.pagamentoForma, situacaoPagamento: pedido.status === "approved" ? "PAGO" : pedido.status === "na_entrega" ? "COBRAR NA ENTREGA" : "PENDENTE" }),
  };
}
