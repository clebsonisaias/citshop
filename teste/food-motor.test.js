import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { calcularItem, precoMinimo } from "../publico/food-preco.js";
import { comandaDe, lerItem, montarItens, moverEstoqueFood, opcoesAgrupadas } from "../servidor/food-regras.js";
import { criarApp } from "../servidor/app.js";
import { comandaEscPos } from "../citshop-print/src/escpos.js";

// Monta um item como o painel mandaria e devolve { item, g(nome), o(grupo, opção) } para escrever as escolhas.
function montar(b) {
  const r = lerItem(b);
  assert.ok(!r.erro, r.erro);
  const item = { id: "it", ativo: true, ...r.item };
  const g = (nome) => item.grupos.find((x) => x.nome === nome);
  const o = (grupo, nome) => g(grupo).opcoes.find((x) => x.nome === nome).id;
  const v = (nome) => item.variacoes.find((x) => x.nome === nome).id;
  return { item, g, o, v };
}
const sel = (pares) => Object.fromEntries(Object.entries(pares).map(([gid, lista]) => [gid, Object.fromEntries(lista.map((x) => (Array.isArray(x) ? x : [x, 1])))]));

test("motor: sem personalização, obrigatório, opcional, única, múltipla, mínimo, máximo, preço adicional, quantidade por opção", () => {
  const simples = montar({ nome: "Água", preco: "4,50" });
  assert.equal(calcularItem(simples.item, {}).unitarioC, 450, "1. produto sem personalização");

  const { item, g, o } = montar({ nome: "Lanche", preco: "20", grupos: [
    { nome: "Pão", min: 1, max: 1, opcoes: [{ nome: "Brioche" }, { nome: "Australiano", preco: 2 }] },
    { nome: "Molhos", min: 0, max: 3, opcoes: [{ nome: "Barbecue" }, { nome: "Mostarda" }, { nome: "Maionese verde" }, { nome: "Picante" }] },
    { nome: "Adicionais", min: 0, max: 4, opcoes: [{ nome: "Bacon", preco: "4", maxQtd: 2 }, { nome: "Queijo", preco: "3", maxQtd: 3 }] },
    { nome: "Acompanhamentos", min: 2, max: 3, opcoes: [{ nome: "Fritas" }, { nome: "Salada" }, { nome: "Onion" }] },
  ] });
  const base = { [g("Pão").id]: [o("Pão", "Brioche")], [g("Acompanhamentos").id]: [o("Acompanhamentos", "Fritas"), o("Acompanhamentos", "Salada")] };
  assert.match(calcularItem(item, { escolhas: sel({ [g("Acompanhamentos").id]: base[g("Acompanhamentos").id] }) }).erro, /pão/i, "2. grupo obrigatório");
  assert.equal(calcularItem(item, { escolhas: sel(base) }).unitarioC, 2000, "3. opcional pode ficar vazio");
  assert.match(calcularItem(item, { escolhas: sel({ ...base, [g("Pão").id]: [o("Pão", "Brioche"), o("Pão", "Australiano")] }) }).erro, /no máximo 1/, "4. seleção única");
  assert.ok(!calcularItem(item, { escolhas: sel({ ...base, [g("Molhos").id]: [o("Molhos", "Barbecue"), o("Molhos", "Mostarda"), o("Molhos", "Picante")] }) }).erro, "5. múltipla");
  assert.match(calcularItem(item, { escolhas: sel({ ...base, [g("Acompanhamentos").id]: [o("Acompanhamentos", "Fritas")] }) }).erro, /pelo menos 2/, "6. mínimo");
  assert.match(calcularItem(item, { escolhas: sel({ ...base, [g("Molhos").id]: [o("Molhos", "Barbecue"), o("Molhos", "Mostarda"), o("Molhos", "Picante"), o("Molhos", "Maionese verde")] }) }).erro, /no máximo 3/, "7. máximo");
  const r = calcularItem(item, { escolhas: sel({ ...base, [g("Pão").id]: [o("Pão", "Australiano")], [g("Adicionais").id]: [[o("Adicionais", "Bacon"), 2], [o("Adicionais", "Queijo"), 1]] }) });
  assert.deepEqual([r.baseC, r.adicionaisC, r.unitarioC], [2000, 1300, 3300], "8/9/15. 20 + pão 2 + 2x bacon 8 + queijo 3");
  assert.match(calcularItem(item, { escolhas: sel({ ...base, [g("Adicionais").id]: [[o("Adicionais", "Bacon"), 3]] }) }).erro, /No máximo 2 de Bacon/, "9. limite por opção");
  assert.match(calcularItem(item, { escolhas: sel({ ...base, [g("Adicionais").id]: [[o("Adicionais", "Queijo"), 3], [o("Adicionais", "Bacon"), 2]] }) }).erro, /no máximo 4/, "limite do grupo conta as unidades");
});

