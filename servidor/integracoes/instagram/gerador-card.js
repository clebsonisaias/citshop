/**
 * Gerador profissional de cards para Feed (1080x1080) e Stories (1080x1920) do Instagram.
 * Produz imagens visuais prontas para publicação utilizando Sharp e SVG composto.
 */
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function escaparXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class GeradorCardInstagram {
  constructor({ publicoDir = "publico", fetchImpl = fetch } = {}) {
    this.publicoDir = publicoDir;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Baixa a imagem do produto e converte para Buffer.
   */
  async baixarImagemProduto(url) {
    if (!url) return null;
    try {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
      if (existsSync(url)) {
        return readFileSync(url);
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Gera um card 1080x1080 quadrado para o Feed do Instagram @shopcitmax.
   */
  async gerarCardFeed(produto) {
    const W = 1080;
    const H = 1080;

    const nome = escaparXml(produto.nome || "Super Oferta");
    const preco = Number(produto.preco || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const temDesconto = produto.precoAntigo > produto.preco;
    const precoAntigo = temDesconto
      ? Number(produto.precoAntigo).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "";
    const descPct = temDesconto ? Math.round(((produto.precoAntigo - produto.preco) / produto.precoAntigo) * 100) : 0;
    const eh1111 = produto.selo === "11.11" || produto.superOferta || descPct >= 30;

    // 1. Tentar baixar a foto do produto e redimensioná-la para 720x720
    const urlFoto = produto.fotos?.[0] || produto.imagem || null;
    const fotoRaw = await this.baixarImagemProduto(urlFoto);
    let fotoRedimensionada = null;

    if (fotoRaw) {
      try {
        fotoRedimensionada = await sharp(fotoRaw)
          .resize(680, 680, { fit: "contain", background: "#ffffff" })
          .png()
          .toBuffer();
      } catch {
        fotoRedimensionada = null;
      }
    }

    // 2. Fundo SVG com gradiente da marca, moldura e tipografia
    const badgeTexto = eh1111 ? "SUPER OFERTA 11.11" : "RADAR DE OFERTAS";
    const badgeCor = eh1111 ? "#e63946" : "#008b87";

    const svgOverlay = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#036271"/>
          <stop offset="100%" stop-color="#004d57"/>
        </linearGradient>
        <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000" flood-opacity="0.3"/>
        </filter>
      </defs>

      <!-- Fundo -->
      <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>

      <!-- Topo: Header com Logo & Tag -->
      <rect x="60" y="44" width="220" height="42" rx="21" fill="rgba(255,255,255,0.15)"/>
      <text x="170" y="72" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">CITshop</text>

      <rect x="760" y="44" width="260" height="42" rx="21" fill="${badgeCor}"/>
      <text x="890" y="71" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle">${badgeTexto}</text>

      <!-- Moldura branca do produto -->
      <rect x="60" y="110" width="960" height="740" rx="28" fill="#ffffff" filter="url(#shadow)"/>

      <!-- Faixa inferior com Preços e CTA -->
      <rect x="60" y="870" width="960" height="150" rx="24" fill="#ffffff" filter="url(#shadow)"/>

      <!-- Título Resumido -->
      <text x="90" y="915" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="bold" fill="#0f172a">
        ${nome.slice(0, 48)}${nome.length > 48 ? "..." : ""}
      </text>

      <!-- Preço -->
      ${temDesconto ? `<text x="90" y="955" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#64748b" text-decoration="line-through">De ${escaparXml(precoAntigo)}</text>` : ""}
      <text x="${temDesconto ? "90" : "90"}" y="1000" font-family="Helvetica, Arial, sans-serif" font-size="38" font-weight="bold" fill="#036271">
        Por ${escaparXml(preco)}
      </text>

      ${descPct >= 20 ? `
      <rect x="520" y="960" width="140" height="42" rx="10" fill="#e63946"/>
      <text x="590" y="988" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">${descPct}% OFF</text>
      ` : ""}

      <!-- Chamada Instagram -->
      <rect x="710" y="930" width="280" height="60" rx="30" fill="#25d366"/>
      <text x="850" y="967" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">Comente "QUERO"</text>
      <text x="850" y="1010" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#ffffff" text-anchor="middle">@shopcitmax · Link na Bio</text>
    </svg>
    `;

    const compositeList = [
      { input: Buffer.from(svgOverlay), top: 0, left: 0 },
    ];

    if (fotoRedimensionada) {
      compositeList.unshift({
        input: fotoRedimensionada,
        top: 140,
        left: 200,
      });
    }

    return sharp({
      create: {
        width: W,
        height: H,
        channels: 4,
        background: { r: 3, g: 98, b: 113, alpha: 1 },
      },
    })
      .composite(compositeList)
      .jpeg({ quality: 90 })
      .toBuffer();
  }
}
