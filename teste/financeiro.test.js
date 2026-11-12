import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { cifrar } from "../servidor/mercadopago.js";
import { comissaoPorUnidade, retratoFinanceiro, resumoLivro } from "../servidor/financeiro.js";

test("comissão: parceiro paga R$ 1 por unidade; loja de mensalidade nunca paga", () => {
  const parceiro = { modeloCobranca: "comissao_fixa" }, mensal = { modeloCobranca: "mensalidade" };
  for (const [u, esperado] of [[0, 0], [1, 1], [5, 5], [10, 10]]) assert.equal(retratoFinanceiro({ loja: parceiro, unidades: u, valorProdutos: 10 * u }).comissaoTotal, esperado);
  for (const u of [1, 100, 1000]) {
    const r = retratoFinanceiro({ loja: mensal, unidades: u, valorProdutos: 9.9 * u });
    assert.deepEqual([r.comissaoTotal, r.comissaoPorUnidade, r.modelo], [0, 0, "mensal"]);
  }
  assert.equal(comissaoPorUnidade({}), 0, "sem modelo = mensalidade = isenta");
  assert.deepEqual(resumoLivro([{ tipo: "comissao", valor: 5, em: "2026-11-12T00:00:00Z" }, { tipo: "reembolso", valor: -5, em: "2026-11-12T00:00:00Z" }, { tipo: "mensalidade", valor: 49.95, em: "2026-11-12T00:00:00Z" }]).liquido, 49.95);
});

