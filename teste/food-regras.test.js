import test from "node:test";
import assert from "node:assert/strict";
import { comandaDe, lerItem, montarItens, podeMudar, precoItem, situacaoLoja } from "../servidor/food-regras.js";

test("horário: aberto, fechado, passa da meia-noite, pausa, feriado, fechamento manual", () => {
  const food = { horarios: [{ dia: 5, abre: "18:00", fecha: "02:00" }] }; // sexta 18h às 2h
  const sp = (s) => Date.parse(`${s}-03:00`);
  assert.equal(situacaoLoja(food, sp("2026-11-13T19:00:00")).aberto, true, "sexta 19h");
  assert.equal(situacaoLoja(food, sp("2026-11-14T01:30:00")).aberto, true, "sábado 1h30 (turno de sexta)");
  assert.equal(situacaoLoja(food, sp("2026-11-14T02:00:00")).aberto, false);
  assert.equal(situacaoLoja(food, sp("2026-11-13T17:59:00")).aberto, false);
  const t = sp("2026-11-13T20:00:00");
  assert.equal(situacaoLoja({ ...food, pausadoAte: new Date(t + 600000).toISOString() }, t).aberto, false);
  assert.equal(situacaoLoja({ ...food, pausadoAte: new Date(t - 1).toISOString() }, t).aberto, true, "pausa vencida não fecha");
  assert.equal(situacaoLoja({ ...food, feriados: ["2026-11-13"] }, t).aberto, false);
  assert.equal(situacaoLoja({ ...food, fechadoManual: true }, t).aberto, false);
  assert.equal(situacaoLoja({}, t).aberto, false);
});

test("cardápio: pizza com tamanho obrigatório, sabores, borda e adicionais; preço do servidor e retrato", () => {
  const { item } = lerItem({ nome: "Pizza", preco: "0", categoria: "Pizzas", grupos: [
    { nome: "Tamanho", min: 1, max: 1, opcoes: [{ nome: "Média", preco: "40" }, { nome: "Grande", preco: "55,50" }] },
    { nome: "Sabores", min: 1, max: 2, opcoes: [{ nome: "Calabresa" }, { nome: "Frango", preco: 3 }] },
    { nome: "Borda", min: 0, max: 1, opcoes: [{ nome: "Catupiry", preco: 8 }] },
    { nome: "Adicionais", min: 0, max: 3, opcoes: [{ nome: "Queijo", preco: 4 }, { nome: "Bacon", preco: 5, ativo: false }] },
  ] });
  item.id = "pz";
  const [tam, sab, bor, adc] = item.grupos;
  const esc = { [tam.id]: [tam.opcoes[1].id], [sab.id]: [sab.opcoes[0].id, sab.opcoes[1].id], [bor.id]: [bor.opcoes[0].id], [adc.id]: [adc.opcoes[0].id] };
  assert.equal(precoItem(item, esc).unitario, 70.5, "55,50 + 3 + 8 + 4");
  assert.match(precoItem(item, {}).erro, /tamanho/i);
  assert.match(precoItem(item, { ...esc, [sab.id]: [sab.opcoes[0].id, sab.opcoes[1].id, "ffffffff"] }).erro, /não está disponível/, "opção forjada é recusada");
  assert.match(precoItem(item, { ...esc, [adc.id]: [adc.opcoes[1].id] }).erro, /não está disponível/, "opção desativada");
  assert.match(precoItem(item, { ...esc, zzzzzzzz: [] }).erro, /não está mais/);
  const r = montarItens([{ ...item, ativo: true }], [{ itemId: "pz", quantidade: 2, escolhas: esc, observacao: "sem cebola", preco: 1 }]);
  assert.deepEqual([r.subtotal, r.itens[0].unitario, r.itens[0].opcoes.length], [141, 70.5, 5], "preço do aparelho ignorado");
  assert.match(montarItens([], [{ itemId: "x", quantidade: 1 }]).erro, /cardápio/);
  assert.match(lerItem({ nome: "Água", preco: "0" }).erro, /preço/);
  // ids mantidos na edição
  const de_novo = lerItem({ ...item, grupos: item.grupos }).item;
  assert.equal(de_novo.grupos[0].opcoes[1].id, tam.opcoes[1].id);
});

test("situação: cozinha só aceita/prepara/pronto; comanda de cozinha sem valores e sem contato", () => {
  assert.deepEqual(["aceito", "preparo", "pronto", "cancelado", "saiu"].map((s) => podeMudar("cozinha", s)), [true, true, true, false, false]);
  assert.equal(podeMudar("atendente", "cancelado"), true);
  assert.equal(podeMudar("dono", "pago"), false);
  const pedido = { id: "f1", numero: 7, criadoEm: "2026-11-13T20:00:00Z", receber: "entrega", comprador: { nome: "Ana", whatsapp: "5584999990000", endereco: "Rua A, 1" },
    itens: [{ quantidade: 1, nome: "Pizza", opcoes: [{ grupo: "Sabor", nome: "Calabresa" }], observacao: "sem cebola", total: 50 }], subtotal: 50, entrega: { valor: 5 }, valorTotal: 55, status: "na_entrega", pagamentoForma: "dinheiro" };
  const coz = comandaDe(pedido, { nome: "Pizzaria" }, "cozinha");
  assert.equal(JSON.stringify(coz).includes("5584999990000") || JSON.stringify(coz).includes("Rua A") || "total" in coz, false);
  const comp = comandaDe(pedido, { nome: "Pizzaria" }, "completa");
  assert.deepEqual([comp.total, comp.situacaoPagamento, comp.endereco], [55, "COBRAR NA ENTREGA", "Rua A, 1"]);
});
