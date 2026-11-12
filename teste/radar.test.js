import test from "node:test";
import assert from "node:assert/strict";
import { ConectorWaha } from "../servidor/integracoes/whatsapp/waha.js";
import { RadarOfertas } from "../servidor/motor-ofertas/radar.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("ConectorWaha normaliza chatId corretamente para números, grupos e canais", () => {
  const w = new ConectorWaha({ apiUrl: "http://localhost:3000" });
  assert.equal(w.normalizarChatId("5584999999999"), "5584999999999@c.us");
  assert.equal(w.normalizarChatId("(84) 99999-9999"), "84999999999@c.us");
  assert.equal(w.normalizarChatId("120363000000000000@g.us"), "120363000000000000@g.us");
  assert.equal(w.normalizarChatId("123456789@newsletter"), "123456789@newsletter");
});

test("ConectorWaha verifica status da sessão WORKING", async () => {
  const fakeFetch = async (url) => {
    if (url.endsWith("/api/sessions")) {
      return {
        ok: true,
        json: async () => [{
          name: "default",
          status: "WORKING",
          me: { id: "558487278686@c.us", pushName: "Macaiba Gospel" },
        }],
      };
    }
    return { ok: false, status: 404 };
  };

  const w = new ConectorWaha({ fetchImpl: fakeFetch, session: "default" });
  const status = await w.verificarStatus();
  assert.equal(status.online, true);
  assert.equal(status.sessao, "default");
  assert.equal(status.numero, "558487278686@c.us");
});

test("RadarOfertas seleciona candidatos com desconto mínimo e respeita anti-spam de 24h", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-teste-"));
  try {
    const radar = new RadarOfertas({ dadosDir: dir });
    const produtos = [
      { id: "1", nome: "Camiseta Comum", preco: 50, precoAntigo: 50 }, // sem desconto
      { id: "2", nome: "Parafusadeira 11.11", preco: 95.9, precoAntigo: 299.9, selo: "11.11", vendidos: 3000 }, // 68% off
      { id: "3", nome: "Creatina Queda", preco: 40, precoAntigo: 80, queda: 40 }, // 50% off
    ];

    const selecionados = radar.selecionarCandidatos(produtos, { descontoMinimoPct: 25 });
    assert.equal(selecionados.length, 2);
    assert.equal(selecionados[0].id, "2"); // maior score
    assert.equal(selecionados[1].id, "3");

    // Simula envio do produto 2 e verifica que ele não é selecionado de novo na mesma janela
    radar.salvarHistoricoEnviados([{ id: "2", nome: "Parafusadeira", enviadoEm: new Date().toISOString() }]);
    const novaSelecao = radar.selecionarCandidatos(produtos, { descontoMinimoPct: 25 });
    assert.equal(novaSelecao.length, 1);
    assert.equal(novaSelecao[0].id, "3");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RadarOfertas formata mensagem para afiliados e lojas locais", () => {
  const radar = new RadarOfertas({ urlPublica: "https://shop.citmax.com.br" });

  // 1. Produto Afiliado com desconto
  const msgAfiliado = radar.formatarMensagem({
    id: "shopee-123",
    nome: "Fone Bluetooth TWS",
    preco: 29.9,
    precoAntigo: 99.9,
    link: "https://s.shopee.com.br/teste123",
    selo: "11.11",
    nota: 4.8,
    vendidos: 1500,
  });
  assert.equal(msgAfiliado.tipo, "afiliado");
  assert.match(msgAfiliado.texto, /SUPER PROMOÇÃO/); // o número da campanha (12.12...) vem de servidor/campanha.js
  assert.match(msgAfiliado.texto, /\/ir\/[^ ]+\?c=whatsapp/, "link pelo /ir com o canal WhatsApp");
  assert.ok(msgAfiliado.texto.includes("70% OFF"));

  // 2. Produto Loja Local
  const msgLocal = radar.formatarMensagem({
    id: "l-456",
    loja: "local",
    lojaNome: "Boutique Elegance",
    cidade: "Macaíba",
    nome: "Camiseta Algodão Egípcio",
    preco: 59.9,
    precoAntigo: 89.9,
  });
  assert.equal(msgLocal.tipo, "local");
  assert.ok(msgLocal.texto.includes("OFERTA LOCAL IMPERDÍVEL"));
  assert.ok(msgLocal.texto.includes("Boutique Elegance"));
  assert.ok(msgLocal.texto.includes("https://shop.citmax.com.br/p/l-456"));
  assert.ok(msgLocal.texto.includes("Escolha o modelo, tamanho e cor em nosso site"));
});

test("Rota /contato/:id monta WhatsApp com modelo, tamanho, cor e observações", async () => {
  const { criarApp } = await import("../servidor/app.js");
  const dir = mkdtempSync(join(tmpdir(), "contato-teste-"));
  let servidor = null;
  try {
    const banco = new (await import("../servidor/dados.js")).Banco(dir);
    banco.lojas.push({
      id: "loja-1",
      slug: "loja-moda",
      nome: "Loja Moda & Estilo",
      cidade: "Macaíba",
      whatsapp: "5584988887777",
      testeAte: new Date(Date.now() + 86400000).toISOString(),
    });
    banco.produtos.push({
      id: "prod-1",
      lojaId: "loja-1",
      nome: "Camiseta Silk Premium",
      preco: 49.9,
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

    const res = await fetch(`${base}/contato/l-prod-1?modelo=Slim&tamanho=G&cor=Preto&obs=Sem%20estampa`, {
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    const destinoRedirect = res.headers.get("location");
    assert.ok(destinoRedirect.includes("https://wa.me/5584988887777"));
    const decoded = decodeURIComponent(destinoRedirect);
    assert.ok(decoded.includes("Camiseta Silk Premium"));
    assert.ok(decoded.includes("*Modelo:* Slim"));
    assert.ok(decoded.includes("*Tamanho:* G"));
    assert.ok(decoded.includes("*Cor:* Preto"));
    assert.ok(decoded.includes("*Obs:* Sem estampa"));
    assert.ok(decoded.includes("https://shop.citmax.com.br/p/l-prod-1"));
  } finally {
    servidor?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

