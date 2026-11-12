import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("convite de parceria: o admin gera, vale para uma loja só, trava o e-mail, expira e cancela; sem convite é assinatura", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-convites-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const senhaAdmin = randomBytes(8).toString("hex"), senhaLoja = randomBytes(8).toString("hex");
  let agoraMs = Date.now();
  const { app, banco: b } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdmin), URL_PUBLICA: "https://shop.citmax.com.br" },
    agora: () => agoraMs, log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  let n = 0; // cada cadastro vem de um IP diferente: o site limita 5 cadastros por hora por IP
  const cadastro = (extra) => fetch(`${base}/api/painel/cadastro`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${++n}` },
    body: JSON.stringify({ nome: "Minha Loja", responsavel: "Laninha", email: "feitoporlaninha@gmail.com", whatsapp: "84991698420", cidade: "Natal", senha: senhaLoja, aceite: true, ...extra }),
  });

  // Só o admin gera e lista convites; modelo desconhecido e e-mail inválido são recusados
  assert.equal((await json("POST", "/api/admin/convites", {})).status, 401);
  assert.equal((await json("GET", "/api/admin/convites")).status, 401);
  const admin = (await json("POST", "/api/admin/entrar", { senha: senhaAdmin })).headers.get("set-cookie").split(";")[0];
  assert.equal((await json("POST", "/api/admin/convites", { predefinicao: "inexistente" }, admin)).status, 400);
  assert.equal((await json("POST", "/api/admin/convites", { email: "sem-arroba" }, admin)).status, 400);
  const c1 = await (await json("POST", "/api/admin/convites", { predefinicao: "amorimimo", email: "FeitoPorLaninha@gmail.com", whatsapp: "(84) 99169-8420" }, admin)).json();
  assert.equal(c1.status, "aberto");
  assert.match(c1.link, /^https:\/\/shop\.citmax\.com\.br\/painel\?convite=[\w-]{30,}$/);
  const token1 = c1.link.split("convite=")[1];

  // A página de cadastro confere o link e recebe o que preencher, sem expor o resto
  const info = await (await fetch(`${base}/api/painel/convite/${token1}`)).json();
  assert.deepEqual(info, { nome: "Amorimimo", email: "feitoporlaninha@gmail.com", whatsapp: "5584991698420" });
  assert.equal((await fetch(`${base}/api/painel/convite/token-errado`)).status, 404);

  // Cadastro com convite: e-mail precisa ser o do convite; convite inventado é recusado
  assert.equal((await cadastro({ convite: token1, email: "outra@pessoa.com" })).status, 400);
  assert.equal((await cadastro({ convite: "inventado" })).status, 400);
  const ok = await cadastro({ convite: token1 });
  assert.equal(ok.status, 201);
  const painel = await ok.json();
  assert.equal(painel.status, "parceira");
  assert.deepEqual([painel.loja.modeloCobranca, painel.loja.comissaoPorVenda, painel.loja.cor, painel.loja.logo], ["comissao_fixa", 1, "#F4C7C3", "/amorimimo-logo.webp"]);

  // Depois de usado, não serve para outra loja (nem para a mesma conta de novo); o admin vê quem usou
  assert.equal((await fetch(`${base}/api/painel/convite/${token1}`)).status, 404);
  assert.equal((await cadastro({ convite: token1, email: "feitoporlaninha@gmail.com", nome: "Outra" })).status, 400);
  const lista = await (await json("GET", "/api/admin/convites", null, admin)).json();
  assert.deepEqual([lista[0].status, lista[0].lojaNome, lista[0].link], ["usado", "Minha Loja", null]);
  assert.equal((await json("DELETE", `/api/admin/convites/${c1.id}`, null, admin)).status, 409, "usado não cancela");

  // Convite aberto (sem trava de e-mail) usado duas vezes ao mesmo tempo: só um passa
  const c2 = await (await json("POST", "/api/admin/convites", {}, admin)).json();
  const token2 = c2.link.split("convite=")[1];
  const corrida = await Promise.all([cadastro({ convite: token2, email: "a@loja.com", nome: "Loja A" }), cadastro({ convite: token2, email: "b@loja.com", nome: "Loja B" })]);
  assert.deepEqual(corrida.map((r) => r.status).sort(), [201, 400]);

  // Cancelado e expirado deixam de valer
  const c3 = await (await json("POST", "/api/admin/convites", {}, admin)).json();
  assert.equal((await json("DELETE", `/api/admin/convites/${c3.id}`, null, admin)).status, 200);
  assert.equal((await cadastro({ convite: c3.link.split("convite=")[1], email: "c@loja.com", nome: "Loja C" })).status, 400);
  const c4 = await (await json("POST", "/api/admin/convites", {}, admin)).json();
  agoraMs += 31 * 24 * 60 * 60 * 1000;
  assert.equal((await fetch(`${base}/api/painel/convite/${c4.link.split("convite=")[1]}`)).status, 404, "expirou em 30 dias");
  agoraMs -= 31 * 24 * 60 * 60 * 1000;

  // Sem convite o cadastro é por assinatura (mensalidade), para qualquer pessoa
  const normal = await (await cadastro({ email: "qualquer@loja.com", nome: "Loja Normal" })).json();
  assert.deepEqual([normal.status, normal.loja.modeloCobranca ?? "mensalidade", normal.loja.logo ?? null], ["teste", "mensalidade", null]);
  // Loja com nome de rota fixa não rouba a página: /carrinho continua sendo o carrinho
  const nomeDeRota = await (await cadastro({ email: "rota@loja.com", nome: "Carrinho" })).json();
  assert.equal(nomeDeRota.loja.slug, "carrinho-2");
  // O link de convite nunca vai na vitrine nem no painel da loja
  assert.ok(!JSON.stringify(await (await fetch(`${base}/api/vitrine`)).json()).includes(token1));
  assert.ok(b.d.convites.length >= 4);
});
