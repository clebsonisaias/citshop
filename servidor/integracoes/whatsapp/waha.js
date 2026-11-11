/**
 * Conector de integração com o WAHA (WhatsApp HTTP API).
 * Permite enviar mensagens de texto e imagens para números individuais, grupos (@g.us)
 * e canais oficiais do WhatsApp (@newsletter).
 */

export class ConectorWaha {
  constructor({
    apiUrl = process.env.WAHA_API_URL || "http://waha:3000",
    session = process.env.WAHA_SESSION || "default",
    apiKey = process.env.WAHA_API_KEY || null,
    fetchImpl = fetch,
  } = {}) {
    this.apiUrl = String(apiUrl).replace(/\/+$/, "");
    this.session = session;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  obterHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["X-Api-Key"] = this.apiKey;
    }
    return headers;
  }

  /**
   * Normaliza o identificador de destino do WhatsApp.
   * Suporta:
   * - Canais: ...@newsletter
   * - Grupos: ...@g.us
   * - Contatos diretos: 5584999999999 -> 5584999999999@c.us
   */
  normalizarChatId(chatId) {
    if (!chatId || typeof chatId !== "string") return "";
    const limpo = chatId.trim();
    if (limpo.endsWith("@newsletter") || limpo.endsWith("@g.us") || limpo.endsWith("@c.us") || limpo.endsWith("@lid")) {
      return limpo;
    }
    const apenasDigitos = limpo.replace(/\D/g, "");
    if (!apenasDigitos) return "";
    return `${apenasDigitos}@c.us`;
  }

  /**
   * Consulta o status da sessão no WAHA.
   */
  async verificarStatus() {
    try {
      const res = await this.fetchImpl(`${this.apiUrl}/api/sessions`, {
        method: "GET",
        headers: this.obterHeaders(),
        signal: AbortSignal.timeout(6_000),
      });

      if (!res.ok) {
        return { online: false, erro: `HTTP ${res.status}` };
      }

      const sessoes = await res.json().catch(() => []);
      const sessaoAtual = Array.isArray(sessoes) ? sessoes.find((s) => s.name === this.session) : null;

      if (!sessaoAtual) {
        return { online: false, erro: `Sessão "${this.session}" não encontrada no WAHA.` };
      }

      const conectada = sessaoAtual.status === "WORKING";
      const numero = sessaoAtual.me?.id || null;
      const nomePerfil = sessaoAtual.me?.pushName || null;

      return {
        online: conectada,
        status: sessaoAtual.status,
        sessao: this.session,
        numero,
        nomePerfil,
        apiUrl: this.apiUrl,
      };
    } catch (e) {
      return { online: false, erro: e.message, apiUrl: this.apiUrl };
    }
  }

  /**
   * Envia uma mensagem de texto via WAHA.
   */
  async enviarTexto({ chatId, texto }) {
    const destino = this.normalizarChatId(chatId);
    if (!destino) throw new Error("chatId do WhatsApp é obrigatório.");
    if (!texto) throw new Error("texto da mensagem é obrigatório.");

    const res = await this.fetchImpl(`${this.apiUrl}/api/sendText`, {
      method: "POST",
      headers: this.obterHeaders(),
      body: JSON.stringify({
        session: this.session,
        chatId: destino,
        text: String(texto),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.exception?.message || body?.message || `Erro HTTP ${res.status} ao enviar texto no WAHA.`;
      throw new Error(msg);
    }

    return { sucesso: true, resposta: body };
  }

  /**
   * Envia uma imagem com legenda via WAHA.
   */
  async enviarImagem({ chatId, urlImagem, legenda = "" }) {
    const destino = this.normalizarChatId(chatId);
    if (!destino) throw new Error("chatId do WhatsApp é obrigatório.");
    if (!urlImagem) throw new Error("urlImagem é obrigatória.");

    const res = await this.fetchImpl(`${this.apiUrl}/api/sendImage`, {
      method: "POST",
      headers: this.obterHeaders(),
      body: JSON.stringify({
        session: this.session,
        chatId: destino,
        file: {
          url: urlImagem,
        },
        caption: legenda ? String(legenda) : undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.exception?.message || body?.message || `Erro HTTP ${res.status} ao enviar imagem no WAHA.`;
      throw new Error(msg);
    }

    return { sucesso: true, resposta: body };
  }
}
