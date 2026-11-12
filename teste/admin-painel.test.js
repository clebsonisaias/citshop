import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("admin: visão geral com números reais, livro com filtros e registro de auditoria", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-admin-painel-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = Date.parse("2026-11-20T15:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  const DIA = 24 * 60 * 60 * 1000;
  const banco = new Banco(dir);
  const loja = (id, extra) => banco.lojas.push({ id, slug: id, nome: `Loja ${id}`, cidade: "Natal", whatsapp: `55849000000${banco.lojas.length}`, criadaEm: iso(agora - 60 * DIA), testeAte: iso(agora - 30 * DIA), ...extra });
  loja("assin", { assinatura: { status: "authorized", preapprovalId: "p1", jaAutorizada: true }, plano: { codigo: "mensal", precoContratado: 99.9 } });
  loja("fund", { assinatura: { status: "authorized", preapprovalId: "p2", jaAutorizada: true }, plano: { codigo: "mensal", precoContratado: 49.95 }, beneficio: { codigo: "FUNDADOR50", percentual: 50, aplicadoEm: iso(agora - 50 * DIA) } });
  loja("teste", { testeAte: iso(agora + 10 * DIA) });
  loja("vencida", {});
  loja("cancel", { assinatura: { status: "cancelada", preapprovalId: "p3", jaAutorizada: true } });
  loja("parc", { modeloCobranca: "comissao_fixa" });
  loja("susp", { suspensa: true });
  banco.produtos.push({ id: "a1", lojaId: "assin", nome: "A", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: iso(agora) });
  banco.produtos.push({ id: "a2", lojaId: "assin", nome: "B", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, esgotado: true, criadoEm: iso(agora) });
  banco.d.pedidos = [
    { id: "w1", origem: "whatsapp", lojaId: "assin", valorTotal: 30, etapa: "vendido", criadoEm: iso(agora - DIA) },
    { id: "s1", origem: "site", lojaId: "parc", valorTotal: 50, status: "approved", etapa: "novo", criadoEm: iso(agora - DIA) },
    { id: "s2", origem: "site", lojaId: "parc", valorTotal: 20, status: "refunded", etapa: "novo", criadoEm: iso(agora - DIA) },
    { id: "s3", origem: "site", lojaId: "parc", valorTotal: 99, status: "criado", etapa: "novo", criadoEm: iso(agora - DIA) },
  ];
  const lanc = (tipo, valor, em, extra = {}) => ({ id: randomBytes(4).toString("hex"), chave: randomBytes(4).toString("hex"), tipo, valor, moeda: "BRL", em: iso(em), lojaId: null, pedidoId: null, ...extra });
  banco.d.lancamentos = [
    lanc("mensalidade", 99.9, agora - 40 * DIA, { lojaId: "assin" }), // mês passado
    lanc("mensalidade", 99.9, agora - 5 * DIA, { lojaId: "assin" }),
    lanc("mensalidade", 49.95, agora - 4 * DIA, { lojaId: "fund" }),
    lanc("comissao", 5, agora - 2 * DIA, { lojaId: "parc", pedidoId: "s1" }),
    lanc("comissao", 2, agora - 2 * DIA, { lojaId: "parc", pedidoId: "s2" }),
    lanc("reembolso", -2, agora - DIA, { lojaId: "parc", pedidoId: "s2" }),
  ];
  banco.salvar();
  const senhaAdmin = randomBytes(8).toString("hex");
  const { app, banco: b } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdmin) }, agora: () => agora, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });

  for (const rota of ["/api/admin/dashboard", "/api/admin/financeiro", "/api/admin/auditoria"]) assert.equal((await fetch(base + rota)).status, 401);
  const admin = (await json("POST", "/api/admin/entrar", { senha: senhaAdmin })).headers.get("set-cookie").split(";")[0];

  const d = await (await json("GET", "/api/admin/dashboard", null, admin)).json();
  assert.deepEqual(d.lojas, { total: 7, ativas: 2, teste: 1, vencidas: 2, parceiras: 1, suspensas: 1, fundadoras: 1, pausadas: 0, canceladas: 1 });
  assert.equal(d.mrr, 149.85, "99,90 + 49,95 (preço contratado de cada uma)");
  assert.deepEqual([d.receitaMes.mensalidade, d.receitaMes.comissao, d.receitaMes.reembolso, d.receitaMes.liquido], [149.85, 7, -2, 154.85]);
  assert.equal(d.receitaTotal.mensalidade, 249.75);
  assert.deepEqual(d.pedidos30, { total: 3, aprovados: 2, reembolsados: 1, vendasLojas: 80 }, "pedido sem pagamento iniciado não conta; venda das lojas não é receita");
  assert.deepEqual(d.produtos, { ativos: 2, semEstoque: 1 });
  assert.deepEqual(d.conversaoTeste, { base: 5, assinaram: 3, percentual: 60 });

  // Livro com filtros
  const comissoes = await (await json("GET", "/api/admin/financeiro?tipo=comissao", null, admin)).json();
  assert.deepEqual([comissoes.total, comissoes.resumo.comissao, comissoes.resumo.liquido], [2, 7, 7]);
  const daParceira = await (await json("GET", "/api/admin/financeiro?lojaId=parc", null, admin)).json();
  assert.deepEqual([daParceira.total, daParceira.resumo.liquido], [3, 5]);
  assert.equal(daParceira.lancamentos[0].lojaNome, "Loja parc");

  // Ações do admin ficam registradas
  await json("POST", "/api/admin/lojas/vencida/suspensa", { suspensa: true }, admin);
  await json("PUT", "/api/admin/lojas/teste/modelo-cobranca", { modeloCobranca: "comissao_fixa" }, admin);
  const aud = await (await json("GET", "/api/admin/auditoria", null, admin)).json();
  assert.deepEqual(aud.slice(0, 2).map((x) => [x.acao, x.detalhe.lojaId]), [["loja_modelo_cobranca", "teste"], ["loja_suspensa", "vencida"]]);
  assert.equal(b.loja("vencida").suspensa, true);
});
