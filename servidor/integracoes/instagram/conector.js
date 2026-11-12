/**
 * Conector oficial da Meta Graph API para Instagram Graph API (v21.0).
 * Permite publicar imagens de ofertas no Feed e Stories do perfil @citshopping.
 */

const GRAPH_API = "https://graph.facebook.com/v21.0";

export class ConectorInstagram {
  constructor({
    accountId = process.env.INSTAGRAM_ACCOUNT_ID || null,
    accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || null,
    pageAccessToken = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || null,
    aoPublicar = null,
    fetchImpl = fetch,
    esperaMs = 2000,
  } = {}) {
    this.accountId = accountId;
    this.accessToken = accessToken;
    // Resposta no direct (private reply) exige token de Página com instagram_manage_messages.
    this.pageAccessToken = pageAccessToken;
    // Chamado com { mediaId, produtoId } a cada post no Feed: liga o post ao produto para o QUERO.
    this.aoPublicar = aoPublicar;
    this.fetchImpl = fetchImpl;
    this.esperaMs = esperaMs;
  }

  /** Espera a Meta terminar de baixar a imagem do container antes de publicar (status_code FINISHED). */
  async esperarContainer(id, tentativas = 10) {
    for (let i = 0; i < tentativas; i++) {
      const res = await this.fetchImpl(`${GRAPH_API}/${id}?fields=status_code&access_token=${encodeURIComponent(this.accessToken)}`);
      const d = await res.json().catch(() => ({}));
      if (d.status_code === "FINISHED" || (!d.status_code && res.ok)) return;
      if (d.status_code === "ERROR" || d.status_code === "EXPIRED") throw new Error(`Container do Instagram com status ${d.status_code}.`);
      await new Promise((r) => setTimeout(r, this.esperaMs));
    }
    throw new Error("A Meta não terminou de processar a imagem a tempo.");
  }

  estaConfigurado() {
    return Boolean(this.accountId && this.accessToken);
  }

  /**
   * Legenda do post. Texto simples: o Instagram não interpreta *negrito* nem ~riscado~ do WhatsApp.
   * A chamada QUERO é respondida no direct com o link do próprio produto (webhook em app.js).
   */
  formatarLegenda(produto) {
    const brl = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const temDesconto = produto.precoAntigo > produto.preco;
    const descPct = temDesconto ? Math.round(((produto.precoAntigo - produto.preco) / produto.precoAntigo) * 100) : null;
    const preco = temDesconto ? `De ${brl(produto.precoAntigo)} por ${brl(produto.preco)} (${descPct}% OFF)` : `Por ${brl(produto.preco)}`;
    const LOJAS = { shopee: ["Shopee", "#shopee"], amazon: ["Amazon", "#amazon"], ml: ["Mercado Livre", "#mercadolivre"], shein: ["SHEIN", "#shein"] };
    const ehLocal = produto.loja === "local";
    const [lojaNome, tagLoja] = ehLocal ? [produto.lojaNome || "loja local", "#comerciolocal #comprarlocal"] : (LOJAS[produto.loja] ?? ["loja parceira", ""]);
    const linhas = [
      ehLocal ? `📍 Achado local: ${lojaNome}${produto.cidade ? ` (${produto.cidade})` : ""}` : (temDesconto ? "🔥 Achado com desconto!" : "🛍️ Achado do dia!"),
      "",
      `📦 ${produto.nome}`,
      `🏷️ ${preco}`,
    ];
    if (!ehLocal && produto.vendidos > 0) linhas.push(`⭐ Mais de ${Number(produto.vendidos).toLocaleString("pt-BR")} vendidos`);
    if (!ehLocal && LOJAS[produto.loja]) linhas.push(`Vendido por ${lojaNome}`);
    linhas.push(
      "",
      "👉 Comente \"QUERO\" que eu te mando o link do produto no direct!",
      "Ou acesse pelo link da bio: @citshopping",
      "",
      `#achados #ofertas #citshop ${tagLoja}`.trim(),
    );
    return linhas.join("\n");
  }

