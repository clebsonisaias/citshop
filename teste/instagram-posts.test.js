import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { CanaisAfiliado, postDoUtm, postValido, vendasPorPost } from "../servidor/afiliados-canal.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

const MEDIA = "17913227061308058";

test("post do Instagram: código validado, lido do utmContent, vendas por post e link da Shopee com o post", async (t) => {
  assert.equal(postValido(MEDIA), MEDIA);
  assert.equal(postValido("abc<script>"), null);
  assert.equal(postDoUtm(`citshop-instagram-${MEDIA}`), MEDIA);
  assert.equal(postDoUtm("citshop-site"), null);
  assert.deepEqual(vendasPorPost([{ utm: `citshop-instagram-${MEDIA}`, pedidos: [{ orderStatus: "COMPLETED", comissao: 2.5 }, { orderStatus: "PENDING", comissao: 1 }, { orderStatus: "CANCELLED", comissao: 9 }] }]), { [MEDIA]: { pedidos: 3, estimada: 1, confirmada: 2.5 } });
  const dir = mkdtempSync(join(tmpdir(), "cit-post-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ids = [];
  const canais = new CanaisAfiliado({ dadosDir: dir, shopee: { estaConfigurado: () => true, gerarLinkComSubIds: async (u, s) => { ids.push(s); return `https://s.shopee.com.br/${s.join("-")}`; } } });
  const p = { id: "shopee-1", loja: "shopee", link: "https://s.shopee.com.br/x", linkOriginal: "https://shopee.com.br/x-i.1.1" };
  assert.equal(await canais.destino(p, "instagram", MEDIA), `https://s.shopee.com.br/citshop-instagram-${MEDIA}`);
  assert.deepEqual(ids[0], ["citshop", "instagram", MEDIA]);
  assert.equal(await canais.destino(p, "instagram"), "https://s.shopee.com.br/citshop-instagram", "sem post é outro link (outra chave)");
});

test("QUERO ponta a ponta: direct com link pela /ir do post, resposta pública, contadores e resultado por post no admin", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-quero-post-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const SEGREDO_META = randomBytes(12).toString("hex"), senha = randomBytes(8).toString("hex");
  const enviados = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/me/messages")) { enviados.push({ tipo: "direct", corpo: JSON.parse(init.body) }); return Response.json({ message_id: "m1" }); }
    if (u.includes("/replies")) { enviados.push({ tipo: "resposta", url: u, corpo: JSON.parse(init.body) }); return Response.json({ id: "r1" }); }
    return Response.json({});
  };
  const { app, banco } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senha), INSTAGRAM_APP_SECRET: SEGREDO_META, INSTAGRAM_ACCOUNT_ID: "17", INSTAGRAM_ACCESS_TOKEN: "tok", INSTAGRAM_PAGE_ACCESS_TOKEN: "pag", URL_PUBLICA: "https://shop.test" }, fetchImpl, log: { info() {}, warn() {}, error() {} } });
  const agora = new Date().toISOString();
  banco.lojas.push({ id: "d", slug: "mimosdadelly", nome: "Mimos da Delly", cidade: "Macaíba", whatsapp: "5584900000001", criadaEm: agora, testeAte: "2999-01-01T00:00:00Z" });
  banco.produtos.push({ id: "laco", lojaId: "d", nome: "Laço xadrez", dept: "moda", preco: 5.9, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.d.instagramPosts = { [MEDIA]: { produtoId: "l-laco", em: agora } };
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const comentar = (id, texto, de = "cliente1") => {
    const corpo = JSON.stringify({ entry: [{ changes: [{ field: "comments", value: { id, text: texto, from: { id: "999", username: de }, media: { id: MEDIA } } }] }] });
    return fetch(`${base}/api/webhook/instagram`, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SEGREDO_META).update(corpo).digest("hex")}` }, body: corpo });
  };
  const espera = () => new Promise((ok) => setTimeout(ok, 150));

  assert.equal((await comentar("c1", "Quero!")).status, 200);
  await espera();
  const direct = enviados.find((e) => e.tipo === "direct");
  assert.match(direct.corpo.message.text, new RegExp(`https://shop\\.test/ir/l-laco\\?c=instagram&p=${MEDIA}`));
  const resp = enviados.find((e) => e.tipo === "resposta");
  assert.match(resp.url, /\/c1\/replies$/);
  assert.match(resp.corpo.message, /direct/i);
  assert.deepEqual([banco.d.instagramPosts[MEDIA].queros, banco.d.instagramPosts[MEDIA].directs, banco.d.instagramPosts[MEDIA].respostas], [1, 1, 1]);

  // Clique no link do direct: conta para o post e abre a página do produto
  const ir = await fetch(`${base}/ir/l-laco?c=instagram&p=${MEDIA}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 Instagram 300.0 (iPhone)" } });
  assert.deepEqual([ir.status, ir.headers.get("location")], [302, "/p/l-laco"]);
  await fetch(`${base}/ir/l-laco?c=instagram&p=${MEDIA}`, { redirect: "manual", headers: { "user-agent": "facebookexternalhit/1.1" } });

  // Resposta pública desligada no admin: só o direct
  const admin = (await fetch(`${base}/api/admin/entrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha }) })).headers.get("set-cookie").split(";")[0];
  await fetch(`${base}/api/admin/instagram/config`, { method: "POST", headers: { "Content-Type": "application/json", cookie: admin }, body: JSON.stringify({ responderPublico: false }) });
  await comentar("c2", "quero o link", "cliente2");
  await espera();
  assert.equal(enviados.filter((e) => e.tipo === "resposta").length, 1, "sem nova resposta pública");
  assert.equal(enviados.filter((e) => e.tipo === "direct").length, 2);

  const posts = await (await fetch(`${base}/api/admin/instagram/posts`, { headers: { cookie: admin } })).json();
  assert.deepEqual(posts.posts.map((p) => [p.id, p.nome, p.queros, p.directs, p.respostas, p.cliques]), [[MEDIA, "Laço xadrez", 2, 2, 1, 1]], "prévia do link (robô) não conta clique");
  const st = await (await fetch(`${base}/api/admin/instagram/status`, { headers: { cookie: admin } })).json();
  assert.equal(st.responderPublico, false);
});
