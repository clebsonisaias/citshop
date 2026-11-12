import test from "node:test";
import assert from "node:assert/strict";
import { ConectorInstagram } from "../servidor/integracoes/instagram/conector.js";
import { GeradorCardInstagram } from "../servidor/integracoes/instagram/gerador-card.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("ConectorInstagram formata legenda com chamada EU QUERO e preço formatado", () => {
  const insta = new ConectorInstagram();
  const produto = {
    id: "shopee-123",
    nome: "Fone Bluetooth TWS Pro",
    preco: 29.9,
    precoAntigo: 99.9,
    vendidos: 3500,
  };

  const legenda = insta.formatarLegenda(produto);
  assert.ok(legenda.includes("ALERTA DE QUEDA DE PREÇO"));
  assert.ok(legenda.includes("Fone Bluetooth TWS Pro"));
  assert.ok(legenda.includes("R$ 29,90"));
  assert.ok(legenda.includes("70% OFF"));
  assert.ok(legenda.includes('Comente "EU QUERO"'));
  assert.ok(legenda.includes("@citshopping"));
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
    banco.salvar();

    const { app } = criarApp({
      env: {
        SESSAO_SEGREDO: "12345678901234567890123456789012",
        DADOS_DIR: dir,
        URL_PUBLICA: "https://shop.citmax.com.br",
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

    // 4. Testa webhook de verificação da Meta
    const resHookGet = await fetch(`${base}/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=citshop-ig-secret&hub.challenge=115599`);
    assert.equal(resHookGet.status, 200);
    const bodyChallenge = await resHookGet.text();
    assert.equal(bodyChallenge, "115599");

    // 5. Testa webhook POST
    const resHookPost = await fetch(`${base}/api/webhook/instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry: [{
          changes: [{
            field: "comments",
            value: { id: "c1", text: "EU QUERO o link por favor!" },
          }],
        }],
      }),
    });
    assert.equal(resHookPost.status, 200);
    const textHook = await resHookPost.text();
    assert.equal(textHook, "EVENT_RECEIVED");
  } finally {
    servidor?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
