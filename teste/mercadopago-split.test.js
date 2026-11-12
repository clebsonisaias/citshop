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

  // 2. Checkout Pro: token da loja, comissão da CIT, sem sponsor_id
  const r1 = await (await post("/api/pagamento/split", { produtoId: "l-p1", quantidade: 2 })).json();
  assert.equal(r1.initPoint, "https://mp.example/checkout");
  const pref = chamadas.find((c) => c.u.endsWith("/checkout/preferences"));
  assert.equal(pref.auth, autorizacaoDaLoja);
  assert.equal(pref.corpo.marketplace_fee, 1);
  assert.equal(pref.corpo.items[0].unit_price, 19);
  assert.ok(!("sponsor_id" in pref.corpo));

  // 3. Pix exige e-mail e vai com chave de idempotência
  assert.equal((await post("/api/pagamento/split", { produtoId: "l-p1", metodo: "pix" })).status, 400);
  const r2 = await (await post("/api/pagamento/split", { produtoId: "l-p1", metodo: "pix", emailComprador: "cliente@exemplo.com" })).json();
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
  assert.equal(chamadas.find((c) => c.u.endsWith("/v1/payments/99")).auth, autorizacaoDaLoja);
});

test("split: loja sem conta conectada não gera cobrança na conta da CIT", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-split2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const banco = new Banco(dir);
  banco.lojas.push({ id: "l2", slug: "l2", nome: "L2", cidade: "Natal", whatsapp: "5584999999999", criadaEm: agora, testeAte: agora, modeloCobranca: "comissao_fixa" });
  banco.produtos.push({ id: "p2", lojaId: "l2", nome: "Item", dept: "moda", preco: 5, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
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
  assert.equal(chamouMp, false);
});
