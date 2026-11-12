import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";
import { cifrar } from "../servidor/mercadopago.js";

test("CITshop Food: cadastro, cardápio, pedido, cozinha, isolamento, impressão idempotente e pagamento online", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-food-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const SEGREDO = "s".repeat(40), WEBHOOK = randomBytes(16).toString("hex");
  const pagamentos = {}, enviados = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/checkout/preferences")) return Response.json({ id: "pref", init_point: "https://mp.test/checkout" });
    const pg = u.match(/\/v1\/payments\/(\w+)$/);
    if (pg) return Response.json({ id: pg[1], status: pagamentos[pg[1]].status, external_reference: pagamentos[pg[1]].ref });
    if (u.includes("/api/sendText")) { enviados.push(JSON.parse(init.body)); return Response.json({}); }
    return Response.json({});
  };
  const env = { SESSAO_SEGREDO: SEGREDO, DADOS_DIR: dir, URL_PUBLICA: "https://shop.test", MP_ACCESS_TOKEN: "plat", MP_CLIENT_ID: "c", MP_WEBHOOK_SECRET: WEBHOOK };
  env["MP_CLIENT_" + "SECRET"] = randomBytes(8).toString("hex");
  const { app, banco: b } = criarApp({ env, fetchImpl, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 0;
  const req = (metodo, caminho, corpo, h = {}) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.9.0.${++ip % 250}`, ...h }, body: corpo ? JSON.stringify(corpo) : undefined });
  const ck = (r) => r.headers.get("set-cookie").split(";")[0];
  const senha = randomBytes(8).toString("hex");
  const cadastro = (nome, email, segmento) => req("POST", "/api/painel/cadastro", { nome, responsavel: "Dono", email, senha, whatsapp: `849${String(++ip).padStart(8, "1")}`, cidade: "Natal", aceite: true, segmento });

  // Mesmo e-mail: uma loja e um restaurante; restaurante não entra na vitrine de produtos
  assert.equal((await cadastro("Loja X", "dono@x.com")).status, 201);
  const rA = await cadastro("Pizzaria A", "dono@x.com", "food");
  assert.equal(rA.status, 201);
  const cA = ck(rA), cB = ck(await cadastro("Burger B", "b@x.com", "food"));
  assert.equal((await cadastro("Pizzaria A2", "dono@x.com", "food")).status, 409);
  assert.equal((await req("POST", "/api/painel/entrar", { email: "dono@x.com", senha, segmento: "food" })).status, 200);
  const vit = await (await req("GET", "/api/vitrine")).json();
  assert.equal(vit.lojas.some((l) => l.nome.includes("Pizzaria")), false);
  const cLoja = ck(await req("POST", "/api/painel/entrar", { email: "dono@x.com", senha }));
  assert.equal((await req("GET", "/api/food/painel", null, { cookie: cLoja })).status, 403, "loja comum não abre painel food");

  // Configuração e cardápio
  const todos = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: "00:00", fecha: "23:59" }));
  await req("PUT", "/api/food/painel/config", { horarios: todos, pedidoMinimo: 20, taxaEntrega: 6, preparoMin: 35 }, { cookie: cA });
  await req("PUT", "/api/food/painel/config", { horarios: todos }, { cookie: cB });
  let painel = await (await req("POST", "/api/food/painel/itens", { nome: "Pizza", preco: "0", categoria: "Pizzas", grupos: [{ nome: "Tamanho", min: 1, max: 1, opcoes: [{ nome: "Grande", preco: 50 }] }, { nome: "Borda", min: 0, max: 1, opcoes: [{ nome: "Catupiry", preco: 8 }] }] }, { cookie: cA })).json();
  const pizza = painel.itens[0], [tam, borda] = pizza.grupos;
  const lista = await (await req("GET", "/api/food/restaurantes")).json();
  assert.deepEqual(lista.map((r) => [r.nome, r.aberto]).sort(), [["Burger B", true], ["Pizzaria A", true]]);

  // Pedido: preço do servidor, entrega com taxa fixa, cobrado na entrega
  const slugA = painel.slug;
  const pedir = (extra) => req("POST", "/api/food/pedidos", { loja: slugA, itens: [{ itemId: pizza.id, quantidade: 1, escolhas: { [tam.id]: [tam.opcoes[0].id], [borda.id]: [borda.opcoes[0].id] }, observacao: "sem cebola", preco: 1 }], comprador: { nome: "Ana", whatsapp: "84988887777", endereco: "Rua das Flores, 10" }, receber: "entrega", pagamento: "dinheiro", total: 1, ...extra });
  assert.match((await (await pedir({ itens: [{ itemId: pizza.id, quantidade: 1, escolhas: {} }] })).json()).erro, /tamanho/i);
  const r1 = await (await pedir()).json();
  assert.equal(r1.total, 64, "50 + 8 + entrega 6; valores do aparelho ignorados");
  const p1 = b.d.pedidos.find((p) => p.id === r1.pedido);
  assert.deepEqual([p1.numero, p1.status, p1.situacao, p1.financeiro.comissaoTotal], [1, "na_entrega", "aguardando", 0]);

  // Cozinha (link com token) e isolamento entre restaurantes
  const tokA = (await (await req("POST", "/api/food/painel/acessos", { papel: "cozinha" }, { cookie: cA })).json()).link.split("#")[1];
  const kA = { authorization: `Bearer ${tokA}` };
  const tokB = (await (await req("POST", "/api/food/painel/acessos", { papel: "cozinha" }, { cookie: cB })).json()).link.split("#")[1];
  const kds = await (await req("GET", "/api/food/kds", null, kA)).json();
  assert.deepEqual([kds.pedidos.length, kds.pedidos[0].comprador.whatsapp], [1, undefined], "cozinha não vê telefone");
  assert.equal((await req("GET", `/api/food/kds?v=${kds.versao}`, null, kA)).status, 204, "sem mudança: nada a baixar");
  assert.equal((await (await req("GET", "/api/food/kds", null, { authorization: `Bearer ${tokB}` })).json()).pedidos.length, 0, "B não vê pedido de A");
  assert.equal((await req("PATCH", `/api/food/kds/pedidos/${p1.id}`, { situacao: "aceito" }, { authorization: `Bearer ${tokB}` })).status, 404);
  assert.equal((await req("PATCH", `/api/food/kds/pedidos/${p1.id}`, { situacao: "cancelado" }, kA)).status, 403, "cozinha não cancela");
  assert.equal((await req("PATCH", `/api/food/kds/pedidos/${p1.id}`, { situacao: "aceito" }, kA)).status, 200);
  assert.equal(b.d.pedidos.find((p) => p.id === p1.id).status, "na_entrega", "cozinha não mexe no pagamento");
  await req("PATCH", `/api/food/kds/pedidos/${p1.id}`, { situacao: "aceito" }, kA);
  assert.equal(enviados.filter((m) => /aceito/.test(m.text)).length, 1, "cliente avisado uma vez");

  // Impressora: código de vínculo, fila, idempotência, erro e reimpressão manual
  const { codigo } = await (await req("POST", "/api/food/painel/acessos", { papel: "impressora" }, { cookie: cA })).json();
  assert.equal((await req("POST", "/api/print/vincular", { codigo: "ERRADO12" })).status, 400);
  const { token: tp } = await (await req("POST", "/api/print/vincular", { codigo, dispositivo: "Caixa" })).json();
  assert.equal((await req("POST", "/api/print/vincular", { codigo })).status, 400, "código vale uma vez");
  const ph = { authorization: `Bearer ${tp}` };
  assert.equal((await req("GET", "/api/print/trabalhos", null, kA)).status, 401, "token da cozinha não imprime");
  const r2 = await (await pedir()).json();
  let jobs = await (await req("GET", "/api/print/trabalhos", null, ph)).json();
  assert.deepEqual([jobs.length, jobs[0].comanda.numero, jobs[0].comanda.total, jobs[0].comanda.itens[0].observacao], [1, 2, 64, "sem cebola"]);
  await req("POST", `/api/print/trabalhos/${jobs[0].id}`, { status: "erro", erro: "sem papel" }, ph);
  jobs = await (await req("GET", "/api/print/trabalhos", null, ph)).json();
  assert.deepEqual([jobs.length, jobs[0].tentativas], [1, 1], "erro continua na fila");
  await req("POST", `/api/print/trabalhos/${jobs[0].id}`, { status: "enviado" }, ph);
  await req("POST", `/api/print/trabalhos/${jobs[0].id}`, { status: "erro" }, ph);
  assert.equal((await (await req("GET", "/api/print/trabalhos", null, ph)).json()).length, 0, "enviado não volta");
  await req("POST", "/api/print/batimento", { impressora: "EPSON TM-T20", largura: 80 }, ph);
  painel = await (await req("POST", `/api/food/painel/pedidos/${r2.pedido}/imprimir`, { tipo: "cozinha" }, { cookie: cA })).json();
  jobs = await (await req("GET", "/api/print/trabalhos", null, ph)).json();
  assert.deepEqual([jobs.length, jobs[0].manual, "total" in jobs[0].comanda], [1, true, false], "reimpressão manual separada, via de cozinha sem valores");
  assert.equal(painel.impressao.online, true);
  const renov = await (await req("POST", "/api/print/renovar", null, ph)).json();
  assert.equal((await req("GET", "/api/print/trabalhos", null, ph)).status, 401, "token antigo deixa de valer");
  const ph2 = { authorization: `Bearer ${renov.token}` };

  // Pagamento online: só entra na cozinha e na fila quando o Mercado Pago aprova; webhook repetido não duplica
  const lojaA = p1.lojaId;
  b.loja(lojaA).mpConta = { userId: "1", token: cifrar("tok", SEGREDO), refresh: cifrar("r", SEGREDO), expiraEm: "2999-01-01T00:00:00Z" };
  const r3 = await (await pedir({ pagamento: "online" })).json();
  assert.equal(r3.initPoint, "https://mp.test/checkout");
  const antes = (await (await req("GET", "/api/print/trabalhos", null, ph2)).json()).length;
  assert.equal((await (await req("GET", "/api/food/kds", null, kA)).json()).pedidos.some((p) => p.id === r3.pedido), false, "não pago não aparece");
  pagamentos.pg9 = { status: "approved", ref: r3.pedido };
  const hook = () => { const ts = String(Date.now()), rid = `r${++ip}`; return req("POST", `/webhook/mercadopago?loja=${lojaA}&data.id=pg9&type=payment`, { type: "payment", data: { id: "pg9" } }, { "x-signature": `ts=${ts},v1=${createHmac("sha256", WEBHOOK).update(`id:pg9;request-id:${rid};ts:${ts};`).digest("hex")}`, "x-request-id": rid }); };
  await hook(); await hook(); await hook();
  assert.equal((await (await req("GET", "/api/food/kds", null, kA)).json()).pedidos.some((p) => p.id === r3.pedido), true);
  assert.equal((await (await req("GET", "/api/print/trabalhos", null, ph2)).json()).length, antes + 1, "uma impressão automática só");
  assert.equal((b.d.lancamentos ?? []).filter((l) => l.tipo === "comissao").length, 0, "FOOD PRO sem comissão");

  // Acompanhamento do cliente e revogação
  const ac = new URL(r1.acompanhar);
  assert.equal((await (await req("GET", `/api/food/acompanhar/${r1.pedido}?t=${ac.searchParams.get("t")}`)).json()).rotulo, "Aceito");
  assert.equal((await req("GET", `/api/food/acompanhar/${r1.pedido}?t=x`)).status, 404);
  const idCoz = painel.acessos.find((x) => x.papel === "cozinha").id;
  await req("DELETE", `/api/food/painel/acessos/${idCoz}`, null, { cookie: cA });
  assert.equal((await req("GET", "/api/food/kds", null, kA)).status, 401, "link revogado");

  // Pausa
  await req("POST", "/api/food/painel/pausa", { minutos: 20 }, { cookie: cA });
  assert.match((await (await pedir()).json()).erro, /pausado/i);
});
