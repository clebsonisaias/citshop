import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco, lojaVisivel, statusLoja } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";

test("Loja parceira com modelo comissao_fixa fica sempre visível e suporta rota direta", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-teste-parceira-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const banco = new Banco(dir);
  const loja = {
    id: "loja-mimosdadelly",
    nome: "Mimos da Delly",
    slug: "mimosdadelly",
    responsavel: "Delly",
    email: "mimosdadelly@teste.com",
    whatsapp: "5584991720022",
    cidade: "Macaíba",
    modeloCobranca: "comissao_fixa",
    comissaoPorVenda: 1.00,
    criadaEm: new Date().toISOString(),
    suspensa: false,
  };
  banco.lojas.push(loja);
  banco.salvar();

  assert.equal(lojaVisivel(loja), true, "Loja de comissão fixa deve ser visível");
  assert.equal(statusLoja(loja), "parceira", "Status da loja parceira deve ser 'parceira'");

  const env = {
    SESSAO_SEGREDO: "12345678901234567890123456789012",
    DADOS_DIR: dir,
    URL_PUBLICA: "https://shop.citmax.com.br",
  };
  const { app } = criarApp({ env, log: { info: () => {}, warn: () => {}, error: () => {} } });

  // Testa se a rota /mimosdadelly responde com o HTML da vitrine sem redirecionar
  await new Promise((resolve, reject) => {
    const srv = app.listen(0, async () => {
      try {
        const porta = srv.address().port;
        const res = await fetch(`http://127.0.0.1:${porta}/mimosdadelly`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /CIT Shopping/);
        srv.close(resolve);
      } catch (err) {
        srv.close(() => reject(err));
      }
    });
  });
});
