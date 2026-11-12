import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { aplicarCatalogo } from "../servidor/catalogo-loja.js";

const catalogo = JSON.parse(readFileSync(new URL("../servidor/catalogos/mimosdadelly.json", import.meta.url), "utf8"));

test("catálogo da Delly: 21 produtos, fotos existentes e preço antigo maior que o atual", () => {
  assert.equal(catalogo.produtos.length, 21);
  for (const p of catalogo.produtos) {
    assert.ok(existsSync(new URL(`../publico${p.fotos[0]}`, import.meta.url)), p.fotos[0]);
    assert.ok(p.precoAntigo > p.preco, p.nome);
  }
});

test("aplicarCatalogo troca só os produtos do catálogo, uma vez por versão", () => {
  const dir = mkdtempSync(join(tmpdir(), "cat-"));
  try {
    const banco = new Banco(dir);
    banco.d.lojas.push({ id: "loja-d", slug: "mimosdadelly" });
    banco.d.produtos.push(
      { id: "velho", lojaId: "loja-d", fotos: ["/delly/velho.webp"] },
      { id: "do-painel", lojaId: "loja-d", fotos: ["/uploads/x.webp"] },
      { id: "outra-loja", lojaId: "loja-x", fotos: ["/delly/y.webp"] },
    );
    assert.equal(aplicarCatalogo(banco, catalogo, "2026-11-12T12:00:00.000Z"), true);
    const ids = banco.produtos.map((p) => p.id);
    assert.ok(!ids.includes("velho") && ids.includes("do-painel") && ids.includes("outra-loja"));
    assert.equal(banco.produtos.filter((p) => p.lojaId === "loja-d").length, 22);
    const [primeiro, segundo] = banco.produtos.filter((p) => p.id.startsWith("delly-"));
    assert.ok(primeiro.criadoEm > segundo.criadoEm, "ordem do catálogo na vitrine");
    assert.equal(aplicarCatalogo(banco, catalogo, "2026-11-13T12:00:00.000Z"), false);
    assert.equal(new Banco(dir).d.catalogos.mimosdadelly, catalogo.versao);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