test("motor: marmitas de restaurantes diferentes, variações com regras próprias e proteínas incluídas", () => {
  // Restaurante A: 1 proteína, até 3 acompanhamentos. Restaurante B: 2 proteínas, até 4. Sem nada fixo no código.
  const A = montar({ nome: "Marmita", preco: "18", grupos: [{ nome: "Proteínas", min: 1, max: 1, opcoes: [{ nome: "Frango" }, { nome: "Carne" }] }, { nome: "Acompanhamentos", min: 1, max: 3, opcoes: [{ nome: "Arroz" }, { nome: "Feijão" }, { nome: "Farofa" }, { nome: "Salada" }] }] });
  const B = montar({ nome: "Marmita", preco: "22", grupos: [{ nome: "Proteínas", min: 2, max: 2, opcoes: [{ nome: "Frango" }, { nome: "Carne" }, { nome: "Peixe" }] }, { nome: "Acompanhamentos", min: 1, max: 4, opcoes: [{ nome: "Arroz" }, { nome: "Feijão" }, { nome: "Farofa" }, { nome: "Salada" }] }] });
  const acomp = (M, n) => ({ [M.g("Acompanhamentos").id]: ["Arroz", "Feijão", "Farofa", "Salada"].slice(0, n).map((x) => M.o("Acompanhamentos", x)) });
  assert.ok(!calcularItem(A.item, { escolhas: sel({ [A.g("Proteínas").id]: [A.o("Proteínas", "Frango")], ...acomp(A, 3) }) }).erro, "11. uma proteína");
  assert.match(calcularItem(A.item, { escolhas: sel({ [A.g("Proteínas").id]: [A.o("Proteínas", "Frango"), A.o("Proteínas", "Carne")], ...acomp(A, 3) }) }).erro, /no máximo 1/);
  assert.match(calcularItem(B.item, { escolhas: sel({ [B.g("Proteínas").id]: [B.o("Proteínas", "Frango")], ...acomp(B, 4) }) }).erro, /pelo menos 2/, "12. duas obrigatórias");
  assert.ok(!calcularItem(B.item, { escolhas: sel({ [B.g("Proteínas").id]: [B.o("Proteínas", "Frango"), B.o("Proteínas", "Peixe")], ...acomp(B, 4) }) }).erro, "13. 4 acompanhamentos em B");
  assert.match(calcularItem(A.item, { escolhas: sel({ [A.g("Proteínas").id]: [A.o("Proteínas", "Frango")], ...acomp(A, 4) }) }).erro, /no máximo 3/);

  // 10. Variações: P = 1 proteína/3 acomp. · M = até 2 proteínas/4 · G = até 2/5 e proteína premium mais barata
  const V = montar({ nome: "Marmita", variacoes: [{ nome: "P", preco: "16" }, { nome: "M", preco: "20" }, { nome: "G", preco: "25" }],
    grupos: [{ nome: "Proteínas", min: 1, max: 1, incluidas: 1, opcoes: [{ nome: "Frango" }, { nome: "Picanha", preco: "8" }] },
      { nome: "Acompanhamentos", min: 1, max: 3, opcoes: ["Arroz", "Feijão", "Farofa", "Salada", "Purê"].map((nome) => ({ nome })) }] });
  const gp = V.g("Proteínas").id, ga = V.g("Acompanhamentos").id;
  const item = lerItem({ ...V.item, variacoes: [{ id: V.v("P"), nome: "P", preco: "16" }, { id: V.v("M"), nome: "M", preco: "20", grupos: { [gp]: { max: 2 }, [ga]: { max: 4 } } }, { id: V.v("G"), nome: "G", preco: "25", grupos: { [gp]: { max: 2, precos: { [V.o("Proteínas", "Picanha")]: "5" } }, [ga]: { max: 5 } } }] }).item;
  item.id = "v"; item.ativo = true;
  const duas = { [gp]: [V.o("Proteínas", "Frango"), V.o("Proteínas", "Picanha")] };
  assert.match(calcularItem(item, { escolhas: sel(duas) }).erro, /tamanho/, "variação obrigatória quando existe");
  assert.match(calcularItem(item, { variacaoId: V.v("P"), escolhas: sel({ ...duas, [ga]: [V.o("Acompanhamentos", "Arroz")] }) }).erro, /no máximo 1/);
  const m = calcularItem(item, { variacaoId: V.v("M"), escolhas: sel({ ...duas, [ga]: ["Arroz", "Feijão", "Farofa", "Salada"].map((x) => V.o("Acompanhamentos", x)) }) });
  assert.deepEqual([m.unitarioC, m.variacao.nome], [2000, "M"], "a incluída é a mais cara (picanha): sem custo");
  const g2 = calcularItem(item, { variacaoId: V.v("G"), escolhas: sel({ [gp]: [[V.o("Proteínas", "Picanha"), 1]], [ga]: ["Arroz", "Feijão", "Farofa", "Salada", "Purê"].map((x) => V.o("Acompanhamentos", x)) }) });
  assert.equal(g2.unitarioC, 2500, "G aceita 5 acompanhamentos");
  assert.match(calcularItem(item, { variacaoId: "ffffffff", escolhas: {} }).erro, /tamanho/, "variação de outro produto");
  assert.equal(precoMinimo(item) / 100, 16);
});

