import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("Rotas da Central de Ofertas no Admin exigem autenticação e funcionam corretamente", async () => {
  const dir = mkdtempSync(join(tmpdir(), "citshop-admin-test-"));
  const senhaHash = gerarHashSenha("admin123");

  const { app } = criarApp({
    env: {
      SESSAO_SEGREDO: "x".repeat(40),
      DADOS_DIR: dir,
      ADMIN_SENHA_HASH: senhaHash,
    },
    log: {},
  });

  let servidor;
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    // 1. Sem login deve responder 401
    const resSemLogin = await fetch(`${base}/api/admin/central-ofertas`);
    assert.equal(resSemLogin.status, 401);

    // 2. Faz login de admin
    const loginRes = await fetch(`${base}/api/admin/entrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: "admin123" }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get("set-cookie").split(";")[0];

    // 3. Com login, acessa status da central
    const statusRes = await fetch(`${base}/api/admin/central-ofertas`, {
      headers: { cookie },
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.ok(statusData.configuracao);
    assert.ok(statusData.porMarketplace);

    // 4. Atualiza configurações
    const putRes = await fetch(`${base}/api/admin/central-ofertas/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ limiteTotal: 300 }),
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.configuracao.limiteTotal, 300);

    // 5. Dispara execução
    const execRes = await fetch(`${base}/api/admin/central-ofertas/executar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    assert.equal(execRes.status, 200);
    const execData = await execRes.json();
    assert.equal(execData.ok, true);
  } finally {
    servidor.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
