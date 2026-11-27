/**
 * Cards dos posts, no visual aprovado da marca CIT shop (canvas "CIT Shopping — novo design"):
 * Feed 1080x1350 (4:5), Stories 1080x1920 e card do canal do WhatsApp 1080x1080. Feitos com Sharp + SVG.
 * Fontes: Montserrat e Righteous (pasta fontes/, instaladas no Dockerfile); sem elas o texto cai na DejaVu.
 * Sem emoji no SVG: a fonte não tem esses desenhos (viraria quadrado).
 */
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ehDiaDaBlackFriday } from "../../campanha.js";

const FONTE = "Montserrat, DejaVu Sans, Helvetica, Arial, sans-serif";
const TITULO = "Righteous, Montserrat, DejaVu Sans, sans-serif";
const COR = { petroleo: "#036271", menta: "#00C896", suave: "#C5E4E1", fundoFoto: "#EAF4F3", verde: "#008B87", branco: "#FFFFFF" };
const LOJAS = { shopee: "Shopee", amazon: "Amazon", ml: "Mercado Livre", "mercado-livre": "Mercado Livre", shein: "SHEIN" };
const PERFIL = "@citshopping";

function escaparXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const semEmoji = (s = "") => String(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Largura real de um texto, medida renderindo com a fonte instalada.
 * Estimar por número de letras falha com maiúsculas e letras largas (M, W) e o texto invade o vizinho.
 */
const medidas = new Map();
export async function medirTexto(texto, tamanho, familia = FONTE, peso = "bold") {
  const chave = `${tamanho}|${familia}|${peso}|${texto}`;
  if (!medidas.has(chave)) {
    const svg = `<svg width="${Math.ceil(texto.length * tamanho + 20)}" height="${tamanho * 2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="${tamanho * 1.4}" font-family="${familia}" font-size="${tamanho}" font-weight="${peso}" fill="#000">${escaparXml(texto)}</text></svg>`;
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true }).catch(() => ({ info: { width: 0 } }));
    if (medidas.size > 5000) medidas.clear();
    medidas.set(chave, info.width);
  }
  return medidas.get(chave);
}
const medirTitulo = (t, tam) => medirTexto(t, tam, TITULO, "normal");

/** Quebra o texto em até `maxLinhas` linhas que cabem em `max` px, sem cortar palavra; reticências na última se sobrar. */
export async function quebrarTexto(texto, tamanho, max, maxLinhas, medir = medirTexto) {
  const palavras = semEmoji(texto).split(" ").filter(Boolean);
  const linhas = [];
  let atual = "", sobrou = false;
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (await medir(tentativa, tamanho) <= max) { atual = tentativa; continue; }
    if (atual) linhas.push(atual);
    atual = palavra;
    if (linhas.length === maxLinhas) { sobrou = true; atual = ""; break; }
  }
  if (atual) linhas.push(atual);
  if (!sobrou) return linhas;
  let ultima = linhas[maxLinhas - 1].split(" ");
  while (ultima.length > 1 && await medir(`${ultima.join(" ")}…`, tamanho) > max) ultima.pop();
  linhas[maxLinhas - 1] = `${ultima.join(" ")}…`;
  return linhas;
}

/** Dados do produto já prontos para o card. Desconto só quando o preço antigo é real e maior. */
function dadosCard(produto, agora = Date.now()) {
  const preco = Number(produto.preco || 0);
  const antigo = Number(produto.precoAntigo || 0);
  const desconto = antigo > preco && preco > 0 ? Math.round((1 - preco / antigo) * 100) : 0;
  const local = produto.loja === "local";
  const loja = local ? semEmoji(produto.lojaNome) : LOJAS[produto.loja] ?? semEmoji(produto.lojaNome);
  return { nome: produto.nome || "Oferta", preco: brl(preco), antigo: desconto >= 5 ? brl(antigo) : "", desconto: desconto >= 5 ? desconto : 0, loja, local, blackFriday: ehDiaDaBlackFriday(agora) };
}

// Marca: hexágono + "CIT" (desenhos em publico/marca) + "shop" em Righteous.
const MARCA = dirname(fileURLToPath(import.meta.url)) + "/../../../publico/marca/";
const desenhos = {};
function desenho(nome) {
  if (!(nome in desenhos)) {
    try {
      const svg = readFileSync(MARCA + nome, "utf8");
      desenhos[nome] = { viewBox: /viewBox="([^"]+)"/.exec(svg)[1], corpo: svg.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "") };
    } catch { desenhos[nome] = null; }
  }
  return desenhos[nome];
}
const encaixe = (nome, x, y, w, h) => { const d = desenho(nome); return d ? `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${d.viewBox}">${d.corpo}</svg>` : ""; };

