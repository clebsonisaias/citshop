/**
 * Orquestrador de coleta: executa as buscas nos conectores configurados
 * de forma paralela e independente, com isolamento total de falhas.
 */
import { ConectorAmazon } from "../integracoes/amazon/conector.js";
import { ConectorShopee } from "../integracoes/shopee/conector.js";
import { ConectorMercadoLivre } from "../integracoes/mercado-livre/conector.js";
import { ConectorShein } from "../integracoes/shein/conector.js";

export class ColetorOfertas {
  constructor({
    conectorAmazon = new ConectorAmazon(),
    conectorShopee = new ConectorShopee(),
    conectorMercadoLivre = new ConectorMercadoLivre(),
    conectorShein = new ConectorShein(),
    log = console,
  } = {}) {
    this.conectores = {
      amazon: conectorAmazon,
      shopee: conectorShopee,
      "mercado-livre": conectorMercadoLivre,
      shein: conectorShein,
    };
    this.log = log;
  }

  /**
   * Executa a coleta em todos os conectores paralelamente.
   * A falha de um marketplace não interrompe os outros.
   * @param {object} params - Configurações de termos/limites por loja
   * @returns {Promise<{ resultados: object[], erros: object[], statusPorLoja: object }>}
   */
  async coletarTodos(config = {}) {
    const tarefas = Object.entries(this.conectores).map(async ([nome, conector]) => {
      if (!conector.estaConfigurado()) {
        return { nome, itens: [], ignorado: true, motivo: "Não configurado" };
      }
      try {
        const confLoja = config[nome] || {};
        const itens = await conector.buscarOfertas(confLoja);
        return { nome, itens, ok: true };
      } catch (e) {
        this.log.error?.(`[coletor] Erro na coleta do marketplace ${nome}: ${e.message}`);
        return { nome, itens: [], erro: e.message, ok: false };
      }
    });

    const resultadosTarefas = await Promise.allSettled(tarefas);
    const todosItens = [];
    const erros = [];
    const statusPorLoja = {};

    for (const res of resultadosTarefas) {
      if (res.status === "fulfilled") {
        const { nome, itens, ok, erro, ignorado } = res.value;
        statusPorLoja[nome] = {
          ok: Boolean(ok),
          total: itens?.length || 0,
          ignorado: Boolean(ignorado),
          erro: erro || null,
        };
        if (itens?.length) todosItens.push(...itens);
        if (erro) erros.push({ marketplace: nome, erro });
      } else {
        erros.push({ marketplace: "desconhecido", erro: res.reason?.message });
      }
    }

    return {
      itens: todosItens,
      erros,
      statusPorLoja,
    };
  }
}
