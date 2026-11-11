/**
 * Interfaces e classes base para conectores de marketplaces e provedores de afiliados.
 * Garante padronização, tratamento seguro de erros e isolamento entre lojas.
 */

/**
 * Interface base para geração autorizada de links de afiliados.
 * Produtos sem atribuição de afiliado confirmada não podem ser publicados como ofertas afiliadas.
 */
export class ProvedorLinkAfiliado {
  /**
   * @param {object} params
   * @param {string} params.urlOriginal - URL pública do produto no marketplace
   * @param {string} [params.itemId] - Identificador único do item no marketplace
   * @param {string} [params.subId] - Identificador de rastreamento de campanha
   * @returns {Promise<string|null>} Retorna a URL com atribuição ou null se não autorizado
   */
  async gerarLinkAfiliado({ urlOriginal, itemId, subId }) {
    throw new Error("Método gerarLinkAfiliado() deve ser implementado pelo provedor");
  }

  /**
   * Valida se uma URL já possui a estrutura e parâmetros de afiliado esperados.
   * @param {string} url
   * @returns {boolean}
   */
  validarLinkAfiliado(url) {
    return false;
  }
}

/**
 * Erro específico de integração com marketplace.
 * Garante que mensagens de erro não vazem tokens, senhas ou segredos de API.
 */
export class ErroConector extends Error {
  constructor(marketplace, mensagem, codigoStatus = null) {
    // Remove potenciais tokens ou hashes da mensagem de erro
    const sanitizada = String(mensagem)
      .replace(/(Bearer\s+)[A-Za-z0-9_\-\.\:]+/gi, "$1[REDACTED]")
      .replace(/(key=|token=|secret=|password=|Signature=)[^&,\s]+/gi, "$1[REDACTED]");
    super(`[${marketplace}] ${sanitizada}`);
    this.name = "ErroConector";
    this.marketplace = marketplace;
    this.codigoStatus = codigoStatus;
    this.dataHora = new Date().toISOString();
  }
}

/**
 * Utilitário para executar requisições com timeout e retentativas com backoff exponencial.
 */
export async function executarComRetry(fn, { maxTentativas = 3, esperaInicialMs = 500, fatorBackoff = 2, log = console } = {}) {
  let tentativa = 1;
  let espera = esperaInicialMs;
  while (true) {
    try {
      return await fn();
    } catch (erro) {
      if (tentativa >= maxTentativas || erro.codigoStatus === 401 || erro.codigoStatus === 403) {
        throw erro;
      }
      log.warn?.(`[retry] Tentativa ${tentativa} falhou: ${erro.message}. Aguardando ${espera}ms...`);
      await new Promise((resolve) => setTimeout(resolve, espera));
      espera *= fatorBackoff;
      tentativa++;
    }
  }
}

/**
 * Classe base abstrata para todos os conectores de marketplace.
 */
export class ConectorMarketplace {
  constructor(nome) {
    if (!nome) throw new Error("Conector deve possuir um nome identificador.");
    this.nome = nome;
    this.ultimoStatus = {
      configurado: false,
      disponivel: false,
      ultimaConsulta: null,
      ultimoErro: null,
      totalColetado: 0,
    };
  }

  /**
   * Verifica se as credenciais e configurações mínimas estão presentes no ambiente.
   * @returns {boolean}
   */
  estaConfigurado() {
    return false;
  }

  /**
   * Busca ofertas por palavras-chave e/ou categorias no catálogo do marketplace.
   * @param {object} params
   * @param {string[]} [params.termos]
   * @param {string[]} [params.categorias]
   * @param {number} [params.limite]
   * @returns {Promise<object[]>} Lista de produtos brutos
   */
  async buscarOfertas({ termos = [], categorias = [], limite = 10 }) {
    throw new Error("buscarOfertas() deve ser implementado.");
  }

  /**
   * Converte o item bruto retornado pela API no formato canônico do CITshop.
   * @param {object} item
   * @returns {object|null}
   */
  normalizarItem(item) {
    throw new Error("normalizarItem() deve ser implementado.");
  }

  /**
   * Registra o resultado da última execução para auditoria.
   */
  registrarSucesso(total) {
    this.ultimoStatus = {
      ...this.ultimoStatus,
      disponivel: true,
      ultimaConsulta: new Date().toISOString(),
      ultimoErro: null,
      totalColetado: total,
    };
  }

  registrarErro(erro) {
    this.ultimoStatus = {
      ...this.ultimoStatus,
      disponivel: false,
      ultimaConsulta: new Date().toISOString(),
      ultimoErro: erro.message ?? String(erro),
    };
  }

  obterStatus() {
    return {
      nome: this.nome,
      ...this.ultimoStatus,
      configurado: this.estaConfigurado(),
    };
  }
}
