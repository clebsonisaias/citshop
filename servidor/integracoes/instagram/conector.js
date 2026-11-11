/**
 * Conector oficial da Meta Graph API para Instagram Graph API (v21.0).
 * Permite publicar imagens de ofertas no Feed e Stories do perfil @shopcitmax.
 */

const GRAPH_API = "https://graph.facebook.com/v21.0";

export class ConectorInstagram {
  constructor({
    accountId = process.env.INSTAGRAM_ACCOUNT_ID || null,
    accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || null,
    fetchImpl = fetch,
  } = {}) {
    this.accountId = accountId;
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  estaConfigurado() {
    return Boolean(this.accountId && this.accessToken);
  }

  /**
   * Formata uma legenda magnética e persuasiva para o post no Instagram @shopcitmax.
   */
  formatarLegenda(produto, { urlPublica = "https://shop.citmax.com.br" } = {}) {
    const temDesconto = produto.precoAntigo > produto.preco;
    const precoFormatado = produto.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const precoAntigo = temDesconto ? produto.precoAntigo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null;
    const descPct = temDesconto ? Math.round(((produto.precoAntigo - produto.preco) / produto.precoAntigo) * 100) : null;
    const ehLocal = produto.loja === "local";

    const linhas = [];

    if (ehLocal) {
      linhas.push(
        "📍 ACHADO LOCAL NA NOSSA CIDADE! 🛍️✨",
        "",
        `🏪 Loja: *${produto.lojaNome || "Comércio Local"}* (${produto.cidade || "Nossa Região"})`,
        `📦 *${produto.nome}*`,
        "",
        temDesconto ? `🏷️ De ~${precoAntigo}~ por apenas *${precoFormatado}* 🔥 (${descPct}% OFF)` : `💰 Preço: *${precoFormatado}*`,
        "",
        "👉 Quer pedir agora escolhendo tamanho, modelo e cor?",
        "Comente \"EU QUERO\" que enviamos o link direto no seu direct!",
        `Ou acesse pelo link na nossa bio: @shopcitmax 📲`,
        "",
        "#comerciolocal #comprarlocal #rn #parnamirim #macaiba #citshop"
      );
    } else {
      linhas.push(
        "🔥 ALERTA DE QUEDA DE PREÇO NO 11.11! 😱📉",
        "",
        `📦 *${produto.nome}*`,
        "",
        temDesconto ? `🏷️ De ~${precoAntigo}~ por apenas *${precoFormatado}* 🔥 (${descPct}% OFF)` : `💰 Por apenas *${precoFormatado}*`,
      );

      if (produto.vendidos > 0) {
        linhas.push(`⭐ Mais de ${Number(produto.vendidos).toLocaleString("pt-BR")} vendidos e super bem avaliado!`);
      }

      linhas.push(
        "",
        "👉 Quer o link com desconto antes que acabe o estoque?",
        "Comente \"EU QUERO\" que te envio o link direto no direct!",
        `Ou acesse agora mesmo pelo link da bio: @shopcitmax 📲`,
        "",
        "#achados #promocoes #descontos #shopee #1111shopee #radar #citshop #ofertas"
      );
    }

    return linhas.join("\n");
  }

  /**
   * Publica uma foto no Feed do Instagram @shopcitmax via Meta Graph API.
   * Fluxo oficial: 1) Cria Media Container -> 2) Publica o Media Container.
   */
  async publicarFeed({ urlImagem, legenda = "" }) {
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

    return {
      sucesso: true,
      mediaId: dataPublish.id,
      creationId,
    };
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
