import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("saúde: /saude público sem detalhes; falha repetida avisa no WhatsApp só com a sessão conectada, sem repetir", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-saude-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let online = false;
  const enviados = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/api/sessions")) return Response.json([{ name: "default", status: online ? "WORKING" : "SCAN_QR_CODE", me: { id: "5584999990000@c.us" } }]);
    if (u.includes("/api/sendText")) { enviados.push(JSON.parse(init.body)); return Response.json({ id: "m1" }); }
    return Response.json({});
  };
  const senhaAdmin = randomBytes(8).toString("hex");
  const { app, tarefa, tarefas } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senhaAdmin) }, fetchImpl, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;

  let quebrar = true;
  const rodar = tarefa("coletor", async () => { if (quebrar) throw new Error("token=segredo expirou"); return 1; });
  await rodar();
  assert.equal(enviados.length, 0, "1 falha não avisa");
  await rodar();
  assert.deepEqual([enviados.length, tarefas.coletor.alerta], [0, "whatsapp desconectado"], "sem sessão conectada não envia");
  online = true;
  await rodar();
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].text, /coletor.*3 vezes/s);
  await rodar();
  assert.equal(enviados.length, 1, "não repete antes de 6 horas");

  const pub = await (await fetch(`${base}/saude`)).json();
  assert.deepEqual([pub.ok, pub.tarefasComFalha], [true, ["coletor"]]);
  assert.ok(!JSON.stringify(pub).includes("segredo"), "erro não aparece no público");
  assert.equal((await fetch(`${base}/api/admin/saude`)).status, 401);
  const admin = (await fetch(`${base}/api/admin/entrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: senhaAdmin }) })).headers.get("set-cookie").split(";")[0];
  const det = await (await fetch(`${base}/api/admin/saude`, { headers: { cookie: admin } })).json();
  assert.deepEqual([det.tarefas.coletor.falhasSeguidas, det.whatsapp.online], [4, true]);

  quebrar = false;
  assert.equal(await rodar(), 1);
  assert.deepEqual((await (await fetch(`${base}/saude`)).json()).tarefasComFalha, []);
});

test("backup: uma cópia por dia, guarda as 14 mais novas e não mexe no banco", async (t) => {
  const { Banco } = await import("../servidor/dados.js");
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "cit-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const b = new Banco(dir);
  b.lojas.push({ id: "x" }); b.salvar();
  const dia = Date.parse("2026-11-01T12:00:00Z");
  for (let i = 0; i < 20; i++) b.backup(dia + i * 86_400_000);
  b.backup(dia + 19 * 86_400_000); // mesmo dia: sobrescreve
  const lista = readdirSync(join(dir, "backups")).sort();
  assert.deepEqual([lista.length, lista[0], lista.at(-1)], [14, "citshop-2026-11-07.json", "citshop-2026-11-20.json"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "backups", lista[0]), "utf8")).lojas, [{ id: "x" }]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "citshop.json"), "utf8")).lojas, [{ id: "x" }]);
});
