import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

const sp = (s) => Date.parse(`${s}:00-03:00`);

test("agenda de posts: na hora posta no Instagram e no canal do WhatsApp com o preço de agora, uma vez só; falha tenta de novo; atrasado demais não sai", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-agenda-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [{ id: "shopee-123456", loja: "shopee", nome: "Árvore de Natal 1,50m", categoria: "casa", preco: 99.9, precoAntigo: 120, vendidos: 1500, imagem: "https://down-br.img.susercontent.com/file/a.jpg", link: "https://s.shopee.com.br/a", atualizadoEm: "2026-11-14T00:00:00Z" }] }));
  writeFileSync(join(dir, "agenda.json"), JSON.stringify({ titulo: "🎄 Árvore de Natal com preço bom", whatsapp: ["123@newsletter"], posts: [
    { quando: "2026-11-14T04:30", produtoId: "shopee-123456" },
    { quando: "2026-11-14T08:00", produtoId: "shopee-123456" },
    { quando: "2026-11-14T09:00", produtoId: "shopee-999" },
  ] }));
  const insta = [], zap = [];
  let wahaFora = false;
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (/\/api\/send(Text|Image)/.test(u)) { if (wahaFora) return Response.json({ message: "WAHA fora" }, { status: 502 }); const b = JSON.parse(init.body); zap.push({ ...b, text: b.text ?? b.caption }); return Response.json({ id: "z" }); }
    if (u.includes("debug_token")) return Response.json({ data: { is_valid: true, type: "PAGE", expires_at: 0 } });
    if (u.includes("/media_publish")) { insta.push(u); return Response.json({ id: `m${insta.length}` }); }
    if (u.includes("/media")) return Response.json({ id: "c1" });
    if (u.includes("status_code")) return Response.json({ status_code: "FINISHED" });
    return Response.json({});
  };
  let agora = sp("2026-11-14T07:59");
  const { postarAgendados, canais } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, AGENDA_POSTS: join(dir, "agenda.json"), INSTAGRAM_ACCOUNT_ID: "17", INSTAGRAM_ACCESS_TOKEN: "EAAtoken", WAHA_API_URL: "http://waha" },
    fetchImpl, agora: () => agora, log: { info() {}, warn() {}, error() {} },
  });
  canais.shopee = { estaConfigurado: () => true, precoAtual: async () => ({ preco: 89.9, precoAntigo: 120 }) };

  assert.deepEqual(await postarAgendados(), { postados: 0 }, "antes da hora (e o das 4h30 passou de 3 h)");
  agora = sp("2026-11-14T08:04");
  wahaFora = true;
  await assert.rejects(postarAgendados(), /123@newsletter: WAHA fora/);
  assert.equal(insta.length, 1, "o Instagram saiu mesmo com o WhatsApp fora");
  wahaFora = false;
  agora = sp("2026-11-14T08:09");
  assert.deepEqual(await postarAgendados(), { postados: 1 }, "na volta seguinte só o WhatsApp, que tinha falhado");
  assert.equal(insta.length, 1);
  assert.equal(zap[0].chatId, "123@newsletter");
  assert.equal(zap[0].file.url, "http://localhost:3000/api/instagram/card-whatsapp/shopee-123456", "vai o card da marca, com o texto na legenda");
  assert.match(zap[0].text, /^🎄 Árvore de Natal com preço bom\n\n\*Árvore de Natal 1,50m\*\nDe ~R\$\s120,00~ por \*R\$\s89,90\* \(25% OFF\)\n⭐ Mais de 1\.500 vendidos\n\n👉 http:\/\/localhost:3000\/p\/shopee-123456$/);
  assert.deepEqual(await postarAgendados(), { postados: 0 }, "não repete");

  agora = sp("2026-11-14T09:01");
  await assert.rejects(postarAgendados(), /shopee-999 saiu do catálogo/);
  assert.deepEqual(await postarAgendados(), { postados: 0 }, "produto que sumiu não fica tentando");
  assert.equal(insta.length + zap.length, 2);
});

