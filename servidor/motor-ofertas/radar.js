/**
 * Robô Radar de Preços Baixos e Super Promoções no WhatsApp (via WAHA).
 * Monitora o catálogo da vitrine, identifica quedas expressivas de preço e grandes descontos
 * (incluindo o Especial 11.11) e despacha cards formatados para canais, grupos ou contatos do WhatsApp.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConectorWaha } from "../integracoes/whatsapp/waha.js";
import { campanhaAtual } from "../campanha.js";

const ARQUIVO_ENVIADOS = "radar-enviados.json";

export class RadarOfertas {
  constructor({
    dadosDir = process.env.DADOS_DIR || "dados",
    waha = new ConectorWaha(),
    instagram = null,
    telegram = null,
    urlPublica = process.env.URL_PUBLICA || "https://shop.citmax.com.br",
  } = {}) {
    this.dadosDir = dadosDir;
    this.waha = waha;
    this.instagram = instagram;
    this.telegram = telegram;
    this.urlPublica = String(urlPublica).replace(/\/+$/, "");
    this.caminhoEnviados = join(this.dadosDir, ARQUIVO_ENVIADOS);
  }

  /**
   * Lê o histórico de envios do radar (para deduplicação anti-spam de 24h).
   */
  carregarHistoricoEnviados() {
    try {
      if (existsSync(this.caminhoEnviados)) {
        const conteudo = readFileSync(this.caminhoEnviados, "utf8");
        const json = JSON.parse(conteudo);
        return Array.isArray(json) ? json : (json.enviados || []);
      }
    } catch {
      // Ignora erro de leitura e retorna array vazio
    }
    return [];
  }

  /**
   * Grava o histórico de envios com retenção de 7 dias.
   */
  salvarHistoricoEnviados(enviados) {
    try {
      const limiteRetencaoMs = 7 * 24 * 3600 * 1000;
      const agora = Date.now();
      const limpos = enviados.filter((e) => agora - new Date(e.enviadoEm).getTime() < limiteRetencaoMs);
      writeFileSync(this.caminhoEnviados, JSON.stringify(limpos, null, 2), "utf8");
    } catch (e) {
      console.error("[radar] Falha ao salvar histórico de enviados:", e.message);
    }
  }

  /**
   * Identifica produtos elegíveis para o Radar:
   * 1. Queda de preço real (precoAntigo > preco com desconto >= descontoMinimoPct)
   * 2. Ou selo de queda/menor preço recente
   * 3. Ou super promoção especial (11.11 com desconto >= 25%)
   */
  selecionarCandidatos(produtos = [], {
    descontoMinimoPct = 25,
    intervaloHorasRepeticao = 24,
  } = {}) {
    const enviados = this.carregarHistoricoEnviados();
    const agora = Date.now();
    const janelaMs = intervaloHorasRepeticao * 3600 * 1000;

    const idsEnviadosRecentemente = new Set(
      enviados
        .filter((e) => agora - new Date(e.enviadoEm).getTime() < janelaMs)
        .map((e) => e.id)
    );

    const candidatos = [];

    for (const p of produtos) {
      if (!p || !p.id || !p.nome || !(p.preco > 0)) continue;
      if (idsEnviadosRecentemente.has(p.id)) continue;

      const preco = Number(p.preco);
      const precoAntigo = Number(p.precoAntigo || 0);
      const temPrecoAntigo = precoAntigo > preco;
      const descontoPct = temPrecoAntigo ? Math.round(((precoAntigo - preco) / precoAntigo) * 100) : 0;

      const ehSuper1111 = p.selo === "11.11" || p.superOferta || /11\.11/i.test(p.nome);
      const ehQueda = p.queda || p.menor30 || (temPrecoAntigo && descontoPct >= descontoMinimoPct);

      if (ehQueda || (ehSuper1111 && descontoPct >= 20)) {
        candidatos.push({
          produto: p,
          descontoPct,
          ehQueda,
          ehSuper1111,
          score: (descontoPct * 2) + (p.vendidos ? Math.min(50, Math.log10(p.vendidos) * 10) : 0) + (ehSuper1111 ? 30 : 0),
        });
      }
    }

    // Ordenar pelo maior score (maior desconto + relevância + 11.11)
    candidatos.sort((a, b) => b.score - a.score);
    return candidatos.map((c) => c.produto);
  }

  /**
   * Formata o texto e card para envio no WhatsApp.
   */
  formatarMensagem(produto) {
    const precoFormatado = produto.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const temDesconto = produto.precoAntigo > produto.preco;
    const precoAntigoFormatado = temDesconto
      ? produto.precoAntigo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;
    const descontoPct = temDesconto ? Math.round(((produto.precoAntigo - produto.preco) / produto.precoAntigo) * 100) : null;

    const ehLocal = produto.loja === "local" || String(produto.id).startsWith("l-");
    const linkCITShopping = `${this.urlPublica}/p/${encodeURIComponent(produto.id)}`;

    if (ehLocal) {
      const nomeLoja = produto.lojaNome || "Comércio Parceiro";
      const cidade = produto.cidade || "Nossa Região";
      return {
        texto: [
          "📍 *OFERTA LOCAL IMPERDÍVEL | CITSHOP* 🛍️",
          "",
          `🏪 Loja: *${nomeLoja}* (${cidade})`,
          `📦 *${produto.nome}*`,
          "",
          temDesconto
            ? `🏷️ De ~${precoAntigoFormatado}~ por *${precoFormatado}* 🔥 (${descontoPct}% OFF)`
            : `💰 Por apenas *${precoFormatado}*`,
          "",
          "👉 *Escolha o modelo, tamanho e cor em nosso site e peça direto pelo WhatsApp da loja:*",
          linkCITShopping,
          "",
          "_CIT Shopping · Fortalecendo o comércio da nossa cidade!_",
        ].join("\n"),
        urlImagem: produto.fotos?.[0] || produto.imagem || null,
        linkPrincipal: linkCITShopping,
        tipo: "local",
      };
    }

    // Produto de Afiliado (Shopee, etc.)
    const linkAfiliado = produto.link || linkCITShopping;
    const eh1111 = produto.selo === "11.11" || produto.superOferta || /11\.11/i.test(produto.nome);

    const cabecalho = eh1111
      ? `🎯 *SUPER PROMOÇÃO${campanhaAtual() ? ` ${campanhaAtual()}` : ""} | RADAR CITSHOP* ⚡💥`
      : "🎯 *RADAR DE PREÇOS BAIXOS | CITSHOP* 📉💥";

    const linhas = [
      cabecalho,
      "Identificamos uma queda de preço imperdível hoje!",
      "",
      `📦 *${produto.nome}*`,
      "",
      temDesconto
        ? `🏷️ De ~${precoAntigoFormatado}~ por *${precoFormatado}* 🔥 (${descontoPct}% OFF)`
        : `💰 Preço especial: *${precoFormatado}*`,
    ];

    if (produto.nota > 0 || produto.vendidos > 0) {
      const info = [];
      if (produto.nota > 0) info.push(`★ ${Number(produto.nota).toFixed(1)}`);
      if (produto.vendidos > 0) info.push(`${Number(produto.vendidos).toLocaleString("pt-BR")} vendidos`);
      linhas.push(`⭐ ${info.join(" · ")}`);
    }

    linhas.push(
      "",
      "🛒 *Garanta o seu com desconto antes que acabe:*",
      `👉 ${linkAfiliado}`,
      "",
      `🔍 Ver detalhes na CIT Shopping: ${linkCITShopping}`,
      "",
      "_CIT Shopping Radar · Preços e estoques sujeitos a alteração rápida na loja parceira._"
    );

    return {
      texto: linhas.join("\n"),
      urlImagem: produto.imagem || produto.fotos?.[0] || null,
      linkPrincipal: linkAfiliado,
      tipo: "afiliado",
    };
  }

  /**
   * Executa uma rodada do radar de preços: seleciona as melhores promoções e envia para o WhatsApp via WAHA.
   */
  async executarRodada({
    produtos = [],
    chatId = null,
    maxDisparos = 3,
    descontoMinimoPct = 25,
    intervaloHorasRepeticao = 24,
    postarInstagram = false,
    postarTelegram = false,
  } = {}) {
    if (!chatId && !postarInstagram && !postarTelegram) {
      return { executado: false, motivo: "Nenhum canal de destino (WhatsApp, Instagram ou Telegram) configurado." };
    }

    const candidatos = this.selecionarCandidatos(produtos, {
      descontoMinimoPct,
      intervaloHorasRepeticao,
    });

    if (!candidatos.length) {
      return { executado: true, enviados: 0, mensagem: "Nenhuma nova oportunidade de desconto acima do limite encontrada nesta rodada." };
    }

    const selecionados = candidatos.slice(0, maxDisparos);
    const enviadosHistorico = this.carregarHistoricoEnviados();
    const sucessos = [];

    // Envio para o WhatsApp via WAHA (se chatId estiver definido)
    if (chatId) {
      const statusWaha = await this.waha.verificarStatus();
      if (statusWaha.online) {
        for (const item of selecionados) {
          const card = this.formatarMensagem(item);
          try {
            if (card.urlImagem) {
              try {
                await this.waha.enviarImagem({
                  chatId,
                  urlImagem: card.urlImagem,
                  legenda: card.texto,
                });
              } catch {
                await this.waha.enviarTexto({
                  chatId,
                  texto: card.texto,
                });
              }
            } else {
              await this.waha.enviarTexto({
                chatId,
                texto: card.texto,
              });
            }

            sucessos.push({
              id: item.id,
              nome: item.nome,
              preco: item.preco,
              tipo: card.tipo,
              enviadoEm: new Date().toISOString(),
              chatId,
            });

            enviadosHistorico.push({
              id: item.id,
              nome: item.nome,
              enviadoEm: new Date().toISOString(),
            });
          } catch (errEnvio) {
            console.error(`[radar] Falha ao enviar produto ${item.id} no WhatsApp:`, errEnvio.message);
          }
        }
      } else {
        console.warn(`[radar] WAHA indisponível: ${statusWaha.erro || statusWaha.status}`);
      }
    }

    // Publicação automática no Feed do Instagram @shopcitmax (se ativo e configurado)
    let postInstagram = null;
    if (postarInstagram && this.instagram && this.instagram.estaConfigurado() && selecionados.length > 0) {
      const topOferta = selecionados[0];
      try {
        const urlCard = `${this.urlPublica}/api/instagram/card/${encodeURIComponent(topOferta.id)}`;
        const legenda = this.instagram.formatarLegenda(topOferta, { urlPublica: this.urlPublica });
        postInstagram = await this.instagram.publicarFeed({ urlImagem: urlCard, legenda, produtoId: topOferta.id });
        sucessos.push({
          id: topOferta.id,
          nome: topOferta.nome,
          preco: topOferta.preco,
          tipo: "instagram",
          enviadoEm: new Date().toISOString(),
          postId: postInstagram.mediaId,
        });
      } catch (errInsta) {
        console.error(`[radar] Falha ao postar no Instagram: ${errInsta.message}`);
      }
    }

    // Publicação automática no canal do Telegram (se ativo e configurado)
    let postTelegram = null;
    if (postarTelegram && this.telegram && this.telegram.estaConfigurado() && selecionados.length > 0) {
      const topOferta = selecionados[0];
      try {
        postTelegram = await this.telegram.enviarOferta({ produto: topOferta, urlPublica: this.urlPublica });
        sucessos.push({
          id: topOferta.id,
          nome: topOferta.nome,
          preco: topOferta.preco,
          tipo: "telegram",
          enviadoEm: new Date().toISOString(),
          messageId: postTelegram.messageId,
        });
      } catch (errTg) {
        console.error(`[radar] Falha ao postar no Telegram: ${errTg.message}`);
      }
    }

    if (sucessos.length > 0) {
      this.salvarHistoricoEnviados(enviadosHistorico);
    }

    return {
      executado: true,
      enviados: sucessos.length,
      produtosEnviados: sucessos,
    };
  }

  /**
   * Envia uma mensagem avulsa de teste no WhatsApp.
   */
  async enviarMensagemTeste({ chatId, textoPersonalizado = null } = {}) {
    if (!chatId) throw new Error("chatId é obrigatório para envio de teste.");
    const texto = textoPersonalizado || [
      "🤖 *TESTE DE INTEGRAÇÃO CITSHOP | RADAR DE OFERTAS*",
      "",
      "✅ O robô de monitoramento de preços baixos está conectado com sucesso ao WhatsApp via WAHA!",
      "",
      `🎯 Quando uma oferta tiver queda expressiva de preço ou super desconto${campanhaAtual() ? ` do ${campanhaAtual()}` : ""}, ela será despachada automaticamente neste canal.`,
      "",
      `📅 Teste enviado em: ${new Date().toLocaleString("pt-BR")}`,
      `🌐 Vitrine: ${this.urlPublica}`,
    ].join("\n");

    return this.waha.enviarTexto({ chatId, texto });
  }
}
