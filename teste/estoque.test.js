import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("estoque: esgotado some da vitrine, /p/ avisa, quantidade é descontada uma vez e devolvida, aviso quando volta", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-estoque-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const futuro = "2999-01-01T00:00:00.000Z";
  const senha = "senha-da-loja";
  const banco = new Banco(dir);
  // Loja Q controla por quantidade; loja S é a simples (marca quando acaba)
  banco.lojas.push({ id: "lq", slug: "lq", nome: "Loja Q", email: "q@loja.com", senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: "5584999990001", criadaEm: agora, testeAte: futuro, modoEstoque: "quantidade" });
  banco.lojas.push({ id: "ls", slug: "ls", nome: "Loja S", email: "s@loja.com", senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: "5584999990002", criadaEm: agora, testeAte: futuro });
  const prod = (id, lojaId, extra) => banco.produtos.push({ id, lojaId, nome: `Item ${id}`, dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora, ...extra });
  prod("q3", "lq", { estoque: 3 });
  prod("q0", "lq", { estoque: 0 });
  prod("qn", "lq", {}); // sem contagem: conta como "tem estoque"
  prod("s1", "ls", {});
  prod("s2", "ls", { esgotado: true });
  banco.salvar();

  const enviados = [];
  const { app, banco: b, verificarAlertas } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br" },
    fetchImpl: async (url, init) => { if (String(url).endsWith("/api/sendText")) enviados.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) }; },
    log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(corpo) });
  const entrar = async (email) => (await json("POST", "/api/painel/entrar", { email, senha })).headers.get("set-cookie").split(";")[0];
  const ids = async () => (await (await fetch(`${base}/api/vitrine`)).json()).produtos.filter((p) => p.loja === "local").map((p) => p.id).sort();
  const comprador = { nome: "Ana Cliente", whatsapp: "84988887777" };

  // 1. Vitrine: esgotado (marcado ou com zero) some; sem contagem e com saldo ficam
  assert.deepEqual(await ids(), ["l-q3", "l-qn", "l-s1"]);

  // 2. /p/: página existe, mostra "Esgotado" e o aviso de volta, sem botões de compra
  const pagina = await (await fetch(`${base}/p/l-s2`)).text();
  assert.ok(pagina.includes("Esgotado no momento") && pagina.includes('data-tipo="estoque"'));
  assert.ok(!pagina.includes("data-carrinho=") && !pagina.includes("data-pedir-zap="));
  assert.ok((await (await fetch(`${base}/p/l-q3`)).text()).includes("Restam só 3 unidades"));

  // 3. Pedido recusa esgotado e quantidade acima do saldo (também somando o mesmo produto duas vezes)
  assert.equal((await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-s2", comprador })).status, 409);
  const alto = await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-q3", quantidade: 4, comprador });
  assert.equal(alto.status, 409);
  assert.match((await alto.json()).erro, /restam 3 unidades/);
  assert.equal((await json("POST", "/api/pedidos/whatsapp", { itens: [{ produtoId: "l-q3", quantidade: 2 }, { produtoId: "l-q3", quantidade: 2, observacao: "cor: Azul" }], comprador })).status, 409);

  // 4. Pedido vale, mas o saldo só desce quando a loja marca "vendido" (uma vez só)
  const ped = (await (await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-q3", quantidade: 2, comprador })).json()).pedido;
  assert.equal(b.produto("q3").estoque, 3);
  const cookie = await entrar("q@loja.com");
  const etapa = (e) => json("PATCH", `/api/painel/pedidos/${ped}`, { etapa: e }, cookie);
  await etapa("vendido");
  assert.equal(b.produto("q3").estoque, 1);
  await etapa("vendido");
  assert.equal(b.produto("q3").estoque, 1, "não desconta duas vezes");
  await etapa("cancelado");
  assert.equal(b.produto("q3").estoque, 3, "cancelar devolve ao estoque");

  // 5. Chegou a zero: some da vitrine e a loja recebe o aviso no WhatsApp
  const ped2 = (await (await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-q3", quantidade: 3, comprador })).json()).pedido;
  await json("PATCH", `/api/painel/pedidos/${ped2}`, { etapa: "vendido" }, cookie);
  assert.equal(b.produto("q3").estoque, 0);
  assert.ok(!(await ids()).includes("l-q3"));
  await new Promise((r) => setTimeout(r, 30));
  const aviso = enviados.find((e) => /Acabou o estoque/.test(e.text));
  assert.ok(aviso && aviso.chatId === "5584999990001@c.us" && aviso.text.includes("Item q3"));

  // 6. "Avise-me quando voltar": só vale para esgotado; ao voltar o estoque, o cliente é avisado e o alerta acaba
  assert.equal((await json("POST", "/api/alertas", { produtoId: "l-s1", tipo: "estoque", whatsapp: "84988887777" })).status, 409, "disponível: não precisa de aviso");
  assert.equal((await json("POST", "/api/alertas", { produtoId: "l-q3", tipo: "estoque", whatsapp: "84988887777" })).status, 200);
  // Produto pausado (ou loja fora da vitrine) não apaga o alerta de quem espera a volta do estoque
  b.produto("q3").ativo = false;
  await verificarAlertas();
  assert.equal(b.d.alertas.length, 1, "pausado: o alerta espera");
  b.produto("q3").ativo = true;
  enviados.length = 0;
  await verificarAlertas();
  assert.equal(enviados.length, 0, "ainda esgotado");
  const rep = await json("PATCH", "/api/painel/produtos/q3", { estoque: "10" }, cookie);
  assert.equal((await rep.json()).estoque, 10);
  await verificarAlertas();
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].text, /Voltou ao estoque/);
  assert.equal(b.d.alertas.length, 0);

  // 7. Painel: loja simples marca esgotado e volta; modo só aceita os dois valores
  const cookieS = await entrar("s@loja.com");
  await json("PATCH", "/api/painel/produtos/s1", { esgotado: true }, cookieS);
  assert.ok(!(await ids()).includes("l-s1"));
  await json("PATCH", "/api/painel/produtos/s1", { esgotado: false }, cookieS);
  assert.ok((await ids()).includes("l-s1"));
  assert.equal((await json("PUT", "/api/painel/estoque", { modo: "qualquer" }, cookieS)).status, 400);
  assert.equal((await (await json("PUT", "/api/painel/estoque", { modo: "quantidade" }, cookieS)).json()).loja.modoEstoque, "quantidade");

  // Trocar de modo converte o que o outro modo não enxerga: "esgotado" vira zero e zero vira "esgotado"
  assert.equal(b.produto("s2").estoque, 0);
  assert.ok(!(await ids()).includes("l-s2"), "esgotado continua fora ao ir para quantidade");
  await json("PUT", "/api/painel/estoque", { modo: "simples" }, cookie);
  assert.equal(b.produto("q0").esgotado, true);
  assert.ok(!(await ids()).includes("l-q0"), "zerado continua fora ao ir para o modo simples");
  assert.ok((await ids()).includes("l-q3") && (await ids()).includes("l-qn"), "com saldo ou sem contagem continuam à venda");

  // Editar o produto no formulário não mexe no estoque (o formulário pode estar desatualizado)
  const edicao = await json("PUT", "/api/painel/produtos/qn", { nome: "Item qn novo", dept: "moda", preco: "10", manter: JSON.stringify(["/x.webp"]), estoque: "50", esgotado: "true" }, cookie);
  assert.equal(edicao.status, 200);
  assert.equal(b.produto("qn").nome, "Item qn novo");
  assert.ok(b.produto("qn").estoque == null && !b.produto("qn").esgotado, "estoque e esgotado ficam como estavam");
});
