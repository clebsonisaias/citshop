/**
 * Cards do Instagram: Feed (1080x1080) e Stories (1080x1920), feitos com Sharp + SVG.
 * O preço é o herói: foto do produto em destaque e um bloco petróleo da CIT com nome, "de/por" e a chamada.
 * Fonte: DejaVu Sans, que é a instalada no servidor (Dockerfile: ttf-dejavu); por isso não há emoji no SVG
 * (viraria quadrado) e as quebras de linha são calculadas com folga para a largura dela.
 */
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";

const FONTE = "DejaVu Sans, Helvetica, Arial, sans-serif";
const COR = { petroleo: "#036271", fundoFoto: "#F2F7F6", menta: "#00C896", tintaMenta: "#03303A", mentaTexto: "#7DEBCB", suave: "#CFE8E6", branco: "#FFFFFF" };
const LOJAS = { shopee: "Shopee", amazon: "Amazon", ml: "Mercado Livre", shein: "SHEIN" };
const PERFIL = "@citshopping";

function escaparXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
// Sem emoji: a fonte do servidor não tem esses desenhos.
const semEmoji = (s = "") => String(s).replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Largura aproximada (só para o selo de desconto, texto curto e fixo).
const largura = (texto, tamanho) => String(texto).length * tamanho * 0.62;

/**
 * Largura real de um texto em negrito, medida renderindo com a fonte instalada (no servidor, DejaVu).
 * Estimar por número de letras falha com maiúsculas e letras largas (M, W) e o texto invade o vizinho.
 */
const medidas = new Map();
export async function medirTexto(texto, tamanho) {
  const chave = `${tamanho}|${texto}`;
  if (!medidas.has(chave)) {
    const svg = `<svg width="${Math.ceil(texto.length * tamanho + 20)}" height="${tamanho * 2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="${tamanho * 1.4}" font-family="${FONTE}" font-size="${tamanho}" font-weight="bold" fill="#000">${escaparXml(texto)}</text></svg>`;
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true }).catch(() => ({ info: { width: 0 } }));
    if (medidas.size > 5000) medidas.clear();
    medidas.set(chave, info.width);
  }
  return medidas.get(chave);
}

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
  // Sobrou texto: reticências na última linha, tirando palavras até caber junto com elas.
  let ultima = linhas[maxLinhas - 1].split(" ");
  while (ultima.length > 1 && await medir(`${ultima.join(" ")}…`, tamanho) > max) ultima.pop();
  linhas[maxLinhas - 1] = `${ultima.join(" ")}…`;
  return linhas;
}

/** Dados do produto já prontos para o card. Desconto só quando o preço antigo é real e maior. */
function dadosCard(produto) {
  const preco = Number(produto.preco || 0);
  const antigo = Number(produto.precoAntigo || 0);
  const desconto = antigo > preco && preco > 0 ? Math.round((1 - preco / antigo) * 100) : 0;
  const loja = produto.loja === "local" ? semEmoji(produto.lojaNome) : LOJAS[produto.loja] ?? semEmoji(produto.lojaNome);
  return { nome: produto.nome || "Oferta", preco: brl(preco), antigo: desconto >= 5 ? brl(antigo) : "", desconto: desconto >= 5 ? desconto : 0, loja };
}

const HEXAGONO = `<path fill="${COR.menta}" d="M13 0 26 7.5v15L13 30 0 22.5v-15z"/>`;

/** Marca CIT Shopping (hexágono menta + palavra) com o topo do texto em `y`. */
function marca(x, y, escala) {
  const h = 30 * escala;
  return `<g transform="translate(${x} ${y}) scale(${escala})">${HEXAGONO}</g>
    <text x="${x + 26 * escala + 14}" y="${y + h * 0.78}" font-family="${FONTE}" font-size="${h * 0.95}" font-weight="bold" fill="${COR.petroleo}">CIT <tspan fill="#008B87" font-weight="normal">Shopping</tspan></text>`;
}

/** Selo de desconto alinhado à direita, terminando em `xDir`. */
function seloDesconto(xDir, y, desconto, tamanho) {
  if (!desconto) return "";
  const texto = `-${desconto}%`;
  const w = largura(texto, tamanho) + tamanho * 1.2, h = tamanho * 1.7;
  return `<rect x="${xDir - w}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${COR.menta}"/>
    <text x="${xDir - w / 2}" y="${y + h * 0.69}" font-family="${FONTE}" font-size="${tamanho}" font-weight="bold" fill="${COR.tintaMenta}" text-anchor="middle">${texto}</text>`;
}

/** "de R$ X" com o valor riscado (text-decoration nativo: acompanha a largura real da fonte). */
function precoAntigo(x, y, texto, tamanho) {
  if (!texto) return "";
  return `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${tamanho}" fill="${COR.mentaTexto}">de <tspan text-decoration="line-through">${escaparXml(texto)}</tspan></text>`;
}

const textoLinhas = (lista, x, y, tamanho, entre, cor) => lista
  .map((l, i) => `<text x="${x}" y="${y + i * entre}" font-family="${FONTE}" font-size="${tamanho}" font-weight="bold" fill="${cor}">${escaparXml(l)}</text>`).join("");

const vendidoPor = (x, y, loja, tamanho) => loja
  ? `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${tamanho}" fill="${COR.suave}">Vendido por <tspan font-weight="bold" fill="${COR.branco}">${escaparXml(loja)}</tspan></text>`
  : "";

