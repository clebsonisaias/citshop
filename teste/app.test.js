import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { criarApp } from "../servidor/app.js";
import { lojaVisivel, ordenarVitrine, statusLoja } from "../servidor/dados.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

const DIA = 86_400_000;

test("lojaVisivel e statusLoja seguem a regra de cobrança", () => {
  const agora = Date.parse("2026-11-10T12:00:00Z");
  const base = { testeAte: "2026-11-20T12:00:00Z", assinatura: { status: "nenhuma" }, suspensa: false };
  assert.equal(lojaVisivel(base, agora), true);
  assert.equal(statusLoja(base, agora), "teste");
  const vencida = { ...base, testeAte: "2026-11-01T12:00:00Z" };
  assert.equal(lojaVisivel(vencida, agora), false);
  assert.equal(statusLoja(vencida, agora), "vencida");
  const paga = { ...vencida, assinatura: { status: "authorized" } };
  assert.equal(lojaVisivel(paga, agora), true);
  assert.equal(statusLoja(paga, agora), "ativa");
  assert.equal(lojaVisivel({ ...paga, suspensa: true }, agora), false);
});

test("ordenarVitrine põe lojas locais antes dos afiliados e mantém a ordem", () => {
  const l = [{ id: "a1", loja: "amazon" }, { id: "l1", loja: "local" }, { id: "s1", loja: "shopee" }, { id: "l2", loja: "local" }];
  assert.deepEqual(ordenarVitrine(l).map((x) => x.id), ["l1", "l2", "a1", "s1"]);
});

// ---------- fluxo completo com servidor real ----------
let dir, servidor, base, relogio, lojaId, sincronizar, statusMp = "authorized";
const SEGREDO_WEBHOOK = "segredo-do-webhook";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "citshop-"));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [{ id: "amazon-X", nome: "TV", loja: "amazon", categoria: "tec", preco: 100, precoAntigo: 120, link: "https://amazon.com.br/x" }] }));
  relogio = Date.parse("2026-11-07T12:00:00Z");
  // Mercado Pago falso: cria e consulta preapproval sem rede.
  const fetchImpl = async (url, init) => (init?.method === "POST"
    ? Response.json({ id: "pa-1", init_point: "https://mp.test/checkout" })
    : Response.json({ id: "pa-1", status: statusMp, external_reference: lojaId }));
  const { app, sincronizarAssinaturas } = criarApp({
    env: { SESSAO_SEGREDO: "x".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha("admin123"), MP_ACCESS_TOKEN: "teste", MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK },
    log: {}, agora: () => relogio, fetchImpl,
  });
  sincronizar = sincronizarAssinaturas;
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor?.close(); rmSync(dir, { recursive: true, force: true }); });

const req = (caminho, { cookie, headers, ...init } = {}) => fetch(base + caminho, { ...init, headers: { ...(cookie ? { cookie } : {}), ...headers } });
const json = (corpo, extra = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(corpo) });
const cookieDe = (r) => r.headers.get("set-cookie").split(";")[0];

