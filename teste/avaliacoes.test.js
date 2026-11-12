import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";
import { filtrarCatalogo } from "../publico/catalogo.js";

test("vitrine: filtro por marca", () => {
  const l = [{ nome: "A", loja: "local", marca: "Mimos", preco: 1 }, { nome: "B", loja: "local", marca: "Outra", preco: 1 }, { nome: "C", loja: "local", preco: 1 }];
  assert.deepEqual(filtrarCatalogo(l, { marca: "Mimos" }).map((x) => x.nome), ["A"]);
  assert.equal(filtrarCatalogo(l, { marca: "" }).length, 3);
});

test("avaliações: só quem comprou (link assinado), uma por pedido, aparece na loja e o admin oculta", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-avaliacoes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString(), senha = randomBytes(8).toString("hex"), senhaAdmin = randomBytes(8).toString("hex");
  const banco = new Banco(dir);
  banco.lojas.push({ id: "m", slug: "loja-m", nome: "Loja M", email: "m@loja.com", senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: "5584900000001", criadaEm: agora, testeAte: "2999-01-01T00:00:00.000Z" });
  banco.produtos.push({ id: "pm", lojaId: "m", nome: "Laço", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.salvar();
  const { app, banco: b } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdmin), URL_PUBLICA: "https://shop.test" }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const loja = (await json("POST", "/api/painel/entrar", { email: "m@loja.com", senha })).headers.get("set-cookie").split(";")[0];
  const admin = (await json("POST", "/api/admin/entrar", { senha: senhaAdmin })).headers.get("set-cookie").split(";")[0];

  const pedido = (await (await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pm", comprador: { nome: "Ana Maria", whatsapp: "84988887777" } })).json()).pedido;
  const linkDe = async () => (await (await json("GET", "/api/painel/eu", null, loja)).json()).pedidos.find((p) => p.id === pedido).linkAvaliacao;
  assert.equal(await linkDe(), null, "pedido não vendido ainda não pede avaliação");
  await json("PATCH", `/api/painel/pedidos/${pedido}`, { etapa: "vendido" }, loja);
  const link = new URL(await linkDe());
  assert.equal(link.origin + link.pathname, "https://shop.test/avaliar");
  const p = link.searchParams.get("p"), tk = link.searchParams.get("t");

  // Token errado ou pedido trocado: nada feito
  assert.equal((await json("GET", `/api/avaliacoes/pedido?p=${p}&t=${"x".repeat(tk.length)}`)).status, 404);
  assert.equal((await json("POST", "/api/avaliacoes", { p: "outro", t: tk, nota: 5 })).status, 404);
  const info = await (await json("GET", `/api/avaliacoes/pedido?p=${p}&t=${tk}`)).json();
  assert.deepEqual([info.loja.nome, info.itens, info.podeAvaliar, info.jaAvaliado], ["Loja M", ["1x Laço"], true, false]);

  assert.equal((await json("POST", "/api/avaliacoes", { p, t: tk, nota: 6 })).status, 400);
  assert.equal((await json("POST", "/api/avaliacoes", { p, t: tk, nota: 5, texto: "Amei <script>x</script> o laço" })).status, 200);
  assert.equal((await json("POST", "/api/avaliacoes", { p, t: tk, nota: 1 })).status, 409, "uma por pedido");
  assert.equal(b.d.avaliacoes[0].texto, "Amei scriptx/script o laço");
  assert.equal(await linkDe(), null, "já avaliado: painel não pede de novo");

  const naLoja = await (await json("GET", "/api/lojas/loja-m/avaliacoes")).json();
  assert.deepEqual(naLoja.resumo, { media: 5, total: 1 });
  assert.deepEqual(Object.keys(naLoja.avaliacoes[0]).sort(), ["em", "nome", "nota", "texto"], "sem id de pedido nem WhatsApp");
  assert.equal(naLoja.avaliacoes[0].nome, "Ana");
  const vit = await (await json("GET", "/api/vitrine")).json();
  assert.deepEqual(vit.lojas.find((l) => l.slug === "loja-m").avaliacao, { media: 5, total: 1 });

  // Moderação
  assert.equal((await json("GET", "/api/admin/avaliacoes")).status, 401);
  const id = (await (await json("GET", "/api/admin/avaliacoes", null, admin)).json())[0].id;
  await json("PATCH", `/api/admin/avaliacoes/${id}`, { oculta: true }, admin);
  const depois = await (await json("GET", "/api/lojas/loja-m/avaliacoes")).json();
  assert.deepEqual([depois.resumo, depois.avaliacoes.length], [null, 0]);
  assert.equal((await (await json("GET", "/api/admin/auditoria", null, admin)).json())[0].acao, "avaliacao_moderada");

  // Pedido cancelado não avalia
  const p2 = (await (await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pm", comprador: { nome: "Bia", whatsapp: "84988886666" } })).json()).pedido;
  await json("PATCH", `/api/painel/pedidos/${p2}`, { etapa: "cancelado" }, loja);
  assert.equal((await (await json("GET", "/api/painel/eu", null, loja)).json()).pedidos.find((x) => x.id === p2).linkAvaliacao, null);
});