test("motor: pizza com regra de sabores do restaurante, açaí, combo e opção de remover", () => {
  for (const [regra, esperado] of [["maior", 5800], ["media", 5300], ["soma", 9600]]) {
    const P = montar({ nome: "Pizza", variacoes: [{ nome: "Grande", preco: "10" }], grupos: [{ nome: "Sabores", min: 1, max: 2, regra, opcoes: [{ nome: "Calabresa", preco: "38" }, { nome: "Camarão", preco: "48" }] }, { nome: "Borda", min: 0, max: 1, opcoes: [{ nome: "Catupiry", preco: "0" }] }] });
    const r = calcularItem(P.item, { variacaoId: P.v("Grande"), escolhas: sel({ [P.g("Sabores").id]: [P.o("Sabores", "Calabresa"), P.o("Sabores", "Camarão")] }) });
    assert.equal(r.unitarioC, esperado, `14. pizza 2 sabores, regra ${regra}`);
  }
  const A = montar({ nome: "Açaí", variacoes: [{ nome: "300 ml", preco: "12" }, { nome: "500 ml", preco: "18" }], grupos: [
    { nome: "Complementos", min: 0, max: 4, incluidas: 3, opcoes: ["Leite em pó", "Granola", "Paçoca", "Banana", "Morango"].map((nome) => ({ nome, preco: "2" })) },
    { nome: "Coberturas", min: 0, max: 1, opcoes: [{ nome: "Nutella", preco: "6" }] }] });
  const r = calcularItem(A.item, { variacaoId: A.v("500 ml"), escolhas: sel({ [A.g("Complementos").id]: ["Leite em pó", "Granola", "Paçoca", "Banana"].map((x) => A.o("Complementos", x)), [A.g("Coberturas").id]: [A.o("Coberturas", "Nutella")] }) });
  assert.equal(r.unitarioC, 1800 + 200 + 600, "16. 3 complementos incluídos, o 4º cobra");
  const C = montar({ nome: "Combo", preco: "35", grupos: [
    { nome: "Hambúrguer", min: 1, max: 1, opcoes: [{ nome: "Clássico" }, { nome: "Duplo", preco: "6" }] },
    { nome: "Bebida", min: 1, max: 1, opcoes: [{ nome: "Refri lata" }, { nome: "Suco", preco: "2" }] },
    { nome: "Sobremesa", min: 0, max: 1, opcoes: [{ nome: "Brownie", preco: "7" }] },
    { nome: "Retirar ingredientes", tipo: "remover", min: 0, max: 3, opcoes: [{ nome: "cebola" }, { nome: "picles" }] }] });
  const c = calcularItem(C.item, { escolhas: sel({ [C.g("Hambúrguer").id]: [C.o("Hambúrguer", "Duplo")], [C.g("Bebida").id]: [C.o("Bebida", "Suco")], [C.g("Retirar ingredientes").id]: [C.o("Retirar ingredientes", "cebola")] }) });
  assert.equal(c.unitarioC, 4300, "17. combo com grupos independentes");
  assert.deepEqual(opcoesAgrupadas(c.opcoes), ["Hambúrguer: Duplo", "Bebida: Suco", "SEM: cebola"], "remoção destacada");
});

