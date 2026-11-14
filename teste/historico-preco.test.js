import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

test("/api/preco/:id devolve o preço de cada dia do histórico; local, desconhecido e id estranho voltam vazios", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-hist-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dias = Array.from({ length: 35 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`.replace(/-(3[2-9])$/, "-31"), 100 - i]);
  writeFileSync(join(dir, "historico.json"), JSON.stringify({ "shopee-1": [["2026-11-10", 120], ["2026-11-11", 99.9], ["lixo", 5], ["2026-11-12", 0]], "amazon-B0X": dias }));
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const get = async (id) => (await (await fetch(`http://127.0.0.1:${srv.address().port}/api/preco/${encodeURIComponent(id)}`)).json()).pontos;
  assert.deepEqual(await get("shopee-1"), [["2026-11-10", 120], ["2026-11-11", 99.9]], "ignora dia inválido e preço zero");
  assert.equal((await get("amazon-B0X")).length, 30, "no máximo 30 dias");
  assert.deepEqual(await get("shopee-999"), []);
  assert.deepEqual(await get("l-laco"), []);
  assert.deepEqual(await get("../citshop"), []);
});
