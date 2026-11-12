import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("acesso provisório: o admin define e-mail e senha, a loja é obrigada a trocar no primeiro acesso", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-acesso-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const senhaAdmin = randomBytes(8).toString("hex"), provisoria = randomBytes(6).toString("hex"), nova = randomBytes(6).toString("hex");
  const banco = new Banco(dir);
  const loja = (id, email) => banco.lojas.push({ id, slug: id, nome: `Loja ${id}`, email, senhaHash: gerarHashSenha("x".repeat(12)), cidade: "Natal", whatsapp: "5584999990001", criadaEm: agora, testeAte: "2999-01-01T00:00:00.000Z", modeloCobranca: "comissao_fixa" });
  loja("nova", "antiga@loja.com");
  loja("outra", "outra@loja.com");
  banco.salvar();
  const { app, banco: b } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdmin) },
    log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const cookieDe = (r) => r.headers.get("set-cookie").split(";")[0];

  // Só o admin define acesso; e-mail e senha são validados; e-mail de outra loja é recusado
  const acesso = (corpo, cookie) => json("PUT", "/api/admin/lojas/nova/acesso", corpo, cookie);
  assert.equal((await acesso({ email: "dona@loja.com", senha: provisoria })).status, 401);
  const admin = cookieDe(await json("POST", "/api/admin/entrar", { senha: senhaAdmin }));
  assert.equal((await acesso({ email: "sem-arroba", senha: provisoria }, admin)).status, 400);
  assert.equal((await acesso({ email: "dona@loja.com", senha: "curta" }, admin)).status, 400);
  assert.equal((await acesso({ email: "outra@loja.com", senha: provisoria }, admin)).status, 409);
  assert.equal((await acesso({ email: " Dona@Loja.com ", senha: provisoria }, admin)).status, 200);
  assert.equal(b.loja("nova").email, "dona@loja.com");

  // Primeiro login: o painel responde, mas avisa que precisa trocar, e o resto fica bloqueado
  const entrou = await json("POST", "/api/painel/entrar", { email: "dona@loja.com", senha: provisoria });
  assert.equal(entrou.status, 200);
  assert.equal((await entrou.clone().json()).loja.trocarSenha, true);
  const loj = cookieDe(entrou);
  assert.equal((await fetch(`${base}/api/painel/eu`, { headers: { cookie: loj } })).status, 200);
  const bloqueado = await json("PUT", "/api/painel/loja", { nome: "Nome", whatsapp: "84999990001", cidade: "Natal" }, loj);
  assert.equal(bloqueado.status, 403);
  assert.equal((await fetch(`${base}/api/painel/pedidos.csv`, { headers: { cookie: loj } })).status, 403);

  // Troca: a nova precisa ser diferente; depois o painel libera e a provisória deixa de valer
  assert.equal((await json("POST", "/api/painel/senha", { atual: provisoria, nova: provisoria }, loj)).status, 400);
  assert.equal((await json("POST", "/api/painel/senha", { atual: provisoria, nova: "curta" }, loj)).status, 400);
  assert.equal((await json("POST", "/api/painel/senha", { atual: provisoria, nova }, loj)).status, 200);
  assert.equal(b.loja("nova").trocarSenha, undefined);
  assert.equal((await json("PUT", "/api/painel/loja", { nome: "Nome", whatsapp: "84999990001", cidade: "Natal" }, loj)).status, 200);
  assert.equal((await json("POST", "/api/painel/entrar", { email: "dona@loja.com", senha: provisoria })).status, 401);
  assert.equal((await (await json("POST", "/api/painel/entrar", { email: "dona@loja.com", senha: nova })).json()).loja.trocarSenha, undefined);

  // A senha provisória aleatória do admin também obriga a trocar
  const gerada = await (await json("POST", "/api/admin/lojas/outra/senha", null, admin)).json();
  const entrada = await (await json("POST", "/api/painel/entrar", { email: "outra@loja.com", senha: gerada.senha })).json();
  assert.equal(entrada.loja.trocarSenha, true);
});
