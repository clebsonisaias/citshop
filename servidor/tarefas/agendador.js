/**
 * Agendador independente por marketplace com bloqueio de execução (mutex).
 * Garante que coletas simultâneas não ocorram e que a falha de uma loja não bloqueie as demais.
 */
import { ColetorOfertas } from "../motor-ofertas/coletor.js";
import { PublicadorOfertas } from "../motor-ofertas/publicador.js";
import { MonitoramentoMotor } from "./monitoramento.js";

export class AgendadorOfertas {
  constructor({
    dadosDir,
    manualPath,
    coletor = new ColetorOfertas(),
    publicador = null,
    monitoramento = null,
    log = console,
  } = {}) {
    this.dadosDir = dadosDir;
    this.manualPath = manualPath;
    this.coletor = coletor;
    this.publicador = publicador || new PublicadorOfertas({ dadosDir, manualPath, log });
    this.monitoramento = monitoramento || new MonitoramentoMotor({ dadosDir, log });
    this.log = log;

    // Mutex por marketplace para impedir coletas sobrepostas
    this.bloqueios = new Map();
    this.timers = new Map();
  }

  isBloqueado(marketplace = "geral") {
    return Boolean(this.bloqueios.get(marketplace));
  }

  adquirirLock(marketplace = "geral") {
    if (this.isBloqueado(marketplace)) return false;
    this.bloqueios.set(marketplace, true);
    return true;
  }

  liberarLock(marketplace = "geral") {
    this.bloqueios.set(marketplace, false);
  }

  /**
   * Executa a coleta completa de todos os marketplaces ou de um marketplace específico.
   * Não lança exceção: registra o status em motor-status.json.
   */
  async executarRodada({ marketplace = null } = {}) {
    const lockKey = marketplace || "geral";
    if (!this.adquirirLock(lockKey)) {
      this.log.warn?.(`[agendador] Rodada de ${lockKey} ignorada: já existe uma coleta em andamento.`);
      return { status: "ocupado" };
    }

    try {
      this.log.info?.(`[agendador] Iniciando coleta do motor de ofertas (${lockKey})...`);
      const config = await this.monitoramento.obterConfiguracao();

      let itensColetados = [];
      let statusPorLoja = {};

      if (marketplace && this.coletor.conectores[marketplace]) {
        const conector = this.coletor.conectores[marketplace];
        if (conector.estaConfigurado()) {
          try {
            const rawTermos = config.termosPorMarketplace?.[marketplace] || [];
            const termos = marketplace === "shopee" && rawTermos.length < 10 ? [] : rawTermos;
            const itens = await conector.buscarOfertas({ termos, limite: config.limitePorCategoria || 25 });
            itensColetados.push(...itens);
            statusPorLoja[marketplace] = { ok: true, total: itens.length };
          } catch (e) {
            statusPorLoja[marketplace] = { ok: false, erro: e.message };
          }
        } else {
          statusPorLoja[marketplace] = { ok: false, ignorado: true, motivo: "Não configurado" };
        }
      } else {
        // Coleta todos
        const shopeeRaw = config.termosPorMarketplace?.shopee || [];
        const termosShopee = shopeeRaw.length >= 10 ? shopeeRaw : [];
        const res = await this.coletor.coletarTodos({
          amazon: { termos: config.termosPorMarketplace?.amazon, limite: config.limitePorCategoria || 25 },
          shopee: { termos: termosShopee, limite: config.limitePorCategoria || 25 },
          "mercado-livre": { termos: config.termosPorMarketplace?.["mercado-livre"], limite: config.limitePorCategoria || 25 },
        });
        itensColetados = res.itens;
        statusPorLoja = res.statusPorLoja;
      }

      // Publica os resultados aplicando validação, ranking e preservação de histórico
      const statusFinal = await this.publicador.publicar({
        novosColetados: itensColetados,
        statusPorLoja,
        configuracao: config,
      });

      this.log.info?.(`[agendador] Coleta ${lockKey} finalizada. ${statusFinal.totalPublicados} ofertas na vitrine.`);
      return statusFinal;
    } catch (e) {
      this.log.error?.(`[agendador] Falha geral na execução do motor: ${e.message}`);
      return { erro: e.message };
    } finally {
      this.liberarLock(lockKey);
    }
  }

  /**
   * Inicia os timers de agendamento independente.
   */
  iniciarAgendamentos() {
    this.pararAgendamentos();

    // Roda uma rodada inicial de subida
    this.executarRodada().catch(() => {});

    // Agenda timers independentes (Amazon a cada 50min, Shopee e ML a cada 4h)
    const timerAmazon = setInterval(() => {
      this.executarRodada({ marketplace: "amazon" }).catch(() => {});
    }, 50 * 60 * 1000);
    timerAmazon.unref?.();
    this.timers.set("amazon", timerAmazon);

    const timerShopee = setInterval(() => {
      this.executarRodada({ marketplace: "shopee" }).catch(() => {});
    }, 4 * 60 * 60 * 1000);
    timerShopee.unref?.();
    this.timers.set("shopee", timerShopee);

    const timerML = setInterval(() => {
      this.executarRodada({ marketplace: "mercado-livre" }).catch(() => {});
    }, 4 * 60 * 60 * 1000);
    timerML.unref?.();
    this.timers.set("mercado-livre", timerML);
  }

  pararAgendamentos() {
    for (const [nome, timer] of this.timers.entries()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
