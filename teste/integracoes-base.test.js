import test from "node:test";
import assert from "node:assert/strict";
import { ConectorMarketplace, ErroConector, ProvedorLinkAfiliado, executarComRetry } from "../servidor/integracoes/base.js";

test("ErroConector sanitiza tokens e senhas das mensagens de erro", () => {
  const err = new ErroConector("amazon", "Falha de auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 & token=supersecret123");
  assert.ok(!err.message.includes("supersecret123"));
  assert.ok(err.message.includes("[REDACTED]"));
  assert.equal(err.marketplace, "amazon");
});

test("ProvedorLinkAfiliado lança se método não for implementado", async () => {
  const provedor = new ProvedorLinkAfiliado();
  await assert.rejects(
    () => provedor.gerarLinkAfiliado({ urlOriginal: "https://example.com" }),
    /deve ser implementado/
  );
  assert.equal(provedor.validarLinkAfiliado("https://example.com"), false);
});

test("executarComRetry retenta até o limite em falhas recuperáveis", async () => {
  let chamadas = 0;
  const resultado = await executarComRetry(
    async () => {
      chamadas++;
      if (chamadas < 3) throw new ErroConector("teste", "timeout temporário", 504);
      return "sucesso";
    },
    { maxTentativas: 3, esperaInicialMs: 10, fatorBackoff: 1, log: { warn: () => {} } }
  );

  assert.equal(resultado, "sucesso");
  assert.equal(chamadas, 3);
});

test("executarComRetry não retenta em erro de autenticação 401 ou 403", async () => {
  let chamadas = 0;
  await assert.rejects(
    () =>
      executarComRetry(
        async () => {
          chamadas++;
          throw new ErroConector("teste", "não autorizado", 401);
        },
        { maxTentativas: 3, esperaInicialMs: 10, log: { warn: () => {} } }
      ),
    /não autorizado/
  );
  assert.equal(chamadas, 1);
});

test("ConectorMarketplace registra sucesso e erro mantendo o histórico de status", () => {
  class ConectorTeste extends ConectorMarketplace {
    constructor() { super("teste"); }
    estaConfigurado() { return true; }
  }

  const conector = new ConectorTeste();
  assert.equal(conector.obterStatus().configurado, true);
  assert.equal(conector.obterStatus().disponivel, false);

  conector.registrarSucesso(15);
  assert.equal(conector.obterStatus().disponivel, true);
  assert.equal(conector.obterStatus().totalColetado, 15);
  assert.equal(conector.obterStatus().ultimoErro, null);

  conector.registrarErro(new Error("falha de conexão"));
  assert.equal(conector.obterStatus().disponivel, false);
  assert.equal(conector.obterStatus().ultimoErro, "falha de conexão");
});
