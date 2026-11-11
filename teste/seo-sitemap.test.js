import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

let dir, servidor, base;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "citshop-seo-"));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({
    produtos: [
      { id: "amazon-T", nome: "TV Smart", loja: "amazon", categoria: "tec", preco: 999, link: "https://www.amazon.com.br/dp/T?tag=citshop-20" },
    ],
  }));
  const { app } = criarApp({
    env: { SESSAO_SEGREDO: "x".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br" },
    log: {},
  });
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor?.close(); rmSync(dir, { recursive: true, force: true }); });

test("robots.txt é servido e libera explicitamente robôs de IA", async () => {
  const r = await fetch(`${base}/robots.txt`);
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.match(txt, /User-agent: GPTBot/);
  assert.match(txt, /User-agent: ClaudeBot/);
  assert.match(txt, /User-agent: PerplexityBot/);
  assert.match(txt, /Sitemap: https:\/\/shop\.citmax\.com\.br\/sitemap\.xml/);
});

test("/sitemap.xml gera XML válido com rotas públicas e produtos", async () => {
  const r = await fetch(`${base}/sitemap.xml`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /xml/);
  const xml = await r.text();
  assert.match(xml, /<loc>https:\/\/shop\.citmax\.com\.br\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/shop\.citmax\.com\.br\/black-friday<\/loc>/);
  assert.match(xml, /<loc>https:\/\/shop\.citmax\.com\.br\/p\/amazon-T<\/loc>/);
});

test("página inicial contém canonical, h1 semântico e dados estruturados", async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/shop\.citmax\.com\.br\/"/);
  assert.match(html, /<h1 class="sr-only">CITshop · Comparador de Ofertas, Lojas Locais e Grandes Marketplaces<\/h1>/);
  assert.match(html, /"FAQPage"/);
  assert.match(html, /"WebSite"/);
  assert.match(html, /"Organization"/);
  assert.match(html, /Perguntas Frequentes \(FAQ\)/);
});
