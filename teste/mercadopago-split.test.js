import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";

// Valores aleatórios gerados no teste: nada com formato de credencial fica no repositório.
const aleatorio = () => randomBytes(12).toString("hex");
const TOKEN_LOJA = aleatorio();
const AMBIENTE_MP = { MP_ACCESS_TOKEN: aleatorio(), MP_CLIENT_ID: "cid", MP_CLIENT_SECRET: aleatorio() };
const ASSINATURA_WEBHOOK = aleatorio();
const quietos = { info() {}, warn() {}, error() {} };

test("split: loja conecta o MP, cobrança sai com o token dela e o webhook de pagamento atualiza o pedido", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-split-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const banco = new Banco(dir);
  banco.lojas.push({
    id: "loja-d", slug: "delly", nome: "Delly", cidade: "Macaíba", whatsapp: "5584999999999", criadaEm: agora, testeAte: agora,
    modeloCobranca: "comissao_fixa", comissaoPorVenda: 1, mpOauth: { state: "estado-1", em: agora },
  });
  banco.produtos.push({ id: "p1", lojaId: "loja-d", nome: "Laço", dept: "moda", preco: 9.5, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.produtos.push({ id: "p1b", lojaId: "loja-d", nome: "Tiara", dept: "moda", preco: 12, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.salvar();

  const chamadas = [];
  let referenciaPix = null;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url), corpo = init.body ? JSON.parse(init.body) : null;
    chamadas.push({ u, auth: init.headers?.Authorization, idem: init.headers?.["X-Idempotency-Key"], corpo });
    const ok = (d) => ({ ok: true, json: async () => d });
    if (u.endsWith("/oauth/token")) return ok({ user_id: 123, access_token: TOKEN_LOJA, refresh_token: aleatorio(), expires_in: 15552000 });
    if (u.endsWith("/checkout/preferences")) return ok({ id: "pref1", init_point: "https://mp.example/checkout" });
    if (u.endsWith("/v1/payments")) { referenciaPix = corpo.external_reference; return ok({ id: 99, status: "pending" }); }
    if (u.endsWith("/v1/payments/99")) return ok({ id: 99, status: "approved", external_reference: referenciaPix });
    if (u.endsWith("/api/sendText")) return ok({ id: "msg" });
    return { ok: false, json: async () => ({}) };
  };
  const env = { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br", ...AMBIENTE_MP };
  env.MP_WEBHOOK_SECRET = ASSINATURA_WEBHOOK;
  const { app, banco: b } = criarApp({ env, fetchImpl, log: quietos });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (caminho, corpo, headers = {}) => fetch(`${base}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(corpo) });
  const autorizacaoDaLoja = ["Bearer", TOKEN_LOJA].join(" ");

  // 1. Volta do OAuth: state válido troca o code e guarda o token cifrado
  const volta = await fetch(`${base}/mercadopago/retorno?code=c1&state=estado-1`, { redirect: "manual" });
  assert.equal(volta.headers.get("location"), "/painel?mp=conectado");
  assert.equal(b.loja("loja-d").mpConta.userId, "123");
  assert.ok(!readFileSync(join(dir, "citshop.json"), "utf8").includes(TOKEN_LOJA), "token não fica em texto puro");
  assert.equal((await fetch(`${base}/mercadopago/retorno?code=c1&state=estado-1`, { redirect: "manual" })).headers.get("location"), "/painel?mp=erro", "state só vale uma vez");

  // 2. Produto da loja que paga por venda e conectou o MP pode ser comprado no site
  const vitrine = await (await fetch(`${base}/api/vitrine`)).json();
  assert.equal(vitrine.produtos.find((p) => p.id === "l-p1").compraOnline, true);
  const comprador = { nome: "Ana Cliente", whatsapp: "(84) 98888-7777", receber: "entrega", endereco: "Rua A, 10, Centro, Macaíba", observacao: "cor: Rosa" };
  assert.equal((await post("/api/pagamento/split", { produtoId: "l-p1" })).status, 400, "sem dados do comprador");
  assert.equal((await post("/api/pagamento/split", { produtoId: "l-p1", comprador: { ...comprador, endereco: "" } })).status, 400, "entrega sem endereço");

  // 2b. Loja que paga por venda vende só pelo Mercado Pago: sem pedido pelo WhatsApp e sem o número no site
  assert.equal(vitrine.produtos.find((p) => p.id === "l-p1").whatsapp, null);
  assert.equal(vitrine.lojas.find((l) => l.slug === "delly").whatsapp, null);
  assert.equal((await post("/api/pedidos/whatsapp", { produtoId: "l-p1", comprador })).status, 409);
  assert.equal((await fetch(`${base}/contato/l-p1`, { redirect: "manual" })).headers.get("location"), "/p/l-p1");
  assert.equal((await fetch(`${base}/contato/loja/delly`, { redirect: "manual" })).headers.get("location"), "/delly");
  const pagina = await (await fetch(`${base}/p/l-p1`)).text();
  assert.ok(pagina.includes("data-comprar=") && !pagina.includes("data-pedir-zap="), "página do produto só com Pix ou cartão");

  // 3. Checkout Pro: token da loja, comissão da CIT, sem sponsor_id, volta para a página do produto
  const r1 = await (await post("/api/pagamento/split", { produtoId: "l-p1", quantidade: 2, comprador })).json();
  assert.equal(r1.initPoint, "https://mp.example/checkout");
  const pref = chamadas.find((c) => c.u.endsWith("/checkout/preferences"));
  assert.equal(pref.auth, autorizacaoDaLoja);
  assert.equal(pref.corpo.marketplace_fee, 2, "R$ 1 por unidade");
  assert.deepEqual([pref.corpo.items[0].unit_price, pref.corpo.items[0].quantity], [9.5, 2]);
  assert.ok(!("sponsor_id" in pref.corpo));
  assert.equal(pref.corpo.back_urls.success, "https://shop.citmax.com.br/p/l-p1?compra=aprovada");
  assert.equal(b.d.pedidos[0].comprador.whatsapp, "5584988887777");

  // 3b. Carrinho da loja: um pagamento com todos os itens, R$ 1 por unidade e volta para /carrinho
  const rc = await post("/api/pagamento/split", { itens: [{ produtoId: "l-p1", quantidade: 2, observacao: "cor: Rosa", preco: 0.01 }, { produtoId: "l-p1b", quantidade: 1 }], comprador });
  assert.equal(rc.status, 200);
  const prefCarrinho = chamadas.filter((c) => c.u.endsWith("/checkout/preferences")).at(-1);
  assert.deepEqual(prefCarrinho.corpo.items.map((i) => [i.title, i.quantity, i.unit_price]), [["Laço (cor: Rosa)", 2, 9.5], ["Tiara", 1, 12]], "preço do servidor, não do aparelho");
  assert.equal(prefCarrinho.corpo.marketplace_fee, 3);
  assert.equal(prefCarrinho.corpo.back_urls.success, "https://shop.citmax.com.br/carrinho?compra=aprovada&loja=loja-d");
  const pedCarrinho = b.d.pedidos.at(-1);
  assert.deepEqual([pedCarrinho.valorTotal, pedCarrinho.quantidade, pedCarrinho.itens.length], [31, 3, 2]);

  // 3. Pix exige e-mail e vai com chave de idempotência
  assert.equal((await post("/api/pagamento/split", { produtoId: "l-p1", metodo: "pix", comprador })).status, 400);
  const r2 = await (await post("/api/pagamento/split", { produtoId: "l-p1", metodo: "pix", emailComprador: "cliente@exemplo.com", comprador })).json();
  assert.equal(r2.pix.id, "99");
  const pix = chamadas.find((c) => c.u.endsWith("/v1/payments"));
  assert.equal(pix.auth, autorizacaoDaLoja);
  assert.equal(pix.idem, referenciaPix);
  assert.equal(pix.corpo.application_fee, 1);

  // 4. Webhook sem assinatura é recusado; assinado, o pedido vira "approved"
  const caminho = "/webhook/mercadopago?loja=loja-d&data.id=99&type=payment";
  assert.equal((await post(caminho, { type: "payment", data: { id: "99" } })).status, 401);
  const ts = "1700000000", rid = "req-1";
  const v1 = createHmac("sha256", ASSINATURA_WEBHOOK).update(`id:99;request-id:${rid};ts:${ts};`).digest("hex");
  assert.equal((await post(caminho, { type: "payment", data: { id: "99" } }, { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid })).status, 200);
  assert.equal(b.d.pedidos.find((p) => p.id === referenciaPix).status, "approved");
  // 5. Venda aprovada: a loja recebe o aviso no WhatsApp com o cliente e o endereço
  await new Promise((r) => setTimeout(r, 30));
  const aviso = chamadas.find((c) => c.u.endsWith("/api/sendText"));
  assert.ok(aviso, "aviso da venda enviado");
  assert.equal(aviso.corpo.chatId, "5584999999999@c.us");
  assert.match(aviso.corpo.text, /Nova venda paga/);
  assert.match(aviso.corpo.text, /Rua A, 10/);
  assert.equal(chamadas.find((c) => c.u.endsWith("/v1/payments/99")).auth, autorizacaoDaLoja);
});

test("split: loja sem conta conectada ou de mensalidade não tem compra no site", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-split2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const banco = new Banco(dir);
  banco.lojas.push({ id: "l2", slug: "l2", nome: "L2", cidade: "Natal", whatsapp: "5584999999999", criadaEm: agora, testeAte: agora, modeloCobranca: "comissao_fixa" });
  banco.produtos.push({ id: "p2", lojaId: "l2", nome: "Item", dept: "moda", preco: 5, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  // Loja de mensalidade, mesmo com conta conectada, vende pelo WhatsApp
  banco.lojas.push({ id: "l3", slug: "l3", nome: "L3", cidade: "Natal", whatsapp: "5584999999999", criadaEm: agora, testeAte: "2999-01-01T00:00:00Z", modeloCobranca: "mensalidade", mpConta: { userId: "1", token: "x", refresh: "x", expiraEm: "2999-01-01T00:00:00Z" } });
  banco.produtos.push({ id: "p3", lojaId: "l3", nome: "Item 3", dept: "moda", preco: 50, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.salvar();
  let chamouMp = false;
  const { app } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ...AMBIENTE_MP },
    fetchImpl: async () => { chamouMp = true; return { ok: true, json: async () => ({}) }; },
    log: quietos,
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/pagamento/split`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ produtoId: "l-p2" }),
  });
  assert.equal(res.status, 409);
  const res3 = await fetch(`http://127.0.0.1:${srv.address().port}/api/pagamento/split`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ produtoId: "l-p3", comprador: { nome: "Ana", whatsapp: "84988887777" } }),
  });
  assert.equal(res3.status, 409, "mensalidade: só WhatsApp");
  const v = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/vitrine`)).json();
  assert.equal(v.produtos.find((p) => p.id === "l-p3").compraOnline, false);
  assert.equal(chamouMp, false);
});
