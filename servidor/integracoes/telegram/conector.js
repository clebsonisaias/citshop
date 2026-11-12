import { campanhaAtual } from "../../campanha.js";
/**
 * Conector oficial da Telegram Bot API para canais e grupos de ofertas do CIT Shopping.
 * Despacha fotos, legendas formatadas e botões inline interativos com link de afiliado.
 */

const TELEGRAM_API = "https://api.telegram.org";

export class ConectorTelegram {
  constructor({
    botToken = process.env.TELEGRAM_BOT_TOKEN || null,
    chatId = process.env.TELEGRAM_CHAT_ID || null,
    fetchImpl = fetch,
  } = {}) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.fetchImpl = fetchImpl;
  }

  estaConfigurado() {
    return Boolean(this.botToken && this.chatId);
  }

  /**
   * Formata texto em HTML seguro para o Telegram.
   */
  formatarMensagemHTML(produto, { urlPublica = "https://shop.citmax.com.br" } = {}) {
    const temDesconto = produto.precoAntigo > produto.preco;
    const precoFormatado = produto.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const precoAntigo = temDesconto
      ? produto.precoAntigo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;
    const descPct = temDesconto ? Math.round(((produto.precoAntigo - produto.preco) / produto.precoAntigo) * 100) : 0;
    const ehLocal = produto.loja === "local" || String(produto.id).startsWith("l-");
    const linkCITShopping = `${urlPublica}/p/${encodeURIComponent(produto.id)}`;

    const escapeHTML = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const nomeLimpo = escapeHTML(produto.nome);

    if (ehLocal) {
      const nomeLoja = escapeHTML(produto.lojaNome || "Comércio Parceiro");
      const cidade = escapeHTML(produto.cidade || "Nossa Região");
      return [
        "📍 <b>OFERTA LOCAL IMPERDÍVEL | CITSHOP</b> 🛍️",
        "",
        `🏪 <b>${nomeLoja}</b> (${cidade})`,
        `📦 <b>${nomeLimpo}</b>`,
        "",
        temDesconto ? `🏷️ De <s>${precoAntigo}</s> por <b>${precoFormatado}</b> 🔥 (<b>${descPct}% OFF</b>)` : `💰 Preço: <b>${precoFormatado}</b>`,
        "",
        `👉 <i>Escolha o tamanho e cor no site e peça no WhatsApp da loja:</i>`,
        `<a href="${linkCITShopping}">${linkCITShopping}</a>`,
      ].join("\n");
    }

    const eh1111 = produto.selo === "11.11" || produto.superOferta || descPct >= 30;
    const campanha = campanhaAtual();
    const tituloSelo = eh1111 ? `🎯 <b>SUPER OFERTA${campanha ? ` ${campanha}` : ""} | CITSHOP</b> ⚡💥` : "🎯 <b>RADAR DE PREÇOS BAIXOS | CITSHOP</b> 📉💥";

    return [
      tituloSelo,
      "",
      `📦 <b>${nomeLimpo}</b>`,
      "",
      temDesconto ? `🏷️ De <s>${precoAntigo}</s> por <b>${precoFormatado}</b> 🔥 (<b>${descPct}% OFF</b>)` : `💰 Por apenas: <b>${precoFormatado}</b>`,
      produto.vendidos > 0 ? `⭐ Mais de ${Number(produto.vendidos).toLocaleString("pt-BR")} vendidos!` : "",
      "",
      "🛒 <i>Garanta com desconto antes que acabe o estoque!</i>",
    ].filter(Boolean).join("\n");
  }

  /**
   * Envia uma foto com legenda e botão inline para o canal do Telegram.
   */
  async enviarOferta({ produto, chatId = this.chatId, urlPublica = "https://shop.citmax.com.br" }) {
    if (!this.botToken) {
      throw new Error("Telegram botToken não configurado.");
    }
    const destinoChat = chatId || this.chatId;
    if (!destinoChat) {
      throw new Error("Telegram chatId não configurado.");
    }

    const legenda = this.formatarMensagemHTML(produto, { urlPublica });
    const linkDestino = produto.link && !String(produto.id).startsWith("l-") ? `${urlPublica}/ir/${encodeURIComponent(produto.id)}?c=telegram` : `${urlPublica}/p/${encodeURIComponent(produto.id)}`;
    const linkDetalhes = `${urlPublica}/p/${encodeURIComponent(produto.id)}`;
    const urlFoto = produto.fotos?.[0] || produto.imagem || null;

    const botoes = [
      [{ text: "🛒 Comprar com Desconto ↗", url: linkDestino }],
    ];
    if (produto.loja === "local" || String(produto.id).startsWith("l-")) {
      botoes[0][0].text = "📲 Pedir no WhatsApp da Loja ↗";
    } else {
      botoes.push([{ text: "🔍 Ver Detalhes no CIT Shopping", url: linkDetalhes }]);
    }

    const replyMarkup = { inline_keyboard: botoes };

    if (urlFoto && (urlFoto.startsWith("http://") || urlFoto.startsWith("https://"))) {
      const urlEnvio = `${TELEGRAM_API}/bot${this.botToken}/sendPhoto`;
      const res = await this.fetchImpl(urlEnvio, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: destinoChat,
          photo: urlFoto,
          caption: legenda,
          parse_mode: "HTML",
          reply_markup: replyMarkup,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.description || `Erro HTTP ${res.status} ao enviar foto no Telegram.`);
      }
      return { sucesso: true, messageId: data.result?.message_id };
    }

    // Fallback para envio apenas de texto se não houver foto
    const urlEnvioTexto = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const resTexto = await this.fetchImpl(urlEnvioTexto, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: destinoChat,
        text: legenda,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    });
    const dataTexto = await resTexto.json().catch(() => ({}));
    if (!resTexto.ok || !dataTexto.ok) {
      throw new Error(dataTexto.description || `Erro HTTP ${resTexto.status} ao enviar texto no Telegram.`);
    }
    return { sucesso: true, messageId: dataTexto.result?.message_id };
  }
}