/** Preço com "R$" menor que o número: o valor é o que se lê primeiro. */
function precoGrande(x, y, preco, tamanho) {
  const [moeda, ...valor] = preco.split(/\s/);
  return `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${tamanho}" font-weight="bold" fill="${COR.branco}"><tspan font-size="${Math.round(tamanho * 0.5)}">${escaparXml(moeda)}</tspan><tspan dx="${Math.round(tamanho * 0.18)}">${escaparXml(valor.join(" "))}</tspan></text>`;
}

/** Quadro sem foto: fundo suave com a marca apagada no meio. */
function semFoto(x, y, w, h, raio) {
  const escala = Math.min(w, h) / 120;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="${COR.fundoFoto}"/>
    <g transform="translate(${x + w / 2 - 13 * escala} ${y + h / 2 - 15 * escala}) scale(${escala})" opacity=".35">${HEXAGONO}</g>`;
}

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
    const bruta = await this.baixarImagemProduto(produto.fotos?.[0] || produto.imagem || null);
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

  /** Fundo e textos (svg), a foto e por cima o selo de desconto (sobre), que invade o canto da foto. */
  async montar(W, H, svg, foto, fotoX, fotoY, sobre) {
    const camadas = [{ input: Buffer.from(svg), top: 0, left: 0 }];
    if (foto) camadas.push({ input: foto, top: fotoY, left: fotoX });
    if (sobre) camadas.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${sobre}</svg>`), top: 0, left: 0 });
    return sharp({ create: { width: W, height: H, channels: 4, background: COR.branco } })
      .composite(camadas).jpeg({ quality: 90 }).toBuffer();
  }

  /** Card quadrado 1080x1080 para o Feed. Preço e chamada presos na base do bloco petróleo. */
  async gerarCardFeed(produto) {
    const W = 1080, H = 1080, d = dadosCard(produto);
    const nome = await quebrarTexto(d.nome, 40, 960, 2);
    const [loja = ""] = await quebrarTexto(d.loja, 28, 300, 1);
    // O preço ("R$" na metade do tamanho + valor) não pode encostar no botão, que começa em x=680.
    const [moeda, valor] = d.preco.split(/\s/);
    let tamPreco = 88;
    while (tamPreco > 48 && (await medirTexto(moeda, tamPreco / 2)) + tamPreco * 0.18 + (await medirTexto(valor, tamPreco)) > 590) tamPreco -= 6;
    const q = { x: 60, y: 110, w: 960, h: 570, raio: 32 };
    const foto = await this.foto(produto, q.w, q.h, q.raio);
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${COR.branco}"/>
      ${marca(60, 40, 1.5)}
      ${foto ? "" : semFoto(q.x, q.y, q.w, q.h, q.raio)}
      <rect x="0" y="700" width="${W}" height="${H - 700}" fill="${COR.petroleo}"/>
      ${textoLinhas(nome, 60, 764, 40, 48, COR.branco)}
      ${precoAntigo(60, 888, d.antigo, 34)}
      ${precoGrande(60, 972, d.preco, tamPreco)}
      <rect x="680" y="892" width="340" height="88" rx="44" fill="${COR.menta}"/>
      <text x="850" y="950" font-family="${FONTE}" font-size="34" font-weight="bold" fill="${COR.tintaMenta}" text-anchor="middle">Comente QUERO</text>
      ${vendidoPor(60, 1046, loja, 28)}
      <text x="1020" y="1046" font-family="${FONTE}" font-size="28" fill="${COR.suave}" text-anchor="end">Link na bio ${PERFIL}</text>
    </svg>`;
    return this.montar(W, H, svg, foto, q.x, q.y, seloDesconto(1040, 80, d.desconto, 48));
  }

  /**
   * Card vertical 1080x1920 para os Stories. Publicado pela API, o Stories não tem figurinha de link:
   * a chamada é o link da bio, que é verdade para quem vê. Topo e base (~250px) ficam livres: o Instagram
   * cobre com o cabeçalho do perfil e a caixa de resposta.
   */
  async gerarCardStories(produto) {
    const W = 1080, H = 1920, d = dadosCard(produto);
    const nome = await quebrarTexto(d.nome, 52, 960, 2);
    const [loja = ""] = await quebrarTexto(d.loja, 34, 720, 1);
    const q = { x: 60, y: 350, w: 960, h: 760, raio: 40 };
    const foto = await this.foto(produto, q.w, q.h, q.raio);
    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${COR.branco}"/>
      ${marca(60, 250, 2)}
      ${foto ? "" : semFoto(q.x, q.y, q.w, q.h, q.raio)}
      <rect x="0" y="1150" width="${W}" height="${H - 1150}" fill="${COR.petroleo}"/>
      ${textoLinhas(nome, 60, 1218, 52, 64, COR.branco)}
      ${precoAntigo(60, 1352, d.antigo, 42)}
      ${precoGrande(60, 1470, d.preco, 120)}
      ${vendidoPor(60, 1530, loja, 34)}
      <rect x="60" y="1560" width="960" height="110" rx="55" fill="${COR.menta}"/>
      <text x="540" y="1630" font-family="${FONTE}" font-size="44" font-weight="bold" fill="${COR.tintaMenta}" text-anchor="middle">Link na bio ${PERFIL}</text>
    </svg>`;
    return this.montar(W, H, svg, foto, q.x, q.y, seloDesconto(1040, 318, d.desconto, 64));
  }
}