test("motor: cardápio do dia, esgotado, estoque do pedido inteiro e reserva sem corrida", () => {
  const M = montar({ nome: "Prato do dia", preco: "19", datas: ["2026-11-13"], estoque: 2, grupos: [{ nome: "Proteína", min: 1, max: 1, opcoes: [{ nome: "Galinha caipira", datas: ["2026-11-13"], estoque: 3 }, { nome: "Bife", estoque: 0 }] }] });
  const escolha = { [M.g("Proteína").id]: [M.o("Proteína", "Galinha caipira")] };
  assert.match(calcularItem(M.item, { escolhas: sel(escolha) }, { data: "2026-11-14" }).erro, /não está disponível/, "18. fora do dia");
  assert.ok(!calcularItem(M.item, { escolhas: sel(escolha) }, { data: "2026-11-13" }).erro);
  assert.match(calcularItem(M.item, { escolhas: sel({ [M.g("Proteína").id]: [M.o("Proteína", "Bife")] }) }, { data: "2026-11-13" }).erro, /Bife .*não está disponível/, "19. opção esgotada");
  const cardapio = [M.item];
  assert.match(montarItens(cardapio, [{ itemId: "it", quantidade: 3, escolhas: escolha }], { data: "2026-11-13" }).erro, /Só restam 2/);
  const a = montarItens(cardapio, [{ itemId: "it", quantidade: 2, escolhas: escolha }], { data: "2026-11-13" });
  moverEstoqueFood(cardapio, a.consumo, 1); // primeiro cliente reserva
  assert.match(montarItens(cardapio, [{ itemId: "it", quantidade: 1, escolhas: escolha }], { data: "2026-11-13" }).erro, /esgotou/, "23. segundo cliente não leva a última unidade");
  moverEstoqueFood(cardapio, a.consumo, -1); // cancelado: devolve
  assert.deepEqual([M.item.estoque, M.g("Proteína").opcoes[0].estoque], [2, 3]);
});

