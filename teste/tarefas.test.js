import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgendadorOfertas } from "../servidor/tarefas/agendador.js";
import { MonitoramentoMotor } from "../servidor/tarefas/monitoramento.js";

test("MonitoramentoMotor: salva configuração e registra cliques sem expor segredos", async () => {
  const dir = await mkdtemp(join(tmpdir(), "citshop-mon-test-"));
  try {
    const mon = new MonitoramentoMotor({ dadosDir: dir });
    const conf = await mon.obterConfiguracao();
    assert.ok(Array.isArray(conf.categoriasMonitoradas));

    await mon.salvarConfiguracao({ limiteTotal: 250 });
    const confAtualizada = await mon.obterConfiguracao();
    assert.equal(confAtualizada.limiteTotal, 250);

    await mon.registrarClique("shopee-123", "shopee");
    const metricas = await mon.obterMetricas();
    assert.equal(metricas.totalCliques, 1);
    assert.equal(metricas.cliquesPorMarketplace.shopee, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AgendadorOfertas: bloqueia execuções simultâneas com mutex", async () => {
  const dir = await mkdtemp(join(tmpdir(), "citshop-sched-test-"));
  try {
    let coletando = false;
    const mockColetor = {
      conectores: {
        amazon: {
          estaConfigurado: () => true,
          buscarOfertas: async () => {
            coletando = true;
            await new Promise((r) => setTimeout(r, 50));
            coletando = false;
            return [];
          },
        },
      },
      coletarTodos: async () => ({ itens: [], statusPorLoja: {} }),
    };

    const agendador = new AgendadorOfertas({
      dadosDir: dir,
      coletor: mockColetor,
      publicador: { publicar: async () => ({ totalPublicados: 0 }) },
    });

    assert.equal(agendador.adquirirLock("amazon"), true);
    // Segunda tentativa simultânea deve ser negada
    assert.equal(agendador.adquirirLock("amazon"), false);

    agendador.liberarLock("amazon");
    assert.equal(agendador.adquirirLock("amazon"), true);
    agendador.liberarLock("amazon");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
