import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filtrarCampanhas } from "../servidor/afiliados-canal.js";
import { ConectorShopee } from "../servidor/integracoes/shopee/conector.js";
import { criarApp } from "../servidor/app.js";

const agora = Date.parse("2026-11-12T12:00:00Z");
const camp = (id, extra = {}) => ({ id, nome: `Campanha ${id}`, imagem: "https://down-br.img.susercontent.com/file/x.jpg", link: "https://s.shopee.com.br/abc", inicio: "2026-11-01T00:00:00Z", fim: "2026-11-20T00:00:00Z", ...extra });

test("campanhas: só as válidas e no prazo, sem repetir, as que acabam primeiro na frente", () => {
  const r = filtrarCampanhas([
    camp("a", { fim: "2026-11-25T00:00:00Z" }), camp("b", { fim: "2026-11-13T00:00:00Z" }), camp("b"),
    camp("vencida", { fim: "2026-11-11T00:00:00Z" }), camp("futura", { inicio: "2026-11-15T00:00:00Z" }),
    camp("imagem", { imagem: "https://golpe.example/x.jpg" }), camp("link", { link: "https://golpe.example/x" }), camp("semnome", { nome: "" }),
  ], agora);
  assert.deepEqual(r.map((c) => c.id), ["b", "a"]);
});

test("conector: busca campanhas e, se a API recusar um campo, tenta de novo só com o essencial", async () => {
  const consultas = [];
  const fetchImpl = async (url, init) => {
    const { query } = JSON.parse(init.body);
    consultas.push(query);
    if (query.includes("collectionId")) return Response.json({ errors: [{ message: "Cannot query field collectionId" }] });
    return Response.json({ data: { shopeeOfferV2: { nodes: [{ offerName: "Ofertas 12.12", imageUrl: "https://down-br.img.susercontent.com/file/y.jpg", offerLink: "https://s.shopee.com.br/c1", periodStartTime: 1762900000, periodEndTime: 1765000000 }] } } });
  };
  const r = await new ConectorShopee({ appId: "a", segredo: "s", fetchImpl }).buscarCampanhas({ limite: 10 });
  assert.equal(consultas.length >= 2, true);
  assert.deepEqual([r[0].nome, r[0].link, r[0].id], ["Ofertas 12.12", "https://s.shopee.com.br/c1", "campanha-Ofertas1212"]);
  assert.ok(r[0].fim.startsWith("2025-12-06"));
});

test("vitrine: campanhas sem o link (só pelo /ir, que conta o clique); vencida some; /ir leva ao link da campanha", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-camp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const futuro = new Date(Date.now() + 864e5).toISOString(), passado = new Date(Date.now() - 864e5).toISOString();
  writeFileSync(join(dir, "campanhas.json"), JSON.stringify({ campanhas: [camp("campanha-x", { inicio: passado, fim: futuro }), camp("campanha-velha", { inicio: passado, fim: passado })] }));
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const v = await (await fetch(`${base}/api/vitrine`)).json();
  assert.deepEqual(v.campanhasShopee.map((c) => Object.keys(c).sort()), [["fim", "id", "imagem", "nome"]]);
  const ir = await fetch(`${base}/ir/campanha-x?c=site`, { redirect: "manual" });
  assert.deepEqual([ir.status, ir.headers.get("location")], [302, "https://s.shopee.com.br/abc"]);
  assert.equal((await fetch(`${base}/ir/campanha-velha`, { redirect: "manual" })).headers.get("location"), "/", "vencida não redireciona");
});
