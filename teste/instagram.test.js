import test from "node:test";
import assert from "node:assert/strict";
import { ConectorInstagram } from "../servidor/integracoes/instagram/conector.js";
import { GeradorCardInstagram, quebrarTexto, medirTexto } from "../servidor/integracoes/instagram/gerador-card.js";
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("ConectorInstagram formata legenda com chamada QUERO e preço formatado", () => {
  const insta = new ConectorInstagram();
  const produto = {
    id: "shopee-123",
    nome: "Fone Bluetooth TWS Pro",
    preco: 29.9,
    precoAntigo: 99.9,
    vendidos: 3500,
  };

  const legenda = insta.formatarLegenda(produto);
  assert.ok(legenda.includes("Fone Bluetooth TWS Pro"));
  assert.match(legenda, /R\$\s29,90/);
  assert.ok(legenda.includes("70% OFF"));
  assert.ok(legenda.includes('Comente "QUERO"'));
  assert.ok(legenda.includes("@citshopping"));
  assert.ok(!legenda.includes("11.11") && !legenda.includes("*") && !legenda.includes("~"), "sem data fixa nem marcação do WhatsApp");
  assert.ok(insta.formatarLegenda({ ...produto, loja: "amazon" }).includes("#amazon"));
});

test("GeradorCardInstagram gera imagem JPEG 1080x1080 válida", async () => {
  const gerador = new GeradorCardInstagram({
    fetchImpl: async () => ({ ok: false }), // fallback se não tiver rede
  });

  const produto = {
    id: "shopee-123",
    nome: "Pistola de Massagem Muscular Elétrica",
    preco: 31.49,
    precoAntigo: 224.93,
    selo: "11.11",
  };

  const buffer = await gerador.gerarCardFeed(produto);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000, "Buffer JPEG gerado com dados");
});

test("GeradorCardInstagram gera imagem vertical JPEG 1080x1920 para Stories", async () => {
  const gerador = new GeradorCardInstagram({
    fetchImpl: async () => ({ ok: false }),
  });

  const produto = {
    id: "shopee-123",
    nome: "Pistola de Massagem Muscular Elétrica",
    preco: 31.49,
    precoAntigo: 224.93,
    selo: "11.11",
  };

  const buffer = await gerador.gerarCardStories(produto);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000, "Buffer Stories gerado com dados");
});

