import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

test("preço na hora: abrir o produto da Shopee consulta a API, mostra o preço novo e a vitrine passa a usá-lo; 30 min sem nova consulta", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-preco-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [{ id: "shopee-123456", loja: "shopee", nome: "Vela Natal", categoria: "casa", preco: 1000, imagem: "https://down-br.img.susercontent.com/file/v.jpg", link: "https://s.shopee.com.br/v", atualizadoEm: "2026-11-14T00:00:00Z" }] }));
  let relogio = Date.parse("2026-11-14T12:00:00Z");
  const { app, canais } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir }, agora: () => relogio, log: { info() {}, warn() {}, error() {} } });
  const consultas = [];
  canais.shopee = { estaConfigurado: () => true, precoAtual: async (itemId) => { consultas.push(itemId); return { preco: 826.16, precoAntigo: 995.37 }; } };
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;

  const pagina = await (await fetch(`${base}/p/shopee-123456`)).text();
  assert.match(pagina, /826,16/);
  const vitrine = await (await fetch(`${base}/api/vitrine`)).json();
  assert.deepEqual([vitrine.produtos[0].preco, vitrine.produtos[0].precoAntigo], [826.16, 995.37]);
  const agora = await (await fetch(`${base}/api/preco-agora/shopee-123456`)).json();
  assert.equal(agora.preco, 826.16);
  assert.deepEqual(consultas, ["123456"], "segunda consulta em menos de 30 min sai da memória");
  relogio += 31 * 60_000;
  await fetch(`${base}/api/preco-agora/shopee-123456`);
  assert.equal(consultas.length, 2, "passou de 30 min: consulta de novo");
  assert.deepEqual(await (await fetch(`${base}/api/preco-agora/shopee-999`)).json(), {}, "produto fora da vitrine não consulta a API");
  assert.equal(consultas.length, 2);
});
