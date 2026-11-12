import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("cupons: admin cadastra das parceiras, loja cadastra os dela, só os válidos aparecem", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-cupons-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const senhaAdm = "admin-teste-123", senhaLoja = "loja-teste-123";
  const banco = new Banco(dir);
  banco.lojas.push({ id: "l1", slug: "delly", nome: "Delly", email: "d@loja.com", senhaHash: gerarHashSenha(senhaLoja), cidade: "Macaíba", whatsapp: "5584999990001", criadaEm: agora, testeAte: "2999-01-01T00:00:00Z" });
  banco.d.cupons = [{ id: "vencido", codigo: "VELHO", descricao: "Antigo", validoAte: "2020-01-01", loja: "shopee", criadoEm: agora }];
  banco.salvar();
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdm) }, log: {} });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(corpo) });
  const cookieDe = (r) => r.headers.get("set-cookie").split(";")[0];
  const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  const adm = cookieDe(await post("/api/admin/entrar", { senha: senhaAdm }));
  assert.equal((await post("/api/admin/cupons", { loja: "shopee", codigo: "x", descricao: "Sem código", validoAte: amanha }, adm)).status, 400);
  assert.equal((await post("/api/admin/cupons", { loja: "shopee", codigo: "frete 12", descricao: "Frete grátis acima de R$ 19", validoAte: amanha }, adm)).status, 201);
  assert.equal((await post("/api/admin/cupons", { loja: "shopee", codigo: "OUTRO", descricao: "x", validoAte: amanha })).status, 401, "sem login de admin");

  const loja = cookieDe(await post("/api/painel/entrar", { email: "d@loja.com", senha: senhaLoja }));
  const painel = await (await post("/api/painel/cupons", { codigo: "LACO10", descricao: "10% em laços", validoAte: amanha }, loja)).json();
  assert.equal(painel.cupons[0].codigo, "LACO10");

  const publicos = await (await fetch(`${base}/api/cupons`)).json();
  assert.deepEqual(publicos.map((c) => c.codigo).sort(), ["FRETE12", "LACO10"], "vencido não aparece; código sem espaço e em maiúsculas");
  const daLoja = publicos.find((c) => c.codigo === "LACO10");
  assert.equal(daLoja.lojaSlug, "delly");
  assert.equal(daLoja.link, "/loja/delly");
  const vitrine = await (await fetch(`${base}/api/vitrine`)).json();
  assert.equal(vitrine.cupons.length, 2);
  assert.equal((await fetch(`${base}/cupons`)).status, 200);
});