test("Rotas /bio e /api/instagram/card/:id respondem corretamente", async () => {
  const { criarApp } = await import("../servidor/app.js");
  const dir = mkdtempSync(join(tmpdir(), "insta-teste-"));
  let servidor = null;

  try {
    const banco = new (await import("../servidor/dados.js")).Banco(dir);
    banco.lojas.push({
      id: "l1",
      slug: "loja-1",
      nome: "Loja Teste",
      cidade: "Macaíba",
      whatsapp: "5584999999999",
      testeAte: new Date(Date.now() + 86400000).toISOString(),
    });
    banco.produtos.push({
      id: "p1",
      lojaId: "l1",
      nome: "Camiseta Teste",
      preco: 50,
      dept: "moda",
      ativo: true,
      criadoEm: new Date().toISOString(),
    });
    banco.d.instagramPosts = { m1: { produtoId: "l-p1" } };
    banco.salvar();

    const directs = [];
    const { app } = criarApp({
      env: {
        SESSAO_SEGREDO: "12345678901234567890123456789012",
        DADOS_DIR: dir,
        URL_PUBLICA: "https://shop.citmax.com.br",
        INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "tok-teste",
        INSTAGRAM_APP_SECRET: "segredo-app",
        INSTAGRAM_PAGE_ACCESS_TOKEN: "token-pagina",
        INSTAGRAM_ACCOUNT_ID: "conta-cit",
      },
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/me/messages")) { directs.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ message_id: "x" }) }; }
        return { ok: false, json: async () => ({}) };
      },
      log: { info() {}, error() {}, warn() {} },
    });

    await new Promise((ok) => { servidor = app.listen(0, ok); });
    const porta = servidor.address().port;
    const base = `http://127.0.0.1:${porta}`;

    // 1. Testa rota /bio
    const resBio = await fetch(`${base}/bio`);
    assert.equal(resBio.status, 200);
    const htmlBio = await resBio.text();
    assert.ok(htmlBio.includes("@citshopping"));
    assert.ok(htmlBio.includes("Canal VIP no WhatsApp"));
    assert.ok(!htmlBio.includes("<script>"), "sem script inline: a CSP do site bloqueia");
    assert.deepEqual(await (await fetch(`${base}/api/instagram/feed`)).json(), { ids: ["l-p1"] });

    // 2. Testa rota /api/instagram/card/l-p1
    const resCard = await fetch(`${base}/api/instagram/card/l-p1`);
    assert.equal(resCard.status, 200);
    assert.equal(resCard.headers.get("content-type"), "image/jpeg");
    const bytes = await resCard.arrayBuffer();
    assert.ok(bytes.byteLength > 1000);

    // 3. Testa rota /api/instagram/card-stories/l-p1
    const resStories = await fetch(`${base}/api/instagram/card-stories/l-p1`);
    assert.equal(resStories.status, 200);
    assert.equal(resStories.headers.get("content-type"), "image/jpeg");
    const bytesStories = await resStories.arrayBuffer();
    assert.ok(bytesStories.byteLength > 1000);

    // 4. Verificação da Meta só com o token configurado (o antigo, fixo no código, não vale mais)
    assert.equal((await fetch(`${base}/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=citshop-ig-secret&hub.challenge=1`)).status, 403);
    const resHookGet = await fetch(`${base}/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=tok-teste&hub.challenge=115599`);
    assert.equal(resHookGet.status, 200);
    assert.equal(await resHookGet.text(), "115599");

    // 5. Evento sem assinatura é recusado; assinado, o QUERO recebe o link do produto do post
    const comentario = (id, text, media = "m1", from = "cliente") => ({ field: "comments", value: { id, text, media: { id: media }, from: { id: from } } });
    const corpo = JSON.stringify({ entry: [{ changes: [comentario("c1", "EU QUERO!"), comentario("c2", "não quero, caro"), comentario("c3", "quero", "m1", "conta-cit")] }, { changes: [comentario("c4", "manda o link", "outro")] }] });
    assert.equal((await fetch(`${base}/api/webhook/instagram`, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo })).status, 401);
    const assinatura = "sha256=" + createHmac("sha256", "segredo-app").update(corpo).digest("hex");
    const resHookPost = await fetch(`${base}/api/webhook/instagram`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": assinatura }, body: corpo });
    assert.equal(resHookPost.status, 200);
    assert.equal(await resHookPost.text(), "EVENT_RECEIVED");
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(directs.map((d) => d.recipient.comment_id), ["c1", "c4"], "responde c1 e c4; ignora 'não quero' e a própria conta");
    assert.match(directs[0].message.text, /https:\/\/shop\.citmax\.com\.br\/ir\/l-p1\?c=instagram/, "link pela /ir (clique contado no canal Instagram)");
    assert.match(directs[1].message.text, /\/bio/);
    assert.equal(directs[0].access_token, "token-pagina");
  } finally {
    servidor?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GeradorCardInstagram lê foto do site (publico/) e não sai das pastas com ..", async () => {
  const dir = mkdtempSync(join(tmpdir(), "card-"));
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dir, "pub", "loja"), { recursive: true });
    writeFileSync(join(dir, "pub", "loja", "foto.webp"), "img");
    writeFileSync(join(dir, "segredo.txt"), "nao");
    const g = new GeradorCardInstagram({ publicoDir: join(dir, "pub"), dadosDir: join(dir, "dados"), fetchImpl: async () => ({ ok: false }) });
    assert.equal(String(await g.baixarImagemProduto("/loja/foto.webp")), "img");
    assert.equal(await g.baixarImagemProduto("/../segredo.txt"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quebrarTexto mede a largura real: nenhuma linha passa do limite, nem com maiúsculas", async () => {
  const nome = "KIT MEGA PROMOÇÃO WWW MMM FAIXAS LAÇOS TIARAS BICO DE PATO COLOR DUO MAXIMUS PREMIUM";
  const linhas = await quebrarTexto(nome, 40, 960, 2);
  assert.equal(linhas.length, 2);
  for (const l of linhas) assert.ok(await medirTexto(l, 40) <= 960, `linha larga demais: ${l}`);
  assert.ok(linhas[1].endsWith("…"));
  assert.ok(nome.startsWith(linhas.join(" ").replace("…", "")), "não corta palavra no meio");
  assert.deepEqual(await quebrarTexto("Laço 🎀 rosa", 38, 960, 2), ["Laço rosa"]);
  assert.deepEqual(await quebrarTexto("Tiara laço verde", 40, 960, 2), ["Tiara laço verde"]);
});
