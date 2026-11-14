import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

test("busca ao vivo: Shopee na hora (só com link de afiliado), Amazon pelo link de busca com a tag, e nada gravado", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-aovivo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { app, canais } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, AMAZON_TAG: "citshop0e-20" }, log: { info() {}, warn() {}, error() {} } });
  const termos = [];
  canais.shopee = {
    estaConfigurado: () => true,
    buscarPorTermo: async (termo) => {
      termos.push(termo);
      return [
        { itemId: 1, productName: "Geladeira Frost Free 375L", priceMin: "2899", imageUrl: "https://down-br.img.susercontent.com/file/g.jpg", offerLink: "https://s.shopee.com.br/g1", ratingStar: "4.8", sales: 120 },
        { itemId: 2, productName: "Sem link de afiliado", priceMin: "10", imageUrl: "https://down-br.img.susercontent.com/file/x.jpg", productLink: "https://shopee.com.br/x" },
      ];
    },
  };
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const get = async (q) => (await fetch(`http://127.0.0.1:${srv.address().port}/api/busca-ao-vivo?q=${encodeURIComponent(q)}`)).json();
  const r = await get("Geladeira!");
  assert.deepEqual(r.produtos.map((p) => [p.nome, p.preco, p.link, p.loja]), [["Geladeira Frost Free 375L", 2899, "https://s.shopee.com.br/g1", "shopee"]]);
  assert.equal(r.amazon, "https://www.amazon.com.br/s?k=geladeira&tag=citshop0e-20");
  await get("geladeira");
  assert.deepEqual(termos, ["geladeira"], "segunda busca igual sai da memória, sem nova consulta");
  assert.deepEqual(await get("12345678"), { produtos: [], amazon: null }, "número com cara de dado pessoal não é buscado");
  const vitrine = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/vitrine`)).json();
  assert.equal(vitrine.produtos.some((p) => p.id === "shopee-1"), false, "não entra na vitrine");
});
