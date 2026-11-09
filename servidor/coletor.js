/**
 * Coletor de ofertas (roda no servidor, sem navegador), enquanto as APIs oficiais não saem:
 *  - Shopee: lê a lista de ofertas do painel de afiliados com o cookie de sessão (SHOPEE_COOKIE).
 *    Cada oferta já traz o long_link, que é o link de afiliado (utm_source=an_<ID de afiliado>).
 *  - Amazon: lê as páginas de mais vendidos e a busca de dispositivos Alexa, e monta o link com AMAZON_TAG.
 * Grava coleta.json no volume e refaz afiliados.json. Se uma loja falhar, mantém os produtos dela da rodada anterior.
 * Guarda também historico.json (um preço por produto por dia, 30 dias) para marcar "baixou de preço" e
 * "menor preço em 30 dias" só com base no que foi visto de verdade.
 * Quando a SHOPEE_APP_ID existir, a Shopee passa a vir da API oficial (afiliados.js) e esta parte é pulada.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { atualizarAfiliados } from "./afiliados.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SHOPEE_LISTA = "https://affiliate.shopee.com.br/api/v3/offer/product/list";
const SHOPEE_PAGINAS = 3; // 3 x 50 = até 150 ofertas
const SHOPEE_IMG = "https://down-bs-br.img.susercontent.com/";

// [departamento, página de mais vendidos, digital]. eBook Kindle não entra no carrinho: vai sem ASIN, com link pro produto.
const AMAZON_MAIS_VENDIDOS = [
  ["cozinha", "kitchen"], ["casa", "home"], ["tec", "electronics"], ["info", "computers"], ["eletro", "appliances"],
  ["beleza", "beauty"], ["pets", "pet-products"], ["ferr", "hi"], ["brinq", "toys"], ["bebe", "baby"],
  ["esporte", "sports"], ["auto", "automotive"], ["moda", "fashion"], ["papel", "office-products"], ["games", "videogames"],
  ["livros", "books"], ["livros", "digital-text", true], ["saude", "hpc"], ["mercado", "grocery"],
];
const AMAZON_POR_CATEGORIA = 20;
const AMAZON_DISPOSITIVOS = "https://www.amazon.com.br/gp/bestsellers/amazon-devices";
const AMAZON_ALEXA = "https://www.amazon.com.br/s?k=echo+alexa&i=amazon-devices";

const REGRAS = [
  ["livros", /\blivros?\b|\bebook\b/],
  ["games", /playstation|\bps[45]\b|xbox|nintendo|switch 2|controle gamer|videogame/],
  ["pets", /\bpet\b|gatos?\b|caes|cachorro|racao/],
  ["auto", /automotiv|carro|pneu|carenagem|capacete|vonixx|v-floc|calibrador|compressor|bomba de ar|moto\b|motocicleta/],
  ["ferr", /parafusadeira|furadeira|chave|ferramenta|soquete|soprador|motosserra|lavadora|esmerilhadeira/],
  ["esporte", /creatina|whey|suplemento|bicicleta|bike|patinete|scooter|golfe|academia|yoga/],
  ["cel", /iphone|celular|smartphone|fone|carregador|power ?bank|airdots|pelicula|capinha/],
  ["info", /notebook|teclado|mouse|monitor|ssd|pendrive|filtro de linha/],
  ["tec", /caixa de som|caixinha de som|smart ?tv|televis|smartwatch|alexa|echo|camera/],
  ["eletro", /ventilador|aspirador|geladeira|micro-?ondas|ar condicionado|maquina de lavar/],
  ["calc", /chinelo|bota|tenis|sandalia|sapato/],
  ["moda", /calca|jeans|camiseta|vestido|blusa|bermuda|jaqueta/],
  ["beleza", /cabelo|barbear|barba|massageador|aparador|perfume|maquiagem|skincare|serum/],
  ["cozinha", /panela|faca|chaleira|omeleteira|fatiador|processador|tigela|marmita|garrafa|copo|caneca|petisqueira|churrasc|utensilio|cozinha|air ?fryer|liquidificador|sanduicheira/],
  ["cama", /jogo americano|sousplast|toalha|lencol|edredom|travesseiro/],
  ["brinq", /brinquedo|boneca|pelucia|lego|jogo de cartas/],
];
export function categoria(nome) {
  const t = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [c, r] of REGRAS) if (r.test(t)) return c;
  return "casa";
}

const preco = (s) => {
  const n = Number(String(s).replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const decodificar = (s) => String(s)
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

// ---------- Shopee (painel de afiliados, com cookie) ----------
export function deOfertaShopee(o) {
  const b = o.batch_item_for_item_card_full ?? {};
  const p = Number(b.price ?? b.price_min) / 100000;
  const antes = Number(b.price_before_discount) / 100000;
  if (!b.name || !(p > 0) || !/^https:\/\//.test(o.long_link ?? "")) return null;
  return {
    id: `shopee-${o.item_id ?? b.itemid}`,
    nome: b.name,
    loja: "shopee",
    categoria: categoria(b.name),
    preco: Math.round(p * 100) / 100,
    precoAntigo: antes > p ? Math.round(antes * 100) / 100 : null,
    nota: Number(b.item_rating?.rating_star) || 0,
    vendidos: Number(b.historical_sold ?? b.sold) || 0,
    imagem: b.image ? SHOPEE_IMG + b.image : null,
    link: o.long_link,
  };
}

async function coletarShopee(cookie, fetchImpl) {
  const produtos = [];
  for (let i = 0; i < SHOPEE_PAGINAS; i++) {
    const url = `${SHOPEE_LISTA}?list_type=0&sort_type=1&page_offset=${i * 50}&page_limit=50&client_type=1`;
    const r = await fetchImpl(url, {
      headers: { cookie, "user-agent": UA, accept: "application/json", referer: "https://affiliate.shopee.com.br/offer/product_offer" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`Shopee respondeu ${r.status}`);
    const j = await r.json().catch(() => null);
    const lista = j?.data?.list;
    if (!Array.isArray(lista)) throw new Error(j?.msg || j?.error || "sessão da Shopee expirada ou bloqueada (troque o SHOPEE_COOKIE)");
    for (const o of lista) { const p = deOfertaShopee(o); if (p) produtos.push(p); }
    if (lista.length < 50) break;
  }
  if (produtos.length < 10) throw new Error(`Shopee devolveu só ${produtos.length} ofertas`);
  return produtos;
}

// ---------- Amazon (páginas públicas) ----------
async function html(url, fetchImpl) {
  const r = await fetchImpl(url, {
    headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9", accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
  });
  const t = await r.text();
  if (!r.ok || /captcha|api-services-support@amazon/i.test(t.slice(0, 20000)) && !/gridItemRoot|s-search-result/.test(t)) {
    throw new Error(`Amazon bloqueou (${r.status})`);
  }
  return t;
}

const deAmazon = (asin, nome, valor, nota, img, cat, tag, destaque) => ({
  id: `amazon-${asin}`, nome, loja: "amazon", asin, categoria: cat, preco: valor, precoAntigo: null, nota: nota || 0,
  imagem: img ? `https://m.media-amazon.com/images/I/${img}._AC_SL500_.jpg` : null,
  link: `https://www.amazon.com.br/dp/${asin}?tag=${tag}`, ...(destaque ? { destaque: true } : {}),
});

export function lerMaisVendidos(t, cat, tag, limite = AMAZON_POR_CATEGORIA) {
  const out = [];
  for (const bloco of t.split('id="gridItemRoot"').slice(1)) {
    const asin = (bloco.match(/data-asin="([A-Z0-9]{10})"/) || [])[1];
    const nome = decodificar((bloco.match(/<img[^>]+alt="([^"]{5,})"/) || [])[1] ?? "");
    const img = (bloco.match(/\/images\/I\/([A-Za-z0-9+_-]+)\./) || [])[1];
    const valor = preco((bloco.match(/R\$(?:\s|&nbsp;)?([\d.]+,\d{2})/) || [])[1] ?? "");
    const nota = Number(((bloco.match(/(\d,\d) de 5 estrelas/) || [])[1] ?? "0").replace(",", "."));
    if (asin && nome && valor) out.push(deAmazon(asin, nome, valor, nota, img, cat === "tec" ? categoria(nome) : cat, tag));
    if (out.length >= limite) break;
  }
  return out;
}

export function lerBusca(t, tag) {
  const out = [];
  for (const bloco of t.split('data-component-type="s-search-result"').slice(1)) {
    const asin = (bloco.match(/data-asin="([A-Z0-9]{10})"/) || [])[1]
      ?? (bloco.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    const nome = decodificar((bloco.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]{5,})<\/span>/) || [])[1]
      ?? (bloco.match(/<img[^>]+alt="([^"]{5,})"/) || [])[1] ?? "");
    const img = (bloco.match(/\/images\/I\/([A-Za-z0-9+_-]+)\./) || [])[1];
    const valor = preco((bloco.match(/class="a-offscreen">R\$(?:\s|&nbsp;)?([\d.]+,\d{2})/) || [])[1] ?? "");
    const nota = Number(((bloco.match(/(\d,\d) de 5 estrelas/) || [])[1] ?? "0").replace(",", "."));
    if (asin && nome && valor && /echo|alexa|kindle|fire tv|ring/i.test(nome)) out.push(deAmazon(asin, nome, valor, nota, img, "tec", tag, true));
    if (out.length >= 12) break;
  }
  return out;
}

async function coletarAmazon(tag, fetchImpl, log) {
  const produtos = [];
  // Destaque: Alexa e dispositivos Amazon (mais vendidos de Dispositivos Amazon; a busca fica de reserva).
  let alexa = [];
  try {
    alexa = lerMaisVendidos(await html(AMAZON_DISPOSITIVOS, fetchImpl), "tec", tag, 30)
      .filter((p) => /echo|alexa|kindle|fire tv/i.test(p.nome)).slice(0, 12).map((p) => ({ ...p, destaque: true }));
  } catch (e) { log.warn(`[coletor] Dispositivos Amazon: ${e.message}`); }
  if (alexa.length < 3) {
    try { alexa = lerBusca(await html(AMAZON_ALEXA, fetchImpl), tag); } catch (e) { log.warn(`[coletor] Alexa: ${e.message}`); }
  }
  produtos.push(...alexa);
  for (const [cat, slug, digital] of AMAZON_MAIS_VENDIDOS) {
    try {
      const lista = lerMaisVendidos(await html(`https://www.amazon.com.br/gp/bestsellers/${slug}`, fetchImpl), cat, tag);
      produtos.push(...(digital ? lista.map(comoEbook) : lista));
    }
    catch (e) { log.warn(`[coletor] Amazon ${slug}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const vistos = new Set();
  const unicos = produtos.filter((p) => !vistos.has(p.id) && vistos.add(p.id));
  if (unicos.length < 10) throw new Error(`Amazon devolveu só ${unicos.length} produtos`);
  return unicos;
}

// eBook Kindle: sem ASIN o afiliados.js não troca o link pelo carrinho (que não aceita eBook).
export function comoEbook({ asin, ...p }) {
  return { ...p, nome: /kindle|ebook/i.test(p.nome) ? p.nome : `${p.nome} (eBook Kindle)` };
}

// ---------- Histórico de preço ----------
const DIAS_HISTORICO = 30;
const QUEDA_MINIMA = 0.03; // menos de 3% é oscilação, não vira selo
const diaDe = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Grava o preço de hoje de cada produto (um por dia, o último vale) e marca:
 * - queda: quanto caiu em relação ao maior preço dos 7 dias anteriores;
 * - menor30: menor preço dos últimos 30 dias, depois de ter estado pelo menos 3% mais caro.
 * Sem dia anterior registrado, não marca nada: desconto só com histórico de verdade.
 */
