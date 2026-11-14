import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarApp } from "../servidor/app.js";

const sp = (s) => Date.parse(`${s}:00-03:00`);

test("agenda de posts: na hora posta no Instagram e no canal do WhatsApp com o preço de agora, uma vez só; falha tenta de novo; atrasado demais não sai", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-agenda-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({ produtos: [{ id: "shopee-123456", loja: "shopee", nome: "Árvore de Natal 1,50m", categoria: "casa", preco: 99.9, precoAntigo: 120, vendidos: 1500, imagem: "https://down-br.img.susercontent.com/file/a.jpg", link: "https://s.shopee.com.br/a", atualizadoEm: "2026-11-14T00:00:00Z" }] }));
  writeFileSync(join(dir, "agenda.json"), JSON.stringify({ titulo: "🎄 Árvore de Natal com preço bom", whatsapp: ["123@newsletter"], posts: [
    { quando: "2026-11-14T04:30", produtoId: "shopee-123456" },
    { quando: "2026-11-14T08:00", produtoId: "shopee-123456" },
    { quando: "2026-11-14T09:00", produtoId: "shopee-999" },
  ] }));
  const insta = [], zap = [];
  let wahaFora = false;
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes("/api/sendText")) { if (wahaFora) return Response.json({ message: "WAHA fora" }, { status: 502 }); zap.push(JSON.parse(init.body)); return Response.json({ id: "z" }); }
    if (u.includes("debug_token")) return Response.json({ data: { is_valid: true, type: "PAGE", expires_at: 0 } });
    if (u.includes("/media_publish")) { insta.push(u); return Response.json({ id: `m${insta.length}` }); }
    if (u.includes("/media")) return Response.json({ id: "c1" });
    if (u.includes("status_code")) return Response.json({ status_code: "FINISHED" });
    return Response.json({});
  };
  let agora = sp("2026-11-14T07:59");
  const { postarAgendados, canais } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, AGENDA_POSTS: join(dir, "agenda.json"), INSTAGRAM_ACCOUNT_ID: "17", INSTAGRAM_ACCESS_TOKEN: "EAAtoken", WAHA_API_URL: "http://waha" },
    fetchImpl, agora: () => agora, log: { info() {}, warn() {}, error() {} },
  });
  canais.shopee = { estaConfigurado: () => true, precoAtual: async () => ({ preco: 89.9, precoAntigo: 120 }) };

  assert.deepEqual(await postarAgendados(), { postados: 0 }, "antes da hora (e o das 4h30 passou de 3 h)");
  agora = sp("2026-11-14T08:04");
  wahaFora = true;
  await assert.rejects(postarAgendados(), /123@newsletter: WAHA fora/);
  assert.equal(insta.length, 1, "o Instagram saiu mesmo com o WhatsApp fora");
  wahaFora = false;
  agora = sp("2026-11-14T08:09");
  assert.deepEqual(await postarAgendados(), { postados: 1 }, "na volta seguinte só o WhatsApp, que tinha falhado");
  assert.equal(insta.length, 1);
  assert.equal(zap[0].chatId, "123@newsletter");
  assert.match(zap[0].text, /^🎄 Árvore de Natal com preço bom\n\n\*Árvore de Natal 1,50m\*\nDe ~R\$\s120,00~ por \*R\$\s89,90\* \(25% OFF\)\n⭐ Mais de 1\.500 vendidos\n\n👉 http:\/\/localhost:3000\/p\/shopee-123456$/);
  assert.deepEqual(await postarAgendados(), { postados: 0 }, "não repete");

  agora = sp("2026-11-14T09:01");
  await assert.rejects(postarAgendados(), /shopee-999 saiu do catálogo/);
  assert.deepEqual(await postarAgendados(), { postados: 0 }, "produto que sumiu não fica tentando");
  assert.equal(insta.length + zap.length, 2);
});
