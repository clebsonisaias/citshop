import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";
import { ConectorMercadoLivre, ProvedorLinkMercadoLivre } from "../servidor/integracoes/mercado-livre/conector.js";

test("Mercado Livre: admin conecta a conta (OAuth), o token fica cifrado e é renovado sozinho antes de vencer", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-ml-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const senha = randomBytes(8).toString("hex"), SEGREDO_APP = randomBytes(8).toString("hex");
  let relogio = Date.parse("2026-11-14T12:00:00Z");
  const pedidos = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/oauth/token")) {
      const p = Object.fromEntries(new URLSearchParams(init.body));
      pedidos.push(p);
      const n = pedidos.length;
      return Response.json({ access_token: `acesso-${n}`, refresh_token: `renova-${n}`, expires_in: 21600, user_id: 77 });
    }
    return Response.json({});
  };
  const { app, banco, agendadorOfertas } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senha), URL_PUBLICA: "https://shop.test", MERCADO_LIVRE_CLIENT_ID: "123", MERCADO_LIVRE_CLIENT_SECRET: SEGREDO_APP },
    fetchImpl, agora: () => relogio, log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const admin = (await fetch(`${base}/api/admin/entrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha }) })).headers.get("set-cookie").split(";")[0];

  const ida = await fetch(`${base}/api/admin/mercadolivre/conectar`, { headers: { cookie: admin }, redirect: "manual" });
  const destino = new URL(ida.headers.get("location"));
  assert.equal(destino.origin + destino.pathname, "https://auth.mercadolivre.com.br/authorization");
  assert.equal(destino.searchParams.get("redirect_uri"), "https://shop.test/mercadolivre/retorno");
  const state = destino.searchParams.get("state");

  assert.equal((await fetch(`${base}/mercadolivre/retorno?code=x&state=errado`, { redirect: "manual" })).headers.get("location"), "/admin?ml=erro", "state errado não conecta");
  await fetch(`${base}/api/admin/mercadolivre/conectar`, { headers: { cookie: admin }, redirect: "manual" }).then((r) => new URL(r.headers.get("location")).searchParams.get("state")).then(async (st) => {
    const volta = await fetch(`${base}/mercadolivre/retorno?code=CODIGO&state=${st}`, { redirect: "manual" });
    assert.equal(volta.headers.get("location"), "/admin?ml=conectado");
  });
  assert.ok(state);
  assert.deepEqual([pedidos[0].grant_type, pedidos[0].code, pedidos[0].client_id, pedidos[0].redirect_uri], ["authorization_code", "CODIGO", "123", "https://shop.test/mercadolivre/retorno"]);
  banco.salvar();
  assert.equal(readFileSync(join(dir, "citshop.json"), "utf8").includes("acesso-1"), false, "token cifrado no disco");

  const conector = agendadorOfertas.coletor.conectores["mercado-livre"];
  assert.equal(await conector.obterToken(), "acesso-1");
  relogio += 5 * 3600_000 + 55 * 60_000; // faltam 5 min para vencer: renova
  assert.equal(await conector.obterToken(), "acesso-2");
  assert.deepEqual([pedidos[1].grant_type, pedidos[1].refresh_token], ["refresh_token", "renova-1"]);
  const st = await (await fetch(`${base}/api/admin/mercadolivre`, { headers: { cookie: admin } })).json();
  assert.deepEqual([st.configurado, st.conectado, st.userId], [true, true, 77]);
});

test("Mercado Livre: busca recusada (403) usa o catálogo com o melhor anúncio; link sai com a etiqueta; rodízio e teto diário", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push([String(url), init.headers.Authorization]);
    const u = String(url);
    if (u.includes("/sites/MLB/search")) return new Response("{}", { status: 403 });
    if (u.includes("/products/search")) return Response.json({ results: [{ id: "MLB999", name: "Air Fryer 4L", pictures: [{ secure_url: "https://http2.mlstatic.com/a.jpg" }] }] });
    if (u.includes("/products/MLB999/items")) return Response.json({ results: [
      { item_id: "MLB1", price: 300, sold_quantity: 10 }, { item_id: "MLB2", price: 280, original_price: 350, sold_quantity: 500, shipping: { free_shipping: true } },
    ] });
    return Response.json({});
  };
  const c = new ConectorMercadoLivre({ fetchImpl, obterToken: async () => "tok", provedorLink: new ProvedorLinkMercadoLivre({ tagAfiliado: "clebsonisaias138" }), termosPorRodada: 1 });
  const r = await c.buscarOfertas({ termos: ["air fryer", "creatina"], categorias: ["cozinha", "esporte"] });
  assert.deepEqual(r.map((p) => [p.id, p.nome, p.preco, p.precoAntigo]), [["ml-MLB2", "Air Fryer 4L", 280, 350]]);
  const link = new URL(r[0].link);
  assert.deepEqual([link.searchParams.get("matt_word"), link.searchParams.get("matt_tool")], ["clebsonisaias138", "70471590"]);
  assert.ok(urls.every(([, auth]) => auth === "Bearer tok"));
  assert.ok(urls[0][0].includes("q=air%20fryer"));
  urls.length = 0;
  await c.buscarOfertas({ termos: ["air fryer", "creatina"], categorias: ["cozinha", "esporte"] });
  assert.ok(urls[0][0].includes("q=creatina"), "próxima rodada pega o próximo termo");

  const limitado = new ConectorMercadoLivre({ fetchImpl, provedorLink: new ProvedorLinkMercadoLivre({ tagAfiliado: "x" }), limiteDiario: 1 });
  await assert.rejects(limitado.buscarOfertas({ termos: ["a"] }), /Limite diário|recusou/, "busca 403 + teto: falha geral lança (motor mantém a rodada anterior)");
});