  /**
   * Publica uma foto no Feed do Instagram @shopcitmax via Meta Graph API.
   * Fluxo oficial: 1) Cria Media Container -> 2) Publica o Media Container.
   */
  async publicarFeed({ urlImagem, legenda = "", produtoId = null }) {
    if (!this.estaConfigurado()) {
      throw new Error("Instagram Graph API não configurada (INSTAGRAM_ACCOUNT_ID e INSTAGRAM_ACCESS_TOKEN necessários).");
    }
    if (!urlImagem) throw new Error("urlImagem é obrigatória.");

    // Passo 1: Criar container de mídia
    const urlContainer = `${GRAPH_API}/${this.accountId}/media`;
    const resContainer = await this.fetchImpl(urlContainer, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: urlImagem,
        caption: legenda,
        access_token: this.accessToken,
      }),
    });

    const dataContainer = await resContainer.json().catch(() => ({}));
    if (!resContainer.ok || !dataContainer.id) {
      const msg = dataContainer.error?.message || `Erro HTTP ${resContainer.status} ao criar container no Instagram.`;
      throw new Error(msg);
    }

    const creationId = dataContainer.id;
    await this.esperarContainer(creationId);

    // Passo 2: Publicar o container criado
    const urlPublish = `${GRAPH_API}/${this.accountId}/media_publish`;
    const resPublish = await this.fetchImpl(urlPublish, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: this.accessToken,
      }),
    });

    const dataPublish = await resPublish.json().catch(() => ({}));
    if (!resPublish.ok || !dataPublish.id) {
      const msg = dataPublish.error?.message || `Erro HTTP ${resPublish.status} ao publicar mídia no Instagram.`;
      throw new Error(msg);
    }

    if (produtoId && this.aoPublicar) await this.aoPublicar({ mediaId: dataPublish.id, produtoId });
    return {
      sucesso: true,
      mediaId: dataPublish.id,
      creationId,
    };
  }

  /**
   * Envia uma mensagem no Direct (Private Reply) respondendo automaticamente
   * a um seguidor que comentou "EU QUERO" em um post do @shopcitmax.
   */
  async responderComentarioDirect({ commentId, texto }) {
    const token = this.pageAccessToken || this.accessToken;
    if (!token) throw new Error("Token de Página do Instagram necessário para responder direct.");
    const url = `${GRAPH_API}/me/messages`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: texto },
        access_token: token,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error?.message || `Erro HTTP ${res.status} ao responder direct.`);
    }
    return { sucesso: true, messageId: data.message_id || data.recipient_id };
  }

  /**
   * Publica uma imagem nos Stories do Instagram.
   */
  async publicarStory({ urlImagem }) {
    if (!this.estaConfigurado()) {
      throw new Error("Instagram Graph API não configurada.");
    }
    if (!urlImagem) throw new Error("urlImagem é obrigatória.");

    const urlContainer = `${GRAPH_API}/${this.accountId}/media`;
    const resContainer = await this.fetchImpl(urlContainer, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: urlImagem,
        media_type: "STORIES",
        access_token: this.accessToken,
      }),
    });

    const dataContainer = await resContainer.json().catch(() => ({}));
    if (!resContainer.ok || !dataContainer.id) {
      const msg = dataContainer.error?.message || `Erro ao criar Story no Instagram: ${resContainer.status}`;
      throw new Error(msg);
    }

    await this.esperarContainer(dataContainer.id);
    const urlPublish = `${GRAPH_API}/${this.accountId}/media_publish`;
    const resPublish = await this.fetchImpl(urlPublish, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: dataContainer.id,
        access_token: this.accessToken,
      }),
    });

    const dataPublish = await resPublish.json().catch(() => ({}));
    if (!resPublish.ok || !dataPublish.id) {
      throw new Error(dataPublish.error?.message || "Erro ao publicar Story.");
    }

    return { sucesso: true, storyId: dataPublish.id };
  }
}
