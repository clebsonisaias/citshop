/**
 * Monitoramento, auditoria e persistência de configurações do Motor de Ofertas.
 * Armazena histórico de execuções, erros e métricas sem expor credenciais.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

export const CONFIG_PADRAO_MOTOR = {
  limitePorCategoria: 12,
  limiteTotal: 180,
  intervaloMinutos: {
    amazon: 50,
    shopee: 240,
    "mercado-livre": 240,
    shein: 240,
  },
  termosPorMarketplace: {
    amazon: ["fone bluetooth", "air fryer", "smartwatch", "kindle"],
    shopee: ["fone bluetooth", "smartwatch", "air fryer", "luminaria led", "cama pet"],
    "mercado-livre": ["furadeira parafusadeira", "creatina", "jogo de panelas", "aspirador robo"],
    shein: ["vestido", "camisa", "bolsa", "tenis", "maquiagem"],
  },
  categoriasMonitoradas: ["tec", "cel", "cozinha", "casa", "ferr", "esporte", "pets"],
};

export class MonitoramentoMotor {
  constructor({ dadosDir, log = console } = {}) {
    this.dadosDir = dadosDir;
    this.caminhoConfig = join(dadosDir, "motor-config.json");
    this.caminhoStatus = join(dadosDir, "motor-status.json");
    this.caminhoMetricas = join(dadosDir, "motor-metricas.json");
    this.log = log;
  }

  async lerJsonSeguro(caminho, fallback = null) {
    try {
      const conteudo = await readFile(caminho, "utf8");
      return JSON.parse(conteudo);
    } catch {
      return fallback;
    }
  }

  async salvarJsonAtomico(caminho, dado) {
    const tmp = `${caminho}.tmp`;
    await writeFile(tmp, JSON.stringify(dado, null, 2));
    await rename(tmp, caminho);
  }

  async obterConfiguracao() {
    const salva = await this.lerJsonSeguro(this.caminhoConfig);
    return salva ? { ...CONFIG_PADRAO_MOTOR, ...salva } : { ...CONFIG_PADRAO_MOTOR };
  }

  async salvarConfiguracao(novaConfig) {
    const atual = await this.obterConfiguracao();
    const mesclada = {
      ...atual,
      ...novaConfig,
      intervaloMinutos: { ...atual.intervaloMinutos, ...(novaConfig.intervaloMinutos || {}) },
      termosPorMarketplace: { ...atual.termosPorMarketplace, ...(novaConfig.termosPorMarketplace || {}) },
    };
    await this.salvarJsonAtomico(this.caminhoConfig, mesclada);
    return mesclada;
  }

  async obterStatus() {
    const status = await this.lerJsonSeguro(this.caminhoStatus, {
      ultimaExecucao: null,
      totalPublicados: 0,
      totalDesativados: 0,
      totalDuplicadosIgnorados: 0,
      porMarketplace: { amazon: 0, shopee: 0, "mercado-livre": 0, shein: 0 },
      statusPorLoja: {},
      desativadosRecentes: [],
    });
    const config = await this.obterConfiguracao();
    const metricas = await this.obterMetricas();

    return {
      ...status,
      configuracao: config,
      metricas,
    };
  }

  async registrarClique(produtoId, marketplace) {
    const metricas = await this.obterMetricas();
    const hoje = new Date().toISOString().slice(0, 10);

    metricas.totalCliques = (metricas.totalCliques || 0) + 1;
    metricas.cliquesPorMarketplace[marketplace] = (metricas.cliquesPorMarketplace[marketplace] || 0) + 1;

    if (!metricas.cliquesPorDia[hoje]) metricas.cliquesPorDia[hoje] = 0;
    metricas.cliquesPorDia[hoje]++;

    await this.salvarJsonAtomico(this.caminhoMetricas, metricas);
  }

  async obterMetricas() {
    return await this.lerJsonSeguro(this.caminhoMetricas, {
      totalCliques: 0,
      cliquesPorMarketplace: { amazon: 0, shopee: 0, "mercado-livre": 0, shein: 0 },
      cliquesPorDia: {},
    });
  }
}