test("motor ponta a ponta: manipulação de preço, isolamento, alteração depois da compra, retrato imutável, cozinha, comanda, modelos e cardápio do dia", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-motor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { app, banco: b } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 0;
  const req = (m, p, c, h = {}) => fetch(base + p, { method: m, headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.7.0.${++ip % 250}`, ...h }, body: c ? JSON.stringify(c) : undefined });
  const senha = randomBytes(8).toString("hex");
  const conta = async (nome, email) => (await req("POST", "/api/painel/cadastro", { nome, responsavel: "D", email, senha, whatsapp: `8498888${String(++ip).padStart(4, "0")}`, cidade: "Natal", aceite: true, segmento: "food" })).headers.get("set-cookie").split(";")[0];
  const cA = await conta("Marmitaria A", "a@x.com"), cB = await conta("Marmitaria B", "b@x.com");
  const todos = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: "00:00", fecha: "23:59" }));
  for (const c of [cA, cB]) await req("PUT", "/api/food/painel/config", { horarios: todos }, { cookie: c });

  // Modelo reutilizável aplicado a dois produtos; editar o modelo não muda produto sem pedir
  let p = await (await req("POST", "/api/food/painel/modelos", { nome: "Marmita tradicional", grupos: [{ nome: "Proteínas", min: 1, max: 1, opcoes: [{ nome: "Frango" }, { nome: "Carne", preco: "3" }] }] }, { cookie: cA })).json();
  const modelo = p.modelos[0];
  for (const nome of ["Marmita P", "Marmita G"]) p = await (await req("POST", "/api/food/painel/itens", { nome, preco: nome.endsWith("P") ? "15" : "20", grupos: modelo.grupos, modeloId: modelo.id, estoque: 5 }, { cookie: cA })).json();
  const mp = p.itens.find((i) => i.nome === "Marmita P");
  const gP = mp.grupos[0], frango = gP.opcoes.find((o) => o.nome === "Frango").id, carne = gP.opcoes.find((o) => o.nome === "Carne").id;
  const r1 = await req("PUT", `/api/food/painel/modelos/${modelo.id}`, { nome: "Marmita tradicional", grupos: [{ nome: "Proteínas", min: 1, max: 2, opcoes: [{ nome: "Frango" }, { nome: "Carne", preco: "4" }, { nome: "Peixe" }] }] }, { cookie: cA });
  assert.equal((await r1.json()).aplicados, 0);
  assert.equal(b.d.cardapio.find((i) => i.id === mp.id).grupos[0].opcoes.length, 2, "sem pedir, produto publicado não muda");

  // 24. Manipulação: preço, total, grupo e opção forjados; produto de outro restaurante (25)
  const slugA = p.slug;
  const pedir = (itens, extra = {}) => req("POST", "/api/food/pedidos", { loja: slugA, receber: "retirada", pagamento: "dinheiro", itens, comprador: { nome: "Ana Paula", whatsapp: "84999990000" }, ...extra });
  const ok = await (await pedir([{ itemId: mp.id, quantidade: 2, escolhas: { [gP.id]: { [carne]: 1 } }, preco: 0.01, unitario: 0.01, total: 0.01 }], { total: 1, subtotal: 1 })).json();
  assert.equal(ok.total, 36, "2 x (15 + carne 3); valores do aparelho ignorados");
  assert.match((await (await pedir([{ itemId: mp.id, quantidade: 1, escolhas: { [gP.id]: { [carne]: 1 }, ffffffff: { aaaaaaaa: 1 } } }])).json()).erro, /não está/, "grupo forjado");
  assert.match((await (await pedir([{ itemId: mp.id, quantidade: 1, escolhas: { [gP.id]: { [carne]: 5 } } }])).json()).erro, /No máximo 1/, "quantidade forjada");
  const pB = await (await req("POST", "/api/food/painel/itens", { nome: "Marmita B", preco: "1" }, { cookie: cB })).json();
  assert.match((await (await pedir([{ itemId: pB.itens[0].id, quantidade: 1 }])).json()).erro, /não está mais no cardápio/, "25. item de outro restaurante");

  // 20/21/22. Alteração de preço e de cardápio depois da compra: pedido antigo não muda
  const pedidoId = ok.pedido;
  await req("PUT", `/api/food/painel/modelos/${modelo.id}`, { nome: "Marmita tradicional", grupos: [{ nome: "Proteínas", min: 1, max: 2, opcoes: [{ nome: "Frango" }, { nome: "Carne", preco: "9" }] }], aplicarEmProdutos: true }, { cookie: cA });
  const atual = b.d.cardapio.find((i) => i.id === mp.id);
  assert.deepEqual([atual.grupos[0].max, atual.grupos[0].opcoes.find((o) => o.nome === "Carne").preco, atual.grupos[0].opcoes.find((o) => o.nome === "Carne").id], [2, 9, carne], "aplicado só quando pedido, mantendo os ids");
  await req("PUT", `/api/food/painel/itens/${mp.id}`, { ...atual, nome: "Marmita P nova", preco: "99" }, { cookie: cA });
  const antigo = b.d.pedidos.find((x) => x.id === pedidoId);
  assert.deepEqual([antigo.itens[0].nome, antigo.itens[0].unitario, antigo.itens[0].opcoes[0].preco, antigo.valorTotal], ["Marmita P", 18, 3, 36]);
  assert.ok(antigo.itens[0].dataCardapio, "data do cardápio no retrato");

  // 26/27. Cozinha e comanda usam o retrato com a composição completa
  const tok = (await (await req("POST", "/api/food/painel/acessos", { papel: "cozinha" }, { cookie: cA })).json()).link.split("#")[1];
  const kds = await (await req("GET", "/api/food/kds", null, { authorization: `Bearer ${tok}` })).json();
  const linha = kds.pedidos.find((x) => x.id === pedidoId).itens[0];
  assert.deepEqual([linha.nome, linha.opcoes[0].nome, linha.opcoes[0].grupo], ["Marmita P", "Carne", "Proteínas"]);
  const esc = comandaEscPos(comandaDe(antigo, { nome: "Marmitaria A" }, "cozinha"), { largura: 58 }).toString("latin1");
  assert.ok(esc.includes("2x Marmita P") && esc.includes("nas: Carne"), "comanda com a composição (CP860)");

  // Estoque: 5 - 2 reservadas; cancelar devolve; não passa do disponível
  assert.equal(b.d.cardapio.find((i) => i.id === mp.id).estoque, 3);
  assert.match((await (await pedir([{ itemId: mp.id, quantidade: 4, escolhas: { [gP.id]: { [frango]: 1 } } }])).json()).erro, /Só restam 3/);
  await req("PATCH", `/api/food/painel/pedidos/${pedidoId}`, { situacao: "cancelado" }, { cookie: cA });
  await req("PATCH", `/api/food/painel/pedidos/${pedidoId}`, { situacao: "cancelado" }, { cookie: cA });
  assert.equal(b.d.cardapio.find((i) => i.id === mp.id).estoque, 5, "devolvido uma vez só");

  // 18. Cardápio do dia: item de outra data não aparece; copiar o dia publica no dia novo
  const hoje = p.hoje, amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  await req("POST", "/api/food/painel/itens", { nome: "Feijoada", preco: "25", datas: [ontem] }, { cookie: cA });
  const vis = async () => (await (await req("GET", `/api/food/restaurantes/${slugA}`)).json()).itens.map((i) => i.nome);
  assert.equal((await vis()).includes("Feijoada"), false);
  const cp = await (await req("POST", "/api/food/painel/cardapio/copiar", { de: ontem, para: hoje }, { cookie: cA })).json();
  assert.equal(cp.copiados, 1);
  assert.equal((await vis()).includes("Feijoada"), true);
  assert.ok(amanha > hoje);

  // 25. Isolamento: B não edita nem vê modelos/itens de A
  assert.equal((await req("PUT", `/api/food/painel/itens/${mp.id}`, { nome: "x", preco: "1" }, { cookie: cB })).status, 404);
  assert.equal((await req("PUT", `/api/food/painel/modelos/${modelo.id}`, { nome: "x", grupos: modelo.grupos }, { cookie: cB })).status, 404);
  assert.equal((await (await req("GET", "/api/food/painel", null, { cookie: cB })).json()).modelos.length, 0);
});
