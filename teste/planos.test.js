import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";
import { cnpjNormalizado, estadoAssinatura, precoComDesconto } from "../servidor/planos.js";

const DIA = 24 * 60 * 60 * 1000;

test("planos: contas de centavo, CNPJ e estados do Mercado Pago", () => {
  assert.equal(precoComDesconto(99.9, 50), 49.95);
  assert.equal(precoComDesconto(120, 50), 60);
  assert.equal(cnpjNormalizado("11.222.333/0001-81"), "11222333000181");
  assert.equal(cnpjNormalizado("11.222.333/0001-80"), null, "dígito verificador errado");
  assert.equal(cnpjNormalizado("11111111111111"), null);
  assert.deepEqual(["authorized", "pending", "paused", "cancelled"].map(estadoAssinatura), ["authorized", "pendente", "pausada", "cancelada"]);
});

test("modelo comercial: R$ 99,90, FUNDADOR50 a R$ 49,95 para sempre, campanha de 90 dias, sem duplicidade, pausa e cancelamento", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-planos-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let relogio = Date.parse("2026-11-12T12:00:00Z");
  // Loja que já assinava antes do 2.0 (sem plano gravado) e uma parceira
  const banco = new Banco(dir);
  banco.lojas.push({ id: "antiga", slug: "antiga", nome: "Loja Antiga", email: "antiga@loja.com", senhaHash: gerarHashSenha("x".repeat(12)), cidade: "Natal", whatsapp: "5584900000001", criadaEm: "2026-01-01T00:00:00Z", testeAte: "2026-01-31T00:00:00Z", assinatura: { status: "authorized", preapprovalId: "pa-antiga" } });
  banco.lojas.push({ id: "parc", slug: "parc", nome: "Parceira", email: "parc@loja.com", senhaHash: gerarHashSenha("x".repeat(12)), cidade: "Natal", whatsapp: "5584900000002", criadaEm: "2026-01-01T00:00:00Z", testeAte: "2026-01-31T00:00:00Z", modeloCobranca: "comissao_fixa" });
  banco.salvar();

  const senhaAdmin = randomBytes(8).toString("hex"), senha = randomBytes(8).toString("hex");
  const preapprovals = []; const statusPa = {};
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/preapproval") && init.method === "POST") {
      const corpo = JSON.parse(init.body); const id = `pa-${preapprovals.length + 1}`;
      preapprovals.push({ id, corpo }); statusPa[id] = "pending";
      return Response.json({ id, init_point: `https://mp.test/${id}` });
    }
    const m = u.match(/\/preapproval\/([\w-]+)$/);
    if (m) return Response.json({ id: m[1], status: statusPa[m[1]] ?? "authorized", external_reference: null });
    return Response.json({});
  };
  const { app, banco: b, sincronizarAssinaturas } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdmin), MP_ACCESS_TOKEN: "teste" },
    agora: () => relogio, fetchImpl, log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 0;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.1.0.${++ip}`, ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const cookieDe = (r) => r.headers.get("set-cookie").split(";")[0];
  const cadastrar = (extra) => json("POST", "/api/painel/cadastro", { nome: "Loja", responsavel: "Dona", email: `${randomBytes(4).toString("hex")}@loja.com`, whatsapp: `849${String(9000000 + ip).padStart(8, "0")}`, cidade: "Natal", senha, aceite: true, ...extra });
  let admin = cookieDe(await json("POST", "/api/admin/entrar", { senha: senhaAdmin }));

  // Assinante antigo mantém o preço que contratou (R$ 49,90)
  assert.deepEqual(b.loja("antiga").plano, { codigo: "mensal", precoContratado: 49.9, legado: true });

  // Público: preço oficial e campanha
  const planos = await (await fetch(`${base}/api/planos`)).json();
  assert.equal(planos.precoMensal, 99.9);
  assert.deepEqual([planos.campanha.codigo, planos.campanha.preco], ["FUNDADOR50", 49.95]);

  // 1. Loja convencional: R$ 99,90, calculado no servidor (o valor mandado pelo aparelho é ignorado)
  const normal = await cadastrar({});
  assert.equal(normal.status, 201);
  const cNormal = cookieDe(normal);
  assert.equal((await normal.json()).preco, 99.9);
  await json("POST", "/api/painel/assinar", { valor: 1, preco: 1 }, cNormal);
  assert.equal(preapprovals.at(-1).corpo.auto_recurring.transaction_amount, 99.9);

  // 2. Fundadora: cupom no cadastro, R$ 49,95 recorrente, preço contratado gravado
  const fund = await cadastrar({ cupom: "fundador50", cnpj: "11.222.333/0001-81" });
  assert.equal(fund.status, 201);
  const pFund = await fund.json(); let cFund = cookieDe(fund);
  assert.deepEqual([pFund.preco, pFund.loja.beneficio.codigo, pFund.loja.cnpj], [49.95, "FUNDADOR50", "11222333000181"]);
  await json("POST", "/api/painel/assinar", { valor: 0.01 }, cFund);
  const paFund = preapprovals.at(-1);
  assert.deepEqual([paFund.corpo.auto_recurring.transaction_amount, paFund.corpo.auto_recurring.frequency_type], [49.95, "months"]);
  assert.ok(Date.parse(paFund.corpo.auto_recurring.start_date) >= relogio + 29 * DIA, "primeira cobrança depois dos 30 dias de teste");
  const idFund = pFund.loja.id;
  assert.equal(b.loja(idFund).plano.precoContratado, 49.95);

  // 3. Sem duplicidade: mesmo CNPJ ou mesmo WhatsApp não usa o cupom de novo; cupom inventado não cria loja
  assert.equal((await cadastrar({ cupom: "FUNDADOR50", cnpj: "11222333000181" })).status, 400);
  assert.equal((await cadastrar({ cupom: "FUNDADOR50", whatsapp: b.loja(idFund).whatsapp })).status, 400);
  assert.equal((await cadastrar({ cupom: "NAOEXISTE" })).status, 400);
  assert.equal((await cadastrar({ cnpj: "123" })).status, 400, "CNPJ inválido");
  // Cupom pelo painel (antes de assinar) e não cumulativo
  const tardia = await cadastrar({}); const cTardia = cookieDe(tardia);
  assert.equal((await (await json("POST", "/api/painel/cupom-assinatura", { codigo: "FUNDADOR50" }, cTardia)).json()).preco, 49.95);
  assert.equal((await json("POST", "/api/admin/comercial/cupons", { codigo: "OUTRO10", percentual: 10, fim: new Date(relogio + 30 * DIA).toISOString() }, admin)).status, 201);
  assert.equal((await json("POST", "/api/painel/cupom-assinatura", { codigo: "OUTRO10" }, cTardia)).status, 400, "cupons não se acumulam");

  // 4. Campanha de 90 dias: depois do fim o cupom não vale; o admin pode prorrogar (e fica registrado)
  relogio += 91 * DIA;
  // As sessões valem 30 dias: depois do salto no tempo, admin e loja entram de novo
  admin = cookieDe(await json("POST", "/api/admin/entrar", { senha: senhaAdmin }));
  cFund = cookieDe(await json("POST", "/api/painel/entrar", { email: pFund.loja.email, senha }));
  const atrasada = await cadastrar({ cupom: "FUNDADOR50" });
  assert.equal(atrasada.status, 400);
  assert.match((await atrasada.json()).erro, /terminou/);
  const prorrogado = await json("PATCH", "/api/admin/comercial/cupons/FUNDADOR50", { fim: new Date(relogio + 10 * DIA).toISOString() }, admin);
  assert.equal(prorrogado.status, 200);
  assert.equal((await cadastrar({ cupom: "FUNDADOR50" })).status, 201);
  const auditoria = await (await json("GET", "/api/admin/auditoria", null, admin)).json();
  assert.equal(auditoria[0].acao, "cupom_editado");

  // 5. Preço oficial muda só para quem assinar depois
  assert.equal((await json("PUT", "/api/admin/comercial/preco", { precoMensal: 120 }, admin)).status, 200);
  assert.equal(b.loja(idFund).plano.precoContratado, 49.95);
  assert.equal(b.loja("antiga").plano.precoContratado, 49.9);
  const nova = await cadastrar({}); await json("POST", "/api/painel/assinar", null, cookieDe(nova));
  assert.equal(preapprovals.at(-1).corpo.auto_recurring.transaction_amount, 120);

  // 6. Atraso (pausa) não tira o benefício; recuperação volta ao normal; cancelamento definitivo encerra
  statusPa[paFund.id] = "authorized"; await sincronizarAssinaturas();
  assert.equal(b.loja(idFund).assinatura.status, "authorized");
  statusPa[paFund.id] = "paused"; await sincronizarAssinaturas();
  assert.equal(b.loja(idFund).assinatura.status, "pausada");
  assert.equal(b.loja(idFund).beneficio.encerradoEm, undefined, "pausa mantém o benefício");
  statusPa[paFund.id] = "authorized"; await sincronizarAssinaturas();
  assert.equal(b.loja(idFund).assinatura.status, "authorized");
  statusPa[paFund.id] = "cancelled"; await sincronizarAssinaturas();
  assert.ok(b.loja(idFund).beneficio.encerradoEm, "cancelamento definitivo encerra o benefício");
  const reaplicar = await json("POST", "/api/painel/cupom-assinatura", { codigo: "FUNDADOR50" }, cFund);
  assert.equal(reaplicar.status, 400);
  await json("POST", "/api/painel/assinar", null, cFund);
  assert.equal(preapprovals.at(-1).corpo.auto_recurring.transaction_amount, 120, "voltou a assinar: preço cheio");

  // 7. Parceiro especial: sem mensalidade e sem cupom
  b.loja("parc").senhaHash = gerarHashSenha(senha); b.salvar();
  const cParc = cookieDe(await json("POST", "/api/painel/entrar", { email: "parc@loja.com", senha }));
  assert.equal((await json("POST", "/api/painel/assinar", null, cParc)).status, 400);
  assert.equal((await json("POST", "/api/painel/cupom-assinatura", { codigo: "FUNDADOR50" }, cParc)).status, 400);

  // Admin enxerga os beneficiários
  const comercial = await (await json("GET", "/api/admin/comercial", null, admin)).json();
  assert.ok(comercial.beneficiarios.some((x) => x.lojaId === idFund && x.encerradoEm));
  assert.equal(comercial.beneficiarios.filter((x) => !x.encerradoEm).length, 2);
});

test("FOOD PRO: R$ 299,90, FOODFUNDADOR50 = R$ 149,95, cupom de um segmento não vale no outro, sem comissão", async () => {
  const { garantirComercial, precoParaAssinar, validarCupomAssinatura, aplicarCupomAssinatura, precoMensalOficial } = await import("../servidor/planos.js");
  const { retratoFinanceiro } = await import("../servidor/financeiro.js");
  const agora = Date.parse("2026-11-12T12:00:00Z");
  // Banco que já tinha o comercial do 2.0: o Food entra sem mexer no resto
  const banco = { lojas: [], d: { comercial: { precoMensal: 99.9, cupons: [{ codigo: "FUNDADOR50", percentual: 50, ativo: true, limite: null, inicio: new Date(agora).toISOString(), fim: new Date(agora + 90 * 864e5).toISOString(), usos: [] }] } } };
  assert.equal(garantirComercial(banco, agora), true);
  assert.equal(garantirComercial(banco, agora), false, "idempotente");
  assert.deepEqual([precoMensalOficial(banco), precoMensalOficial(banco, "food")], [99.9, 299.9]);
  const rest = { id: "r", segmento: "food", whatsapp: "5584911112222" }, loja = { id: "l", whatsapp: "5584933334444" };
  banco.lojas.push(rest, loja);
  assert.equal(precoParaAssinar(banco, rest), 299.9);
  assert.match(validarCupomAssinatura(banco, rest, "FUNDADOR50", agora).erro, /lojas/);
  assert.match(validarCupomAssinatura(banco, loja, "FOODFUNDADOR50", agora).erro, /Food/);
  const v = validarCupomAssinatura(banco, rest, "foodfundador50", agora);
  aplicarCupomAssinatura(rest, v.cupom, agora);
  assert.equal(precoParaAssinar(banco, rest), 149.95);
  assert.equal(validarCupomAssinatura(banco, rest, "FOODFUNDADOR50", agora + 91 * 864e5).jaAplicado, true, "já aplicado continua valendo depois da campanha");
  const outro = { id: "r2", segmento: "food", whatsapp: "5584911112222" };
  assert.match(validarCupomAssinatura(banco, outro, "FOODFUNDADOR50", agora).erro, /WhatsApp/);
  assert.match(validarCupomAssinatura(banco, { id: "r3", segmento: "food" }, "FOODFUNDADOR50", agora + 91 * 864e5).erro, /terminou/);
  for (const u of [1, 50, 10000]) assert.equal(retratoFinanceiro({ loja: rest, unidades: u, valorProdutos: 100 * u }).comissaoTotal, 0, "Food nunca paga comissão");
});