test("agenda de posts: produto fora do catálogo vem da cópia na agenda (página /p/ e post), com título do dia; sem preço confirmado na Shopee não posta", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-agenda2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [] }));
  const copia = (id, nome) => ({ id, externalId: id.slice(7), marketplace: "shopee", loja: "shopee", nome, categoria: "eletronicos", preco: 999, precoAntigo: 1500, nota: 4.9, vendidos: 300, imagem: "https://down-br.img.susercontent.com/file/tv.jpg", link: "https://s.shopee.com.br/tv" });
  writeFileSync(join(dir, "agenda.json"), JSON.stringify({ titulo: "geral", whatsapp: ["123@newsletter"], posts: [
    { quando: "2026-11-17T08:00", produtoId: "shopee-777777", titulo: "📺 Smart TV com preço bom", produto: copia("shopee-777777", "Smart TV 43") },
    { quando: "2026-11-17T09:00", produtoId: "shopee-888888", titulo: "📺 Smart TV com preço bom", produto: copia("shopee-888888", "Smart TV 50") },
  ] }));
  const zap = [];
  const fetchImpl = async (url, init) => (/\/api\/send(Text|Image)/.test(String(url)) ? (zap.push((({ text, caption, ...r }) => ({ ...r, text: text ?? caption }))(JSON.parse(init.body))), Response.json({ id: "z" })) : Response.json({}));
  let agora = sp("2026-11-17T08:01");
  const { app, postarAgendados, canais } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, AGENDA_POSTS: join(dir, "agenda.json"), WAHA_API_URL: "http://waha" }, fetchImpl, agora: () => agora, log: { info() {}, warn() {}, error() {} } });
  canais.shopee = { estaConfigurado: () => true, precoAtual: async (itemId) => (itemId === "777777" ? { preco: 949.9, precoAntigo: 1500 } : null) };
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());

  assert.deepEqual(await postarAgendados(), { postados: 1 });
  assert.match(zap[0].text, /^📺 Smart TV com preço bom\n\n\*Smart TV 43\*\nDe ~R\$\s1\.500,00~ por \*R\$\s949,90\*/, "título do dia e preço confirmado agora");
  const pagina = await fetch(`http://127.0.0.1:${srv.address().port}/p/shopee-777777`);
  assert.equal(pagina.status, 200, "o link do post abre a página do produto");
  assert.match(await pagina.text(), /949,90/);
  assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/api/vitrine`).then((r) => r.json())).produtos.length, 0, "não entra na vitrine");

  agora = sp("2026-11-17T09:01");
  await assert.rejects(postarAgendados(), /shopee-888888: a Shopee não confirmou o preço de agora/);
  assert.equal(zap.length, 1);
});

test("lojas da cidade: todo dia 1 produto de cada loja visível, cada loja no seu horário, produtos em rodízio; esgotado e loja sem produto ficam de fora", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-locais-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [] }));
  writeFileSync(join(dir, "agenda.json"), JSON.stringify({ whatsapp: ["123@newsletter"], posts: [] }));
  const zap = [];
  const fetchImpl = async (url, init) => (/\/api\/send(Text|Image)/.test(String(url)) ? (zap.push((({ text, caption, ...r }) => ({ ...r, text: text ?? caption }))(JSON.parse(init.body))), Response.json({ id: "z" })) : Response.json({}));
  let agora = sp("2026-11-15T00:05");
  const { postarAgendados, banco } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, AGENDA_POSTS: join(dir, "agenda.json"), WAHA_API_URL: "http://waha" }, fetchImpl, agora: () => agora, log: { info() {}, warn() {}, error() {} } });
  const loja = (id, nome) => ({ id, slug: id, nome, cidade: "Macaíba", categoria: "Moda", whatsapp: "5584900000001", criadaEm: "2026-11-01T00:00:00Z", testeAte: "2999-01-01T00:00:00Z" });
  banco.lojas.push(loja("delly", "Mimos da Delly"), loja("vazia", "Loja Sem Foto"));
  const produto = (id, lojaId, extra = {}) => ({ id, lojaId, nome: `Laço ${id}`, dept: "moda", preco: 5.9, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: "2026-11-01T00:00:00Z", ...extra });
  banco.produtos.push(produto("a", "delly"), produto("b", "delly"), produto("c", "delly", { ativo: false }), produto("d", "vazia", { fotos: [] }));

  assert.deepEqual(await postarAgendados(), { postados: 0 }, "antes das 10h30 nada sai");
  agora = sp("2026-11-15T10:31");
  assert.deepEqual(await postarAgendados(), { postados: 1 }, "só a Delly tem produto: sai 1");
  assert.match(zap[0].text, /^📍 Achado local: Mimos da Delly \(Macaíba\)\n\n\*Laço a\*\nPor \*R\$\s5,90\*\n\n👉 http:\/\/localhost:3000\/p\/l-a$/);
  assert.deepEqual(await postarAgendados(), { postados: 0 }, "não repete no mesmo dia");

  agora = sp("2026-11-16T10:31");
  await postarAgendados();
  assert.match(zap[1].text, /\*Laço b\*/, "no outro dia, o próximo produto da loja");
  agora = sp("2026-11-17T10:31");
  await postarAgendados();
  assert.match(zap[2].text, /\*Laço a\*/, "passou por todos: recomeça");

  banco.lojas.push(loja("bia", "Bia Modas"));
  banco.produtos.push(produto("e", "bia"));
  agora = sp("2026-11-18T12:31");
  assert.deepEqual(await postarAgendados(), { postados: 2 }, "duas lojas: uma às 10h30, outra às 12h30");
  assert.deepEqual(zap.slice(3).map((m) => m.text.split("\n")[0]).sort(), ["📍 Achado local: Bia Modas (Macaíba)", "📍 Achado local: Mimos da Delly (Macaíba)"]);

  // Horário perdido (servidor fora do ar de manhã): a loja ainda sai no mesmo dia, não no seguinte.
  agora = sp("2026-11-19T15:00");
  assert.deepEqual(await postarAgendados(), { postados: 2 }, "10h30 e 12h30 saem às 15h, atrasados mas no dia");
  agora = sp("2026-11-20T00:10");
  assert.deepEqual(await postarAgendados(), { postados: 0 }, "virou o dia: o plano é novo e ainda não é hora");
});