/** Logo CIT shop com o topo em `y`. `escuro`: sobre o petróleo (branco); senão sobre o branco. `a` = altura do hexágono. */
function marca(x, y, a, escuro) {
  const hexW = a * 100 / 114, citH = a * 72 / 114, citW = citH * 211 / 72, gap = a * 22 / 114;
  const citY = y + (a - citH) / 2, shopX = x + hexW + gap + citW + citH / 12, shopTam = citH * 60 / 72;
  return encaixe(escuro ? "hexagono-branco.svg" : "hexagono-petroleo.svg", x, y, hexW, a)
    + encaixe(escuro ? "cit-branco.svg" : "cit-verde.svg", x + hexW + gap, citY, citW, citH)
    + `<text x="${shopX}" y="${citY + citH / 12 + shopTam * 0.8}" font-family="${TITULO}" font-size="${shopTam}" fill="${escuro ? COR.branco : COR.petroleo}">shop</text>`;
}

/** Selo em paralelogramo terminando em `xDir`, centrado em `yMeio`. */
async function selo(xDir, yMeio, texto, tamanho, fundo, tinta) {
  const corte = tamanho * 0.8, padX = tamanho * 1.57, padY = tamanho * 0.57;
  const w = (await medirTexto(texto, tamanho, FONTE, 800)) + padX * 2, h = tamanho + padY * 2, x = xDir - w, y = yMeio - h / 2;
  return `<polygon points="${x + corte},${y} ${x + w},${y} ${x + w - corte},${y + h} ${x},${y + h}" fill="${fundo}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + tamanho * 0.36}" font-family="${FONTE}" font-size="${tamanho}" font-weight="800" fill="${tinta}" text-anchor="middle">${escaparXml(texto)}</text>`;
}

/** Desconto em Righteous no canto da foto. */
async function seloDesconto(xDir, y, desconto, tamanho) {
  if (!desconto) return "";
  const texto = `-${desconto}%`, w = (await medirTitulo(texto, tamanho)) + tamanho * 0.74, h = tamanho * 1.52;
  return `<rect x="${xDir - w}" y="${y}" width="${w}" height="${h}" rx="${tamanho * 0.37}" fill="${COR.menta}"/>
    <text x="${xDir - w / 2}" y="${y + h / 2 + tamanho * 0.36}" font-family="${TITULO}" font-size="${tamanho}" fill="${COR.petroleo}" text-anchor="middle">${texto}</text>`;
}

const rotulo = (x, y, texto, tamanho, cor, ancora = "start") => texto
  ? `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${tamanho}" font-weight="bold" letter-spacing="${tamanho * 0.08}" fill="${cor}" text-anchor="${ancora}">${escaparXml(texto.toUpperCase())}</text>` : "";
const textoLinhas = (lista, x, y, tamanho, entre, cor) => lista
  .map((l, i) => `<text x="${x}" y="${y + i * entre}" font-family="${FONTE}" font-size="${tamanho}" font-weight="bold" fill="${cor}">${escaparXml(l)}</text>`).join("");
const riscado = (x, y, texto, tamanho, ancora = "start") => texto
  ? `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${tamanho}" fill="${COR.suave}" text-anchor="${ancora}">de <tspan text-decoration="line-through">${escaparXml(texto)}</tspan></text>` : "";
const precoTitulo = (x, y, texto, tamanho, cor, ancora = "start") =>
  `<text x="${x}" y="${y}" font-family="${TITULO}" font-size="${tamanho}" fill="${cor}" text-anchor="${ancora}">${escaparXml(texto)}</text>`;

/** Maior tamanho (de `max` para baixo) em que o preço cabe em `largura`. */
async function tamanhoQueCabe(texto, max, largura) {
  let t = max;
  while (t > max * 0.5 && await medirTitulo(texto, t) > largura) t -= 4;
  return t;
}

/** Quadro sem foto: fundo claro listrado com o hexágono apagado no meio. */
function semFoto(x, y, w, h, raio, fundo) {
  const a = Math.min(w, h) / 3;
  return `<defs><pattern id="listra" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="30" fill="${COR.petroleo}" fill-opacity=".06"/></pattern></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="${fundo}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="url(#listra)"/>
    <g opacity=".25">${encaixe("hexagono-petroleo.svg", x + w / 2 - a * 0.44, y + h / 2 - a / 2, a * 0.88, a)}</g>`;
}

/** Seta da chamada (traço menta com bolinha), como no canvas. */
const seta = (x, yMeio) => `<path d="M${x + 34} ${yMeio}H${x + 116}" stroke="${COR.menta}" stroke-width="10" stroke-linecap="round"/>
  <circle cx="${x + 20}" cy="${yMeio}" r="14" fill="${COR.petroleo}" stroke="${COR.menta}" stroke-width="10"/>`;