export function aplicarHistorico(produtos, historico = {}, agora = Date.now()) {
  const hoje = diaDe(agora), corte30 = diaDe(agora - DIAS_HISTORICO * 86_400_000), corte7 = diaDe(agora - 7 * 86_400_000);
  const novo = {};
  for (const [id, lista] of Object.entries(historico)) {
    const dentro = (Array.isArray(lista) ? lista : []).filter(([d]) => d >= corte30);
    if (dentro.length) novo[id] = dentro;
  }
  const marcados = produtos.map(({ queda, menor30, ...p }) => {
    const antes = (novo[p.id] ?? []).filter(([d]) => d < hoje);
    novo[p.id] = [...antes, [hoje, p.preco]];
    if (!antes.length) return p;
    const max7 = Math.max(0, ...antes.filter(([d]) => d >= corte7).map(([, v]) => v));
    const precos = antes.map(([, v]) => v);
    const marca = {};
    if (max7 > p.preco * (1 + QUEDA_MINIMA)) marca.queda = Math.round((max7 - p.preco) * 100) / 100;
    if (p.preco <= Math.min(...precos) && Math.max(...precos) > p.preco * (1 + QUEDA_MINIMA)) marca.menor30 = true;
    return { ...p, ...marca };
  });
  return { produtos: marcados, historico: novo };
}

