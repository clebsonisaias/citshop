import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";

test("story diário: só lojas de mensalidade ativa, 1 por dia a partir das 10h, em rodízio", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-story-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const criada = "2026-01-01T00:00:00Z";
  const banco = new Banco(dir);
  const loja = (id, extra) => ({ id, slug: id, nome: id, cidade: "Natal", whatsapp: "5584999990001", criadaEm: criada, testeAte: criada, ...extra });
  banco.lojas.push(
    loja("paga1", { assinatura: { status: "authorized" } }),
    loja("paga2", { assinatura: { status: "authorized" } }),
    loja("teste", { testeAte: "2999-01-01T00:00:00Z" }),
    loja("parceira", { modeloCobranca: "comissao_fixa" }),
  );
  for (const l of ["paga1", "paga2", "teste", "parceira"]) banco.produtos.push({ id: `p-${l}`, lojaId: l, nome: `Produto ${l}`, dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: criada });
  banco.salvar();
  writeFileSync(join(dir, "motor-config.json"), JSON.stringify({ instagram: { storyDiario: true } }));

  let relogio = Date.parse("2026-11-12T09:30:00-03:00");
  const imagens = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url), corpo = init.body ? JSON.parse(init.body) : {};
    if (u.endsWith("/media") && corpo.media_type === "STORIES") { imagens.push(corpo.image_url); return { ok: true, json: async () => ({ id: "c1" }) }; }
    if (u.includes("/c1?fields=status_code")) return { ok: true, json: async () => ({ status_code: "FINISHED" }) };
    if (u.endsWith("/media_publish")) return { ok: true, json: async () => ({ id: "s1" }) };
    return { ok: false, json: async () => ({}) };
  };
  const { publicarStoryDoDia } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br", INSTAGRAM_ACCOUNT_ID: "conta", INSTAGRAM_ACCESS_TOKEN: "token-de-teste" },
    fetchImpl, agora: () => relogio, log: { info() {}, warn() {}, error() {} },
  });

  assert.equal((await publicarStoryDoDia()).publicado, false, "antes das 10h não publica");
  relogio = Date.parse("2026-11-12T10:05:00-03:00");
  const r1 = await publicarStoryDoDia();
  assert.equal(r1.publicado, true);
  assert.ok(["paga1", "paga2"].includes(r1.loja), "só loja de mensalidade ativa");
  assert.equal((await publicarStoryDoDia()).publicado, false, "um por dia");
  relogio = Date.parse("2026-11-13T11:00:00-03:00");
  const r2 = await publicarStoryDoDia();
  assert.notEqual(r2.loja, r1.loja, "rodízio entre as lojas");
  assert.equal(imagens.length, 2);
  assert.match(imagens[0], /\/api\/instagram\/card-stories\/l-p-paga/);
});