// Na sexta-feira da Black Friday o selo do Feed e dos Stories troca para a campanha; no sábado volta sozinho.
const chamadaSelo = (d) => d.blackFriday ? "Black Friday · só hoje" : d.local ? "Achado local" : d.desconto ? "Baixou de preço" : "Oferta do dia";

export class GeradorCardInstagram {
  constructor({ publicoDir = "publico", dadosDir = process.env.DADOS_DIR || "dados", fetchImpl = fetch } = {}) {
    this.publicoDir = publicoDir;
    this.dadosDir = dadosDir;
    this.fetchImpl = fetchImpl;
  }

  /** Foto do produto: URL externa, /uploads (fotos das lojas) ou arquivo do site em publico/ (ex.: /delly/...). */
  async baixarImagemProduto(url) {
    if (!url) return null;
    try {
      if (typeof url === "string" && url.startsWith("//")) url = "https:" + url;
      if (typeof url === "string" && /^https?:\/\//.test(url)) {
        const res = await this.fetchImpl(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      }
      if (typeof url === "string" && url.startsWith("/")) {
        // Só dentro das pastas do site e dos dados: um caminho com ".." não sai delas.
        const relativo = normalize(url).replace(/^[/\\]+/, "");
        if (relativo.startsWith("..")) return null;
        const base = relativo.startsWith("uploads/") ? this.dadosDir : this.publicoDir;
        const arquivo = join(base, relativo);
        if (existsSync(arquivo)) return readFileSync(arquivo);
      }
    } catch (e) {
      console.error("[gerador-card] Falha ao baixar imagem do produto:", e.message);
    }
    return null;
  }

  /**
   * Foto no quadro: o produto inteiro (sem corte) sobre uma versão desfocada da própria foto, que preenche
   * as sobras. Assim foto vertical (celular) não vira uma tira no meio de um quadro branco.
   */
  async foto(produto, w, h, raio) {
    const url = produto.fotos?.[0] || produto.imagem || null;
    // Uma segunda tentativa: falha pontual da CDN não pode publicar post sem foto.
    const bruta = await this.baixarImagemProduto(url) ?? await this.baixarImagemProduto(url);
    if (!bruta) return null;
    try {
      const img = await sharp(bruta).rotate().flatten({ background: "#FFFFFF" }).toBuffer();
      // Só a cor geral da foto, bem clara: não pode parecer uma segunda foto atrás da primeira.
      const veu = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff" fill-opacity=".55"/></svg>`);
      // Duas etapas: o sharp só aplica o último resize de uma mesma cadeia.
      const miniatura = await sharp(img).resize(24, Math.max(8, Math.round(24 * h / w)), { fit: "cover" }).toBuffer();
      const fundo = await sharp(miniatura).resize(w, h, { kernel: "cubic" }).blur(20).composite([{ input: veu }]).toBuffer();
      const frente = await sharp(img).resize(w - 48, h - 48, { fit: "inside" }).toBuffer();
      const mascara = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${raio}" fill="#fff"/></svg>`);
      return await sharp(fundo).composite([{ input: frente, gravity: "center" }, { input: mascara, blend: "dest-in" }]).png().toBuffer();
    } catch {
      return null;
    }
  }

  /** Fundo e textos (svg), a foto e por cima o que invade a foto (selo de desconto). */
  async montar(W, H, svg, foto, fotoX, fotoY, sobre, fundo = COR.branco) {
    const camadas = [{ input: Buffer.from(svg), top: 0, left: 0 }];
    if (foto) camadas.push({ input: foto, top: fotoY, left: fotoX });
    if (sobre) camadas.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${sobre}</svg>`), top: 0, left: 0 });
    return sharp({ create: { width: W, height: H, channels: 4, background: fundo } })
      .composite(camadas).jpeg({ quality: 90 }).toBuffer();
  }

  /** Post do Feed 1080x1350 (4:5): fundo petróleo, foto num quadro branco, nome e preço em Righteous embaixo. */
  async gerarCardFeed(produto, { agora = Date.now() } = {}) {
    const W = 1080, H = 1350, P = 64, d = dadosCard(produto, agora);
    const q = { x: P, y: 218, w: W - 2 * P, h: 684, raio: 40 };
    const nome = await quebrarTexto(d.nome, 52, W - 2 * P, 2);
    const tam = await tamanhoQueCabe(d.preco, 108, W - 2 * P - 360);
    const foto = await this.foto(produto, q.w, q.h, q.raio);
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${COR.petroleo}"/>
      ${marca(P, P, 114, true)}
      ${await selo(W - P, P + 57, chamadaSelo(d), 28, COR.menta, COR.petroleo)}
      ${foto ? "" : semFoto(q.x, q.y, q.w, q.h, q.raio, COR.branco)}
      ${rotulo(P, 970, d.loja, 26, COR.menta)}
      ${textoLinhas(nome, P, 1034, 52, 58, COR.branco)}
      ${riscado(P, 1176, d.antigo, 32)}
      ${precoTitulo(P, 1270, d.preco, tam, COR.branco)}
      ${seta(W - P - 306, 1240)}
      <text x="${W - P}" y="1251" font-family="${FONTE}" font-size="30" font-weight="bold" fill="${COR.branco}" text-anchor="end">Link na bio</text>
    </svg>`;
    return this.montar(W, H, svg, foto, q.x, q.y, await seloDesconto(q.x + q.w - 32, q.y + 32, d.desconto, 76), COR.petroleo);
  }

  /**
   * Story 1080x1920. Publicado pela API, o Story não tem figurinha de link: a chamada é o link da bio.
   * Topo e base (~250px) ficam livres: o Instagram cobre com o cabeçalho do perfil e a caixa de resposta.
   */
  async gerarCardStories(produto, { agora = Date.now() } = {}) {
    const W = 1080, H = 1920, P = 64, d = dadosCard(produto, agora);
    const q = { x: P, y: 400, w: W - 2 * P, h: 760, raio: 44 };
    const nome = await quebrarTexto(d.nome, 56, W - 2 * P, 2);
    const tam = await tamanhoQueCabe(d.preco, 120, W - 2 * P);
    const foto = await this.foto(produto, q.w, q.h, q.raio);
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${COR.petroleo}"/>
      ${marca(P, 250, 114, true)}
      ${await selo(W - P, 307, chamadaSelo(d), 30, COR.menta, COR.petroleo)}
      ${foto ? "" : semFoto(q.x, q.y, q.w, q.h, q.raio, COR.branco)}
      ${rotulo(P, 1232, d.loja, 30, COR.menta)}
      ${textoLinhas(nome, P, 1302, 56, 64, COR.branco)}
      ${riscado(P, 1440, d.antigo, 36)}
      ${precoTitulo(P, 1550, d.preco, tam, COR.branco)}
      <rect x="${P}" y="1592" width="${W - 2 * P}" height="96" rx="48" fill="${COR.menta}"/>
      <text x="${W / 2}" y="1653" font-family="${FONTE}" font-size="38" font-weight="800" fill="${COR.petroleo}" text-anchor="middle">Link na bio ${PERFIL}</text>
    </svg>`;
    return this.montar(W, H, svg, foto, q.x, q.y, await seloDesconto(q.x + q.w - 32, q.y + 32, d.desconto, 80), COR.petroleo);
  }

  /** Card do canal do WhatsApp 1080x1080: fundo branco, foto em quadro claro e faixa petróleo com nome e preço. */
  async gerarCardWhatsapp(produto) {
    const W = 1080, H = 1080, P = 56, d = dadosCard(produto);
    const faixa = { x: P, y: 828, w: W - 2 * P, h: 196, raio: 36 };
    const q = { x: P, y: 183, w: W - 2 * P, h: 613, raio: 36 };
    const tam = await tamanhoQueCabe(d.preco, 84, 420);
    const larguraPreco = Math.max(await medirTitulo(d.preco, tam), d.antigo ? await medirTexto(`de ${d.antigo}`, 28, FONTE, "normal") : 0);
    const nome = await quebrarTexto(d.nome, 40, faixa.w - 80 - larguraPreco - 32, 2);
    const foto = await this.foto(produto, q.w, q.h, q.raio);
    const xDir = faixa.x + faixa.w - 40, yNome = nome.length > 1 ? 932 : 958;
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${COR.branco}"/>
      ${marca(P, P, 95, false)}
      ${await selo(W - P, P + 47, d.local ? "Achado local" : "Oferta do canal", 26, COR.petroleo, COR.branco)}
      ${foto ? "" : semFoto(q.x, q.y, q.w, q.h, q.raio, COR.fundoFoto)}
      <rect x="${faixa.x}" y="${faixa.y}" width="${faixa.w}" height="${faixa.h}" rx="${faixa.raio}" fill="${COR.petroleo}"/>
      ${rotulo(faixa.x + 40, yNome - 52, d.loja, 24, COR.menta)}
      ${textoLinhas(nome, faixa.x + 40, yNome, 40, 46, COR.branco)}
      ${riscado(xDir, 912, d.antigo, 28, "end")}
      ${precoTitulo(xDir, 990, d.preco, tam, COR.branco, "end")}
    </svg>`;
    return this.montar(W, H, svg, foto, q.x, q.y, await seloDesconto(q.x + q.w - 28, q.y + 28, d.desconto, 72));
  }
}
