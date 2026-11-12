import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Banco } from "../servidor/dados.js";
import { criarApp, lerVariacoes } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("variações: uma por linha, até 3 grupos de 20 opções, sem repetidas", () => {
  assert.deepEqual(lerVariacoes("Cor: Rosa, Lilás, Rosa\nTamanho: RN, P\nlinha sem dois pontos\nVazio:  , "), [{ nome: "Cor", opcoes: ["Rosa", "Lilás"] }, { nome: "Tamanho", opcoes: ["RN", "P"] }]);
  assert.equal(lerVariacoes("A: 1\nB: 2\nC: 3\nD: 4").length, 3);
  assert.equal(lerVariacoes(`Cor: ${Array.from({ length: 30 }, (_, i) => `c${i}`).join(",")}`)[0].opcoes.length, 20);
});

test("painel do lojista: produto com variações reais, entrega separada com histórico, financeiro do mês e perfil", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-lojista-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString(), futuro = "2999-01-01T00:00:00.000Z", senha = randomBytes(8).toString("hex");
  const banco = new Banco(dir);
  banco.lojas.push({ id: "m", slug: "loja-m", nome: "Loja M", email: "m@loja.com", senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: "5584900000001", criadaEm: agora, testeAte: futuro });
  banco.lojas.push({ id: "p", slug: "loja-p", nome: "Loja P", email: "p@loja.com", senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: "5584900000002", criadaEm: agora, testeAte: agora, modeloCobranca: "comissao_fixa" });
  banco.produtos.push({ id: "pm", lojaId: "m", nome: "Laço", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.d.pedidos = [
    { id: "site-1", origem: "site", lojaId: "p", valorTotal: 50, status: "approved", etapa: "novo", vendidoEm: agora, criadoEm: agora },
    { id: "site-2", origem: "site", lojaId: "p", valorTotal: 30, status: "pending", etapa: "novo", criadoEm: agora },
  ];
  banco.d.lancamentos = [{ id: "l1", chave: "comissao:site-1", tipo: "comissao", valor: 5, moeda: "BRL", lojaId: "p", pedidoId: "site-1", em: agora }];
  banco.salvar();
  const { app, banco: b } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const entrar = async (email) => (await json("POST", "/api/painel/entrar", { email, senha })).headers.get("set-cookie").split(";")[0];
  const cm = await entrar("m@loja.com"), cp = await entrar("p@loja.com");

  // 1. Produto editado com marca, SKU e variações (formulário manda texto)
  const ed = await json("PUT", "/api/painel/produtos/pm", { nome: "Laço", dept: "moda", preco: "10", manter: JSON.stringify(["/x.webp"]), marca: "Mimos", sku: "LC-01", variacoes: "Cor: Rosa, Lilás\nTamanho: RN, P" }, cm);
  assert.equal(ed.status, 200);
  assert.deepEqual(b.produto("pm").variacoes, [{ nome: "Cor", opcoes: ["Rosa", "Lilás"] }, { nome: "Tamanho", opcoes: ["RN", "P"] }]);
  // A página do produto mostra só as opções da loja (nada de P/M/G, Oversized ou cores genéricas)
  const pagina = await (await fetch(`${base}/p/l-pm`)).text();
  assert.ok(pagina.includes('data-var="cor" data-val="Lilás"') && pagina.includes('data-val="RN"'));
  assert.ok(!/Oversized|Babylook|data-val="GG"|data-val="Bege"/.test(pagina), "sem opções inventadas");
  const vitrine = await (await fetch(`${base}/api/vitrine`)).json();
  const naVitrine = vitrine.produtos.find((x) => x.id === "l-pm");
  assert.deepEqual([naVitrine.marca, naVitrine.variacoes.length], ["Mimos", 2]);
  assert.ok(!JSON.stringify(vitrine).includes("LC-01"), "SKU é só da loja");

  // 2. Pedido: entrega separada do atendimento, com histórico
  const ped = (await (await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pm", comprador: { nome: "Ana", whatsapp: "84988887777", receber: "entrega", endereco: "Rua A, 10, Centro" } })).json()).pedido;
  const patch = (corpo) => json("PATCH", `/api/painel/pedidos/${ped}`, corpo, cm);
  assert.equal((await patch({})).status, 400);
  assert.equal((await patch({ envio: "teletransporte" })).status, 400);
  await patch({ etapa: "atendimento" });
  await patch({ envio: "preparando" });
  const ultimo = await (await patch({ etapa: "vendido", envio: "saiu" })).json();
  const p = ultimo.pedidos.find((x) => x.id === ped);
  assert.deepEqual([p.etapa, p.envio], ["vendido", "saiu"]);
  assert.deepEqual(p.historico.map((h) => `${h.campo}:${h.para}`), ["etapa:atendimento", "envio:preparando", "etapa:vendido", "envio:saiu"]);
  const csv = await (await fetch(`${base}/api/painel/pedidos.csv`, { headers: { cookie: cm } })).text();
  assert.ok(csv.includes("Entrega (situação)") && csv.includes('"saiu"'));

  // 3. Financeiro do mês: parceiro vê recebido, aguardando e comissão; assinante não tem comissão
  const fp = (await (await fetch(`${base}/api/painel/eu`, { headers: { cookie: cp } })).json()).financeiro;
  assert.deepEqual([fp.recebidoSiteMes, fp.aguardandoPagamento, fp.comissaoMes, fp.vendasMes.qtd], [50, 30, 5, 1]);
  const fm = (await (await fetch(`${base}/api/painel/eu`, { headers: { cookie: cm } })).json()).financeiro;
  assert.deepEqual([fm.comissaoMes, fm.vendasMes.qtd, fm.vendasMes.valor], [null, 1, 10]);

  // 4. Perfil: Instagram (normalizado) e telefone; parceiro não mostra telefone em público
  await json("PUT", "/api/painel/loja", { nome: "Loja M", whatsapp: "84900000001", cidade: "Natal", instagram: "https://instagram.com/loja.m", telefone: "(84) 3333-4444 <b>" }, cm);
  await json("PUT", "/api/painel/loja", { nome: "Loja P", whatsapp: "84900000002", cidade: "Natal", instagram: "@lojap", telefone: "(84) 3222-1111" }, cp);
  const lojas = (await (await fetch(`${base}/api/vitrine`)).json()).lojas;
  const lm = lojas.find((l) => l.slug === "loja-m"), lp = lojas.find((l) => l.slug === "loja-p");
  assert.deepEqual([lm.instagram, lm.telefone], ["loja.m", "(84) 3333-4444 "]);
  assert.deepEqual([lp.instagram, lp.telefone], ["lojap", ""]);
});
