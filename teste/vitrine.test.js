import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

let dir, servidor, base;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "citshop-vitrine-"));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [
    { id: "amazon-L", nome: "Livro da região", loja: "amazon", categoria: "livros", preco: 19.9, fixo: true, link: "https://www.amazon.com.br/dp/L" },
    { id: "amazon-T", nome: "TV", loja: "amazon", categoria: "tec", preco: 90, queda: 30, menor30: true, link: "https://www.amazon.com.br/dp/T" },
    { id: "amazon-M", nome: "Café", loja: "amazon", categoria: "mercado", preco: 20, link: "https://www.amazon.com.br/dp/M" },
  ] }));
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "x".repeat(40), DADOS_DIR: dir }, log: {} });
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor?.close(); rmSync(dir, { recursive: true, force: true }); });

test("vitrine aceita os departamentos novos e repassa os selos de preço", async () => {
  const v = await (await fetch(`${base}/api/vitrine`)).json();
  const por = Object.fromEntries(v.produtos.map((p) => [p.id, p]));
  assert.deepEqual([por["amazon-L"].dept, por["amazon-L"].fixo], ["livros", true]);
  assert.deepEqual([por["amazon-T"].queda, por["amazon-T"].menor30], [30, true]);
  assert.deepEqual([por["amazon-M"].dept, por["amazon-M"].menor30, por["amazon-M"].fixo], ["mercado", false, false]);
});

test("/black-friday abre a vitrine", async () => {
  const r = await fetch(`${base}/black-friday`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /id="r-quedas"/);
});
