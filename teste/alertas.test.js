import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";

test("alerta de preço: cria uma vez por número, avisa só quando baixa, cancela e expira", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-alertas-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const banco = new Banco(dir);
  banco.lojas.push({ id: "l1", slug: "l1", nome: "Loja", cidade: "Natal", whatsapp: "5584999990001", criadaEm: agora, testeAte: "2999-01-01T00:00:00Z" });
  banco.produtos.push({ id: "p1", lojaId: "l1", nome: "Laço", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.d.alertas = [{ id: "velho", produtoId: "l-p1", whatsapp: "5584900000009", precoBase: 50, criadoEm: "2020-01-01T00:00:00Z" }];
  banco.salvar();
  const enviados = [];
  const { app, banco: b, verificarAlertas } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br" },
    fetchImpl: async (url, init) => { if (String(url).endsWith("/api/sendText")) enviados.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) }; },
    log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (corpo) => fetch(`${base}/api/alertas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

  assert.equal((await post({ produtoId: "l-p1", whatsapp: "123" })).status, 400);
  assert.equal((await post({ produtoId: "l-p1", whatsapp: "(84) 98888-7777" })).status, 200);
  assert.equal((await post({ produtoId: "l-p1", whatsapp: "84988887777" })).status, 200);
  assert.equal(b.d.alertas.filter((a) => a.whatsapp === "5584988887777").length, 1, "um alerta por número e produto");

  // Sem queda: ninguém é avisado; o alerta de 2020 expira
  await verificarAlertas();
  assert.equal(enviados.length, 0);
  assert.ok(!b.d.alertas.some((a) => a.id === "velho"));

  // Preço caiu: aviso com link do produto e de cancelar; o alerta acaba
  b.produto("p1").preco = 8.9;
  await verificarAlertas();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].chatId, "5584988887777@c.us");
  assert.match(enviados[0].text, /Baixou de preço/);
  assert.match(enviados[0].text, /\/p\/l-p1/);
  assert.match(enviados[0].text, /\/alertas\/cancelar\//);
  assert.equal(b.d.alertas.length, 0);

  // Cancelar pelo link
  await post({ produtoId: "l-p1", whatsapp: "84988887777" });
  const id = b.d.alertas[0].id;
  assert.equal((await fetch(`${base}/alertas/cancelar/${id}`)).status, 200);
  assert.equal(b.d.alertas.length, 0);
});
