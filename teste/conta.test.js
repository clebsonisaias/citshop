import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";

test("Minha conta: cadastro, entrar, pedido da praça entra na conta só se feito logado, troca de senha derruba sessões, código no WhatsApp", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-conta-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const zap = [];
  const fetchImpl = async (url, init) => (String(url).includes("/api/sendText") ? (zap.push(JSON.parse(init.body)), Response.json({})) : Response.json({}));
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.test", WAHA_API_URL: "http://waha" }, fetchImpl, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 0;
  const req = (metodo, caminho, corpo, h = {}) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.7.0.${++ip % 250}`, ...h }, body: corpo ? JSON.stringify(corpo) : undefined });
  const ck = (r) => r.headers.get("set-cookie").split(";")[0];
  const senha = randomBytes(8).toString("hex");

  // Restaurante aberto com um item
  const rr = await req("POST", "/api/painel/cadastro", { nome: "Pizzaria", responsavel: "Dono", email: "p@x.com", senha, whatsapp: "84911111111", cidade: "Macaíba", aceite: true, segmento: "food" });
  const cRest = ck(rr);
  await req("PUT", "/api/food/painel/config", { horarios: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: "00:00", fecha: "23:59" })), taxaEntrega: 5 }, { cookie: cRest });
  const painel = await (await req("POST", "/api/food/painel/itens", { nome: "Pizza", preco: "40", categoria: "Pizzas" }, { cookie: cRest })).json();
  const pedir = (cookie) => req("POST", "/api/food/pedidos", { loja: painel.slug, receber: "retirada", pagamento: "dinheiro", itens: [{ itemId: painel.itens[0].id, quantidade: 1, escolhas: {} }], comprador: { nome: "Ana", whatsapp: "84922222222" } }, cookie ? { cookie } : {});

  assert.equal((await req("POST", "/api/conta/cadastro", { nome: "Ana", email: "ana@x.com", senha: "curta", whatsapp: "84922222222", aceite: true })).status, 400);
  const r = await req("POST", "/api/conta/cadastro", { nome: "Ana", email: "Ana@X.com", senha, whatsapp: "(84) 92222-2222", aceite: true, favoritos: ["shopee-1"] });
  assert.equal(r.status, 201);
  let cAna = ck(r);
  assert.equal((await req("POST", "/api/conta/cadastro", { nome: "Ana 2", email: "ana@x.com", senha, whatsapp: "84922222222", aceite: true })).status, 409);
  assert.equal((await req("POST", "/api/conta/entrar", { email: "ana@x.com", senha: "errada123" })).status, 401);
  assert.equal((await req("GET", "/api/conta/eu")).status, 401);

  // Pedido sem conta não entra; com conta entra, com o link de acompanhar
  assert.equal((await pedir()).status, 201);
  assert.equal((await pedir(cAna)).status, 201);
  let eu = await (await req("GET", "/api/conta/eu", null, { cookie: cAna })).json();
  assert.deepEqual([eu.email, eu.favoritos, eu.pedidos.length], ["ana@x.com", ["shopee-1"], 1]);
  assert.match(eu.pedidos[0].acompanhar, /^\/alimentacao\/[a-z0-9-]+\?pedido=food-.+&t=/);
  assert.deepEqual([eu.pedidos[0].loja, eu.pedidos[0].situacao, eu.pedidos[0].total], ["Pizzaria", "Aguardando confirmação", 40]);

  // Endereços e favoritos
  eu = await (await req("PUT", "/api/conta/eu", { enderecos: [{ nome: "Casa", texto: "Rua das Flores, 10, Centro" }, { texto: "curto" }], favoritos: ["a", "a", "b"] }, { cookie: cAna })).json();
  assert.deepEqual([eu.enderecos.map((e) => e.nome), eu.favoritos], [["Casa"], ["a", "b"]]);

  // Trocar a senha derruba as outras sessões
  const cOutro = ck(await req("POST", "/api/conta/entrar", { email: "ana@x.com", senha }));
  const nova = randomBytes(8).toString("hex");
  const tr = await req("PUT", "/api/conta/senha", { atual: senha, nova }, { cookie: cAna });
  assert.equal(tr.status, 200);
  cAna = ck(tr);
  assert.equal((await req("GET", "/api/conta/eu", null, { cookie: cOutro })).status, 401, "sessão antiga caiu");
  assert.equal((await req("GET", "/api/conta/eu", null, { cookie: cAna })).status, 200, "a de quem trocou continua");

  // Esqueci a senha: mesma resposta com ou sem conta; código vai ao WhatsApp da conta; código errado não serve
  const semConta = await (await req("POST", "/api/conta/esqueci", { email: "ninguem@x.com" })).json();
  const comConta = await (await req("POST", "/api/conta/esqueci", { email: "ana@x.com" })).json();
  assert.deepEqual(semConta, comConta);
  assert.equal(zap.filter((m) => m.text.includes("código")).length, 1);
  assert.equal(zap.at(-1).chatId, "5584922222222@c.us");
  const codigo = zap.at(-1).text.match(/\*(\d{6})\*/)[1];
  assert.equal((await req("POST", "/api/conta/redefinir", { email: "ana@x.com", codigo: codigo === "000000" ? "111111" : "000000", senha: "outra-senha-1" })).status, 400);
  const red = await req("POST", "/api/conta/redefinir", { email: "ana@x.com", codigo, senha: "outra-senha-1" });
  assert.equal(red.status, 200);
  assert.equal((await req("POST", "/api/conta/redefinir", { email: "ana@x.com", codigo, senha: "mais-uma-1" })).status, 400, "o código vale uma vez");
  assert.equal((await req("POST", "/api/conta/entrar", { email: "ana@x.com", senha: "outra-senha-1" })).status, 200);
  assert.equal((await req("GET", "/api/conta/eu", null, { cookie: cAna })).status, 401, "redefinir também derruba as sessões antigas");
});
