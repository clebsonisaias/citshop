/**
 * Publicador do Motor de Ofertas: consolida a esteira, valida, ranqueia
 * e grava atomicamente os arquivos de vitrine, garantindo preservação do catálogo anterior
 * e prioridade intocada dos produtos dos lojistas locais.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { normalizarProduto } from "./normalizador.js";
import { deduplicarProdutos } from "./deduplicador.js";
import { filtrarValidos } from "./validador.js";
import { ranquearOfertas } from "./ranking.js";
import { aplicarHistorico } from "../coletor.js";

export class PublicadorOfertas {
  constructor({ dadosDir, manualPath, log = console } = {}) {
    this.dadosDir = dadosDir;
    this.manualPath = manualPath;
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

  /**
   * Publica os novos produtos coletados na vitrine pública.
   * Aplica a REGRA DO ÚLTIMO CATÁLOGO VÁLIDO: se um marketplace falhar na rodada,
   * os produtos válidos anteriores dele continuam preservados na vitrine.
   */
  async publicar({ novosColetados = [], statusPorLoja = {}, configuracao = {} } = {}) {
    const caminhoAfiliados = join(this.dadosDir, "afiliados.json");
    const caminhoHistorico = join(this.dadosDir, "historico.json");
    const caminhoStatus = join(this.dadosDir, "motor-status.json");

    // 1. Lê catálogo anterior (com fallback para coleta.json se afiliados.json ainda não estiver populado)
    let anterior = (await this.lerJsonSeguro(caminhoAfiliados, { produtos: [] }))?.produtos || [];
    if (anterior.length < 10) {
      const caminhoColeta = join(this.dadosDir, "coleta.json");
      const coleta = await this.lerJsonSeguro(caminhoColeta, { produtos: [] });
      if (Array.isArray(coleta?.produtos) && coleta.produtos.length) {
        anterior = [...anterior, ...coleta.produtos];
      }
    }

    // 2. Lê itens do manual.json (se existirem)
    let manuais = [];
    if (this.manualPath) {
      manuais = (await this.lerJsonSeguro(this.manualPath, [])) || [];
    }

    // 3. Normaliza novos e manuais
    const normalizadosNovos = novosColetados.map(normalizarProduto).filter(Boolean);
    const normalizadosManuais = manuais.map(normalizarProduto).filter(Boolean);

    // 4. Regra de preservação do último catálogo válido por marketplace
    const porLoja = new Map();
    for (const p of normalizadosNovos) {
      const loja = p.marketplace || p.loja;
      if (!porLoja.has(loja)) porLoja.set(loja, []);
      porLoja.get(loja).push(p);
    }

    const consolidado = [...normalizadosManuais];

    // Para cada marketplace conhecido, decide se usa a nova rodada ou preserva anterior
    const marketplaces = ["amazon", "shopee", "mercado-livre"];
    for (const mp of marketplaces) {
      const status = statusPorLoja[mp];
      const novosDaLoja = porLoja.get(mp) || [];

      if (novosDaLoja.length > 0) {
        consolidado.push(...novosDaLoja);
      } else if (status && !status.ok) {
        // Se a loja falhou, preserva as anteriores dela
        const anterioresDaLoja = anterior.filter((p) => (p.marketplace || p.loja) === mp);
        this.log.warn?.(`[publicador] Preservando ${anterioresDaLoja.length} produtos anteriores de ${mp} devido a falha na coleta.`);
        consolidado.push(...anterioresDaLoja);
      } else if (!status || status.ignorado) {
        // Se estava desligado/ignorado, mantém o que já existia
        const anterioresDaLoja = anterior.filter((p) => (p.marketplace || p.loja) === mp);
        consolidado.push(...anterioresDaLoja);
      }
    }

    // 5. Deduplicação
    const { produtos: deduplicados, totalRemovidos } = deduplicarProdutos(consolidado);

    // 6. Validação estrita de critérios de qualidade e link de afiliado
    const { aprovados, rejeitados } = filtrarValidos(deduplicados);

    // 7. Aplicação de histórico de preços para cálculo de selos (queda / menor30)
    let historico = (await this.lerJsonSeguro(caminhoHistorico, {})) || {};
    const { produtos: comHistorico, historico: novoHistorico } = aplicarHistorico(aprovados, historico);

    // 8. Ranquear e aplicar limites
    const finalRanqueados = ranquearOfertas(comHistorico, {
      limitePorCategoria: configuracao.limitePorCategoria || 15,
      limiteTotal: configuracao.limiteTotal || 200,
    });

    // 9. Gravação atômica dos dados
    await this.salvarJsonAtomico(caminhoHistorico, novoHistorico);
    await this.salvarJsonAtomico(caminhoAfiliados, {
      atualizadoEm: new Date().toISOString(),
      produtos: finalRanqueados,
    });

    // 10. Atualiza status do motor para o Admin
    const statusGeral = {
      ultimaExecucao: new Date().toISOString(),
      totalPublicados: finalRanqueados.length,
      totalDesativados: rejeitados.length,
      totalDuplicadosIgnorados: totalRemovidos,
      porMarketplace: {
        amazon: finalRanqueados.filter((p) => (p.marketplace || p.loja) === "amazon").length,
        shopee: finalRanqueados.filter((p) => (p.marketplace || p.loja) === "shopee").length,
        "mercado-livre": finalRanqueados.filter((p) => (p.marketplace || p.loja) === "mercado-livre").length,
      },
      statusPorLoja,
      desativadosRecentes: rejeitados.slice(0, 20).map(({ produto, motivos }) => ({
        id: produto.id,
        nome: produto.nome,
        loja: produto.marketplace || produto.loja,
        motivos,
      })),
    };

    await this.salvarJsonAtomico(caminhoStatus, statusGeral);
    return statusGeral;
  }
}