/** Uma rodada. Nunca lança: o resultado (e os erros) vão para coleta-status.json. */
export async function rodarColeta({ env, dadosDir, manual, fetchImpl = fetch, log = console, agora = Date.now }) {
  const arq = join(dadosDir, "coleta.json");
  let anterior = [];
  try { anterior = JSON.parse(await readFile(arq, "utf8")).produtos ?? []; } catch { /* primeira rodada */ }
  const status = { ultimaTentativa: new Date().toISOString(), shopee: null, amazon: null, erros: [] };
  const daLoja = (l) => anterior.filter((p) => p.loja === l);

  let shopee = daLoja("shopee");
  if (env.SHOPEE_APP_ID && env.SHOPEE_SECRET) {
    shopee = []; status.shopee = "API oficial";
  } else if (env.SHOPEE_COOKIE) {
    try { shopee = await coletarShopee(env.SHOPEE_COOKIE, fetchImpl); status.shopee = shopee.length; }
    catch (e) { status.erros.push(`Shopee: ${e.message}`); }
  } else status.erros.push("Shopee: falta SHOPEE_COOKIE");

  let amazon = daLoja("amazon");
  try { amazon = await coletarAmazon(env.AMAZON_TAG || "citshop-20", fetchImpl, log); status.amazon = amazon.length; }
  catch (e) { status.erros.push(`Amazon: ${e.message}`); }

  const outros = anterior.filter((p) => p.loja !== "shopee" && p.loja !== "amazon");
  const juntos = [...amazon.filter((p) => p.destaque), ...shopee, ...amazon.filter((p) => !p.destaque), ...outros];
  const arqHist = join(dadosDir, "historico.json");
  let historico = {};
  try { historico = JSON.parse(await readFile(arqHist, "utf8")); } catch { /* primeira rodada */ }
  const { produtos, historico: novoHistorico } = aplicarHistorico(juntos, historico, agora());
  if (produtos.length) {
    await writeFile(arqHist + ".tmp", JSON.stringify(novoHistorico));
    await rename(arqHist + ".tmp", arqHist);
    await writeFile(arq + ".tmp", JSON.stringify({ atualizadoEm: status.ultimaTentativa, produtos }));
    await rename(arq + ".tmp", arq);
  }
  try {
    const r = await atualizarAfiliados({ env, dadosDir, manual });
    status.total = r.total;
  } catch (e) { status.erros.push(`afiliados.json: ${e.message}`); }
  await writeFile(join(dadosDir, "coleta-status.json"), JSON.stringify(status));
  return status;
}