test("financeiro: comissão no livro uma vez, webhook repetido sem efeito, estoque protegido, estorno e chargeback, mensalidade", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-financeiro-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const SEGREDO = "s".repeat(40), WEBHOOK = randomBytes(16).toString("hex"), TOKEN_LOJA = randomBytes(12).toString("hex");
  const agora = new Date().toISOString();
  const banco = new Banco(dir);
  banco.lojas.push({
    id: "parc", slug: "parc", nome: "Parceira", cidade: "Natal", whatsapp: "5584900000002", criadaEm: agora, testeAte: agora,
    modeloCobranca: "comissao_fixa", comissaoPorVenda: 1, modoEstoque: "quantidade",
    mpConta: { userId: "1", token: cifrar(TOKEN_LOJA, SEGREDO), refresh: cifrar("r", SEGREDO), expiraEm: "2999-01-01T00:00:00.000Z" },
  });
  banco.lojas.push({ id: "mensal", slug: "mensal", nome: "Mensal", cidade: "Natal", whatsapp: "5584900000003", criadaEm: agora, testeAte: "2999-01-01T00:00:00Z", assinatura: { status: "authorized", preapprovalId: "pa-mensal" }, plano: { codigo: "mensal", precoContratado: 49.95 } });
  banco.produtos.push({ id: "laco", lojaId: "parc", nome: "Laço", dept: "moda", preco: 10, estoque: 20, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.salvar();

  const pagamentos = {}; // id do pagamento -> { status, ref }
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/checkout/preferences")) return Response.json({ id: "pref", init_point: "https://mp.test/checkout" });
    const pg = u.match(/\/v1\/payments\/(\w+)$/);
    if (pg) return Response.json({ id: pg[1], status: pagamentos[pg[1]].status, external_reference: pagamentos[pg[1]].ref });
    if (u.endsWith("/authorized_payments/ap1")) return Response.json({ id: "ap1", preapproval_id: "pa-mensal", transaction_amount: 49.95, status: "processed", payment: { id: 777, status: "approved" } });
    return Response.json({});
  };
  const { app, banco: b } = criarApp({
    env: { SESSAO_SEGREDO: SEGREDO, DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br", MP_ACCESS_TOKEN: "plataforma", MP_CLIENT_ID: "cli", MP_CLIENT_SECRET: randomBytes(8).toString("hex"), MP_WEBHOOK_SECRET: WEBHOOK },
    fetchImpl, log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 0;
  const post = (caminho, corpo, headers = {}) => fetch(`${base}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.2.0.${++ip}`, ...headers }, body: JSON.stringify(corpo) });
  const webhook = (tipo, id, loja) => {
    const ts = String(Date.now()), rid = `r-${++ip}`;
    const v1 = createHmac("sha256", WEBHOOK).update(`id:${id};request-id:${rid};ts:${ts};`).digest("hex");
    return post(`/webhook/mercadopago?${loja ? `loja=${loja}&` : ""}data.id=${id}&type=${tipo}`, { type: tipo, data: { id } }, { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid });
  };
  const comprador = { nome: "Ana", whatsapp: "84988887777" };
  const comprar = async (quantidade) => {
    assert.equal((await post("/api/pagamento/split", { produtoId: "l-laco", quantidade, comprador, comissao: 0, taxaMarketplace: 0 })).status, 200);
    return b.d.pedidos.at(-1);
  };
  const livro = (filtro) => (b.d.lancamentos ?? []).filter(filtro);

  // 1. Pedido de 5 unidades: retrato com R$ 1 × 5 (valor do aparelho ignorado); nada no livro antes de pagar
  const p1 = await comprar(5);
  assert.deepEqual([p1.financeiro.unidades, p1.financeiro.comissaoPorUnidade, p1.financeiro.comissaoTotal, p1.taxaMarketplace], [5, 1, 5, 5]);
  assert.equal(livro(() => true).length, 0);

  // 2. Recusado: sem comissão e sem baixa de estoque
  pagamentos.pg1 = { status: "rejected", ref: p1.id };
  assert.equal((await webhook("payment", "pg1", "parc")).status, 200);
  assert.deepEqual([livro(() => true).length, b.produto("laco").estoque], [0, 20]);

  // 3. Aprovado: comissão lançada e estoque baixado; o mesmo evento repetido não lança nem baixa de novo
  pagamentos.pg1.status = "approved";
  await webhook("payment", "pg1", "parc");
  await webhook("payment", "pg1", "parc");
  await webhook("payment", "pg1", "parc");
  assert.deepEqual(livro((l) => l.tipo === "comissao").map((l) => [l.valor, l.pedidoId, l.detalhe.unidades]), [[5, p1.id, 5]]);
  assert.equal(b.produto("laco").estoque, 15);

  // 4. Pedido antigo não é recalculado: a comissão combinada muda para R$ 2, o pedido já lançado continua R$ 5
  b.loja("parc").comissaoPorVenda = 2;
  await webhook("payment", "pg1", "parc");
  assert.deepEqual(livro((l) => l.tipo === "comissao").map((l) => l.valor), [5]);
  const p2 = await comprar(1);
  assert.equal(p2.financeiro.comissaoTotal, 2, "pedido novo usa a regra nova");

  // 5. Reembolso: estorno lançado uma vez; estoque devolvido uma vez; histórico preservado
  pagamentos.pg1.status = "refunded";
  await webhook("payment", "pg1", "parc");
  await webhook("payment", "pg1", "parc");
  assert.deepEqual(livro((l) => l.pedidoId === p1.id).map((l) => [l.tipo, l.valor]), [["comissao", 5], ["reembolso", -5]]);
  assert.equal(b.produto("laco").estoque, 20);

  // 6. Chargeback em outro pedido
  pagamentos.pg2 = { status: "approved", ref: p2.id };
  await webhook("payment", "pg2", "parc");
  pagamentos.pg2.status = "charged_back";
  await webhook("payment", "pg2", "parc");
  await webhook("payment", "pg2", "parc");
  assert.deepEqual(livro((l) => l.pedidoId === p2.id).map((l) => [l.tipo, l.valor]), [["comissao", 2], ["chargeback", -2]]);

  // 7. Mensalidade paga entra no livro (uma vez por cobrança)
  await webhook("subscription_authorized_payment", "ap1");
  await webhook("subscription_authorized_payment", "ap1");
  assert.deepEqual(livro((l) => l.tipo === "mensalidade").map((l) => [l.valor, l.lojaId, l.referencia]), [[49.95, "mensal", "777"]]);

  // 8. Webhook sem assinatura válida não mexe em nada; os eventos ficam registrados
  const antes = b.d.lancamentos.length;
  assert.equal((await post("/webhook/mercadopago?loja=parc&data.id=pg1&type=payment", { type: "payment" })).status, 401);
  assert.equal(b.d.lancamentos.length, antes);
  assert.ok(b.d.eventosMp.length >= 10);

  // 9. Loja de mensalidade vendendo pelo WhatsApp: comissão zero no retrato e nada no livro
  b.produtos.push({ id: "m1", lojaId: "mensal", nome: "Item", dept: "moda", preco: 3, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  const ped = await post("/api/pedidos/whatsapp", { itens: [{ produtoId: "l-m1", quantidade: 10 }], comprador });
  assert.equal(ped.status, 200);
  const pw = b.d.pedidos.at(-1);
  assert.deepEqual([pw.financeiro.comissaoTotal, pw.financeiro.modelo], [0, "mensal"]);
  assert.equal(livro((l) => l.lojaId === "mensal" && l.tipo === "comissao").length, 0);
});