test("loja se cadastra, publica com foto, aparece antes dos afiliados, some ao vencer e volta ao assinar", async () => {
  const cad = await req("/api/painel/cadastro", json({ nome: "Moda Nossa", responsavel: "Ana", email: "ana@loja.com", senha: "senha-forte", whatsapp: "(84) 99999-0000", cidade: "Natal", aceite: true }));
  assert.equal(cad.status, 201);
  let cookie = cookieDe(cad);
  const painel = await cad.json();
  assert.equal(painel.status, "teste");
  assert.equal(painel.diasTeste, 30);
  assert.equal(painel.loja.whatsapp, "5584999990000");
  assert.equal(painel.loja.senhaHash, undefined);
  lojaId = painel.loja.id;

  const repetido = await req("/api/painel/cadastro", json({ nome: "Outra Loja", responsavel: "Bia", email: "ana@loja.com", senha: "senha-forte", whatsapp: "84999990000", cidade: "Natal", aceite: true }));
  assert.equal(repetido.status, 409);

  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#00C896" } }).png().toBuffer();
  const fd = new FormData();
  fd.append("nome", "Vestido midi"); fd.append("dept", "moda"); fd.append("preco", "89,90"); fd.append("precoAntigo", "129,90");
  fd.append("disponibilidade", "sob-encomenda");
  fd.append("fotos", new Blob([png], { type: "image/png" }), "a.png");
  const criado = await req("/api/painel/produtos", { method: "POST", body: fd, cookie });
  assert.equal(criado.status, 201);
  let produto = await criado.json();
  assert.equal(produto.preco, 89.9);
  assert.equal(produto.disponibilidade, "sob-encomenda");
  assert.match(produto.fotos[0], /^\/uploads\/.+\.webp$/);
  assert.equal((await req(produto.fotos[0])).headers.get("content-type"), "image/webp");

  const editarProduto = new FormData();
  editarProduto.append("nome", produto.nome); editarProduto.append("dept", produto.dept); editarProduto.append("preco", "89,90");
  editarProduto.append("disponibilidade", "disponivel"); editarProduto.append("manter", JSON.stringify(produto.fotos));
  produto = await (await req(`/api/painel/produtos/${produto.id}`, { method: "PUT", body: editarProduto, cookie })).json();
  assert.equal(produto.disponibilidade, "disponivel");

  // Personalização: cor, texto e logo aparecem na vitrine; cor inválida é ignorada.
  const visual = await req("/api/painel/loja", { method: "PUT", headers: { "Content-Type": "application/json" }, cookie,
    body: JSON.stringify({ nome: "Moda Nossa", whatsapp: "84999990000", cidade: "Natal", cor: "#d23c8c", sobre: "Moda feminina em Natal.", entrega: "ambos", horario: "Segunda a sábado, 9h às 18h", bairrosAtendidos: "Tirol, Petrópolis", prazoEntrega: "Até 2 dias úteis" }) });
  assert.equal((await visual.json()).loja.cor, "#D23C8C");
  const fl = new FormData();
  fl.append("logo", new Blob([png], { type: "image/png" }), "logo.png");
  const comLogo = await (await req("/api/painel/logo", { method: "POST", body: fl, cookie })).json();
  assert.equal((await sharp(Buffer.from(await (await req(comLogo.loja.logo)).arrayBuffer())).metadata()).width, 400);
  await req("/api/painel/loja", { method: "PUT", headers: { "Content-Type": "application/json" }, cookie,
    body: JSON.stringify({ nome: "Moda Nossa", whatsapp: "84999990000", cidade: "Natal", cor: "red;}" }) });

  let v = await (await req("/api/vitrine")).json();
  assert.deepEqual(v.produtos.map((p) => p.loja), ["local", "amazon"]);
  assert.deepEqual([v.lojas[0].cor, v.lojas[0].sobre, v.lojas[0].logo], ["#D23C8C", "Moda feminina em Natal.", comLogo.loja.logo]);
  assert.deepEqual([v.lojas[0].horario, v.lojas[0].bairrosAtendidos, v.lojas[0].prazoEntrega], ["Segunda a sábado, 9h às 18h", "Tirol, Petrópolis", "Até 2 dias úteis"]);
  assert.equal(v.produtos[0].whatsapp, "5584999990000");
  assert.equal(v.lojas[0].slug, "moda-nossa");
  // Entrega: salva no 1º PUT e mantida no 2º, que não mandou o campo.
  assert.deepEqual([v.lojas[0].entrega, v.produtos[0].entrega], ["ambos", "ambos"]);
  assert.equal(v.produtos[0].disponibilidade, "disponivel");

  // Página individual renderizada no servidor, com SEO, descrição e compra local pelo WhatsApp.
  const pagina = await req(`/p/${v.produtos[0].id}`);
  assert.equal(pagina.status, 200);
  const html = await pagina.text();
  assert.match(html, /<meta property="og:title" content="Vestido midi · CITshop">/);
  assert.match(html, /<link rel="canonical" href="http:\/\/localhost:3000\/p\/l-[^"]+">/);
  assert.match(html, /<h1>Vestido midi<\/h1>/);
  assert.match(html, /Pedir pelo WhatsApp da loja/);
  assert.match(html, /Combine pagamento, disponibilidade e entrega diretamente com a loja/);
  assert.match(html, /Disponível, conforme informado pela loja/);
  assert.match(html, /Bairros atendidos: Tirol, Petrópolis/);
  assert.doesNotMatch(html, /<script type="module" src="\/vitrine\.js">/);
  assert.equal(html.match(/<title>/g).length, 1);
  const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual([jsonLd["@type"], jsonLd.name, jsonLd.offers.priceCurrency, jsonLd.offers.seller.name], ["Product", "Vestido midi", "BRL", "Moda Nossa"]);
  const og = html.match(/og:image" content="[^"]*(\/og\/[0-9a-f-]+\.jpg)"/)[1];
  const jpg = await req(og);
  assert.equal(jpg.headers.get("content-type"), "image/jpeg");
  assert.equal((await sharp(Buffer.from(await jpg.arrayBuffer())).metadata()).width, 1200);

  const contatoProduto = await req(`/contato/${encodeURIComponent(v.produtos[0].id)}`, { redirect: "manual" });
  assert.equal(contatoProduto.status, 302);
  assert.match(contatoProduto.headers.get("location"), /^https:\/\/wa\.me\/5584999990000\?/);
  const contatoLoja = await req(`/contato/loja/${v.lojas[0].slug}`, { redirect: "manual" });
  assert.equal(contatoLoja.status, 302);
  assert.match(contatoLoja.headers.get("location"), /^https:\/\/wa\.me\/5584999990000\?/);
  const painelComMetricas = await (await req("/api/painel/eu", { cookie })).json();
  assert.deepEqual([painelComMetricas.cliquesContatoLoja, painelComMetricas.produtos[0].cliquesContato], [1, 1]);
  const dadosPersistidos = JSON.parse(readFileSync(join(dir, "citshop.json"), "utf8"));
  assert.deepEqual(Object.values(dadosPersistidos.metricasContato).map((m) => m.total), [1, 1]);
  assert.equal(JSON.stringify(dadosPersistidos.metricasContato).includes("127.0.0.1"), false);
  assert.equal((await req("/p/nao-existe")).status, 404);
  assert.equal((await req("/og/../../etc.jpg")).status, 404);

  relogio += 31 * DIA; // teste acabou
  v = await (await req("/api/vitrine")).json();
  assert.deepEqual(v.produtos.map((p) => p.loja), ["amazon"]);
  assert.equal((await req("/api/painel/eu", { cookie })).status, 401); // sessão de 30 dias expirou
  cookie = cookieDe(await req("/api/painel/entrar", json({ email: "ana@loja.com", senha: "senha-forte" })));
  assert.equal((await (await req("/api/painel/eu", { cookie })).json()).status, "vencida");

  const assinar = await req("/api/painel/assinar", { method: "POST", cookie });
  assert.equal((await assinar.json()).url, "https://mp.test/checkout");

  // Webhook sem assinatura válida é recusado; com assinatura, o status é relido no MP.
  const corpo = { type: "subscription_preapproval", data: { id: "pa-1" } };
  assert.equal((await req("/webhook/mercadopago", json(corpo))).status, 401);
  const ts = "1700000000";
  const v1 = createHmac("sha256", SEGREDO_WEBHOOK).update(`id:pa-1;request-id:req-1;ts:${ts};`).digest("hex");
  const ok = await req("/webhook/mercadopago", json(corpo, { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" }));
  assert.equal(ok.status, 200);
  v = await (await req("/api/vitrine")).json();
  assert.equal(v.produtos[0].loja, "local");
  assert.equal((await (await req("/api/painel/eu", { cookie })).json()).status, "ativa");

  // Sem webhook: a sincronização periódica percebe o cancelamento e tira a loja da vitrine.
  statusMp = "cancelled";
  assert.equal(await sincronizar(), 1);
  v = await (await req("/api/vitrine")).json();
  assert.deepEqual(v.produtos.map((p) => p.loja), ["amazon"]);
  statusMp = "authorized";
  assert.equal(await sincronizar(), 1);
});

test("login confere senha; escrita vinda de outro site é recusada", async () => {
  assert.equal((await req("/api/painel/entrar", json({ email: "ana@loja.com", senha: "errada" }))).status, 401);
  assert.equal((await req("/api/painel/entrar", json({ email: "ana@loja.com", senha: "senha-forte" }))).status, 200);
  assert.equal((await req("/api/painel/entrar", json({ email: "ana@loja.com", senha: "senha-forte" }, { origin: "https://golpe.example" }))).status, 403);
  assert.equal((await req("/api/painel/eu")).status, 401);
});

test("admin suspende loja e ela sai da vitrine", async () => {
  assert.equal((await req("/api/admin/lojas")).status, 401);
  const cookie = cookieDe(await req("/api/admin/entrar", json({ senha: "admin123" })));
  const [loja] = await (await req("/api/admin/lojas", { cookie })).json();
  assert.equal(loja.senhaHash, undefined);
  assert.deepEqual([loja.cliquesContatoLoja, loja.produtos[0].cliquesContato, loja.produtos[0].disponibilidade], [1, 1, "disponivel"]);
  const r = await req(`/api/admin/lojas/${loja.id}/suspensa`, { ...json({ suspensa: true }), cookie });
  assert.equal(r.status, 200);
  const v = await (await req("/api/vitrine")).json();
  assert.equal(v.produtos.some((p) => p.loja === "local"), false);

  const foto = (await (await req("/api/admin/lojas", { cookie })).json())[0].produtos[0].foto;
  assert.equal((await req(`/api/admin/lojas/${loja.id}`, { method: "DELETE", cookie })).status, 200);
  assert.deepEqual(await (await req("/api/admin/lojas", { cookie })).json(), []);
  assert.equal((await req(foto)).status, 404); // foto apagada do disco
  assert.equal((await req(foto.replace("/uploads/", "/og/").replace(".webp", ".jpg"))).status, 404); // prévia em cache também
});

test("admin vê o estado da Amazon sem segredos e o teste pede credenciais", async () => {
  assert.equal((await req("/api/admin/amazon")).status, 401);
  const cookie = cookieDe(await req("/api/admin/entrar", json({ senha: "admin123" })));
  const st = await (await req("/api/admin/amazon", { cookie })).json();
  assert.deepEqual([st.configurada, st.marketplace, st.ultimaSincronizacao], [false, "www.amazon.com.br", null]);
  assert.equal(JSON.stringify(st).includes("segredo"), false);
  const teste = await req("/api/admin/amazon/testar", { ...json({ asin: "B0H3Q1RHD7" }), cookie });
  assert.equal(teste.status, 400);
  assert.match((await teste.json()).erro, /AMAZON_CREDENCIAL_ID/);
});

test("Amazon da API fica na vitrine por até 1 hora e substitui o item manual de mesmo ASIN", async () => {
  const quando = new Date(relogio).toISOString();
  writeFileSync(join(dir, "amazon.json"), JSON.stringify({ atualizadoEm: quando, produtos: [
    { id: "amazon-X", asin: "X", nome: "TV da API", loja: "amazon", categoria: "tec", preco: 90, precoAntigo: null, link: "https://www.amazon.com.br/dp/X?tag=citshop-20", atualizadoEm: quando },
  ] }));
  let v = await (await req("/api/vitrine")).json();
  const tv = v.produtos.filter((p) => p.id === "amazon-X");
  assert.equal(tv.length, 1);
  assert.deepEqual([tv[0].nome, tv[0].preco, tv[0].atualizadoEm], ["TV da API", 90, quando]);
  const paginaAfiliada = await (await req("/p/amazon-X")).text();
  assert.match(paginaAfiliada, /<h1>TV da API<\/h1>/);
  assert.match(paginaAfiliada, /href="https:\/\/www\.amazon\.com\.br\/dp\/X\?tag=citshop-20" target="_blank" rel="sponsored nofollow noopener"/);
  assert.equal((await req("/contato/amazon-X", { redirect: "manual" })).status, 404);
  assert.equal(Object.keys(JSON.parse(readFileSync(join(dir, "citshop.json"), "utf8")).metricasContato).length, 2);
  relogio += 61 * 60_000; // passou de 1 hora: o preço da API não pode mais aparecer
  v = await (await req("/api/vitrine")).json();
  assert.deepEqual(v.produtos.filter((p) => p.id === "amazon-X").map((p) => p.nome), ["TV"]);
});

test("admin troca a própria senha pelo painel", async () => {
  const cookie = cookieDe(await req("/api/admin/entrar", json({ senha: "admin123" })));
  assert.equal((await req("/api/admin/senha", { ...json({ atual: "errada", nova: "outra-senha-forte" }), cookie })).status, 400);
  assert.equal((await req("/api/admin/senha", { ...json({ atual: "admin123", nova: "outra-senha-forte" }), cookie })).status, 200);
  assert.equal((await req("/api/admin/entrar", json({ senha: "admin123" }))).status, 401);
  assert.equal((await req("/api/admin/entrar", json({ senha: "outra-senha-forte" }))).status, 200);

  // Esqueci a senha: um ADMIN_SENHA_HASH novo no Coolify volta a valer, mesmo com a troca gravada nos dados.
  const { app: resetado } = criarApp({ env: { SESSAO_SEGREDO: "x".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha("reset-123") }, log: {} });
  const s2 = await new Promise((ok) => { const s = resetado.listen(0, () => ok(s)); });
  const entrar2 = (senha) => fetch(`http://127.0.0.1:${s2.address().port}/api/admin/entrar`, json({ senha })).then((r) => r.status);
  try {
    assert.deepEqual([await entrar2("outra-senha-forte"), await entrar2("reset-123")], [401, 200]);
  } finally { s2.close(); }
});
