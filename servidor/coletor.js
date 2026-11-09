/**
 * Coletor de ofertas (roda no servidor, sem navegador), enquanto as APIs oficiais não saem:
 *  - Shopee: lê a lista de ofertas do painel de afiliados com o cookie de sessão (SHOPEE_COOKIE).
 *    Cada oferta já traz o long_link, que é o link de afiliado (utm_source=an_<ID de afiliado>).
 *  - Amazon: lê as páginas de mais vendidos de cada subcategoria (geladeiras, air fryer, barracas...) e a busca,
 *    em rodízio (um pedaço por rodada), e monta o link com AMAZON_TAG.
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

// Tudo o que a Amazon vende, por subcategoria de mais vendidos: { departamento: [[caminho em /gp/bestsellers/, nome], ...] }.
// Até AMAZON_POR_PAGINA produtos por página. "busca:" usa a busca da Amazon (para o que não tem lista própria).
// eBook Kindle não entra no carrinho: vai sem ASIN, com link pro produto (ver comoEbook).
const CATALOGO_AMAZON = {
  eletro: [
    ["appliances/16745366011", "Geladeiras e freezers"], ["appliances/16745370011", "Máquinas de lavar e secadoras"],
    ["appliances/19821156011", "Lava-louças"], ["appliances/16745371011", "Fogões, fornos e cooktops"],
    ["appliances/17124786011", "Micro-ondas"], ["home/17124719011", "Ar-condicionado e ventilação"],
    ["appliances/19821155011", "Adegas e cervejeiras"], ["home/17124721011", "Ferros e vaporizadores"],
  ],
  cozinha: [
    ["kitchen/17124787011", "Air fryer e fritadeiras"], ["kitchen/17124733011", "Cafeteiras"],
    ["kitchen/17124779011", "Liquidificadores e batedeiras"], ["kitchen/17124792011", "Sanduicheiras"],
    ["kitchen/17125504011", "Purificadores de água"], ["kitchen/24417675011", "Panelas e utensílios"],
    ["kitchen/17124723011", "Louças, copos e talheres"], ["kitchen/17124715011", "Assadeiras e formas"],
    ["kitchen/17124717011", "Organização da cozinha"],
  ],
  casa: [
    ["home/17100531011", "Decoração"], ["home/17406462011", "Iluminação"], ["home/17100533011", "Organização"],
    ["home/17100529011", "Produtos de limpeza"], ["home/17100528011", "Banheiro"],
  ],
  cama: [["home/17100532011", "Cama, mesa e banho"]],
  tec: [
    ["electronics/16243809011", "TVs e home theater"], ["electronics/24035344011", "Fones de ouvido"],
    ["electronics/16243801011", "Caixas de som e áudio portátil"], ["electronics/16243802011", "Smartwatches"],
    ["electronics/16243796011", "Câmeras e foto"], ["electronics/16243797011", "Som e eletrônicos para carro"],
  ],
  cel: [["electronics/16243803011", "Celulares"], ["electronics/16243806011", "Baterias e carregadores"]],
  info: [
    ["computers/16364755011", "Notebooks"], ["computers/16364762011", "Tablets"], ["computers/16364756011", "Monitores"],
    ["computers/16364748011", "Acessórios de informática"], ["computers/16364753011", "Roteadores e redes"],
    ["computers/16364757011", "Impressoras"], ["computers/16364752011", "Armazenamento"], ["computers/16364751011", "Computadores"],
  ],
  games: [
    ["videogames/20971488011", "PlayStation 5"], ["videogames/206234074011", "Nintendo Switch 2"],
    ["videogames/16253308011", "Nintendo Switch"], ["videogames/20971505011", "Xbox Series"], ["videogames/16253313011", "PC gamer"],
  ],
  camping: [
    ["sports/17834346011", "Barracas e abrigos"], ["sports/17834343011", "Segurança e sobrevivência"],
    ["busca:perneira cobra", "Perneiras"], ["sports/17834341011", "Lanternas"], ["sports/17834340011", "Facas e ferramentas"],
    ["sports/17834332011", "Sacos de dormir e colchões"], ["sports/17834330011", "Mochilas"],
    ["sports/17834333011", "Cozinha de acampamento"], ["sports/17834334011", "Cadeiras e móveis de camping"],
    ["sports/17834344011", "Acessórios para barraca"], ["sports/17834339011", "Hidratação"],
    ["sports/17834337011", "GPS e navegação"], ["sports/17834039011", "Escalada"],
    ["busca:kit sobrevivencia", "Kits de sobrevivência"], ["busca:rede de dormir camping", "Redes"],
  ],
  esporte: [
    ["sports/17833917011", "Academia"], ["sports/17833929011", "Corrida"], ["sports/17834036011", "Ciclismo"],
    ["sports/17834041011", "Pesca"], ["sports/17833933011", "Esportes com bola"], ["sports/17833930011", "Lutas"],
  ],
  moda: [
    ["fashion/17681969011", "Feminino"], ["fashion/17681970011", "Masculino"], ["fashion/17681971011", "Meninas"],
    ["fashion/17681972011", "Meninos"], ["fashion/17681967011", "Bolsas, malas e mochilas"],
  ],
  beleza: [
    ["beauty/16754347011", "Perfumes"], ["beauty/16754350011", "Maquiagem"], ["beauty/16754345011", "Pele"],
    ["beauty/16754346011", "Cabelo"], ["beauty/16769359011", "Barbear e depilação"],
  ],
  saude: [
    ["hpc/16769375011", "Vitaminas e suplementos"], ["hpc/16769351011", "Bem-estar"], ["hpc/16769355011", "Higiene bucal"],
    ["hpc/16769354011", "Artigos médicos"],
  ],
  bebe: [
    ["baby-products/17540065011", "Fraldas e troca"], ["baby-products/17540063011", "Carrinhos e passeio"],
    ["baby-products/17540055011", "Amamentação"], ["baby-products/17540060011", "Banho do bebê"], ["baby-products/17540064011", "Segurança"],
  ],
  brinq: [
    ["toys/16746737011", "Bonecas"], ["toys/16746748011", "Bonecos"], ["toys/16746738011", "Blocos de montar"],
    ["toys/16746733011", "Educativos"], ["toys/16746749011", "Jogos"], ["toys/16746754011", "Quebra-cabeças"],
    ["toys/16746753011", "Pelúcias"], ["toys/20802846011", "Carrinhos"],
  ],
  ferr: [
    ["hi/17113547011", "Ferramentas elétricas"], ["hi/17113549011", "EPI e segurança"], ["hi/17113541011", "Material elétrico"],
    ["hi/17113548011", "Encanamento"], ["hi/17113543011", "Ferragens"],
  ],
  auto: [
    ["automotive/19701930011", "Cuidados automotivos"], ["automotive/19701949011", "Eletrônicos automotivos"],
    ["automotive/19702094011", "Ferramentas automotivas"], ["automotive/19702048011", "Óleos e fluidos"],
    ["automotive/19702075011", "Pneus e rodas"],
  ],
  pets: [
    ["pet-products/19653951011", "Cachorros"], ["pet-products/19653950011", "Gatos"],
    ["pet-products/19653949011", "Pássaros"], ["pet-products/19653948011", "Peixes"],
  ],
  mercado: [
    ["grocery/19778001011", "Café e chá"], ["grocery/19778022011", "Lanches e doces"], ["grocery/19778008011", "Grãos e massas"],
    ["grocery/19778011011", "Temperos"], ["hpc/18460204011", "Limpeza da casa"],
  ],
  papel: [
    ["office/17095644011", "Material escolar"], ["office/17095643011", "Canetas e lápis"],
    ["office/17095642011", "Escritório"], ["office/17095641011", "Papéis"],
  ],
  moveis: [
    ["furniture/17100554011", "Sala"], ["furniture/17100548011", "Sala de jantar"], ["furniture/17100552011", "Escritório"],
    ["furniture/17100547011", "Quarto"],
  ],
  jardim: [
    ["lawn-and-garden/19335820011", "Churrasco"], ["lawn-and-garden/19335825011", "Piscinas"],
    ["lawn-and-garden/19335828011", "Jardinagem"], ["lawn-and-garden/19335818011", "Cortadores de grama"],
    ["lawn-and-garden/17406474011", "Iluminação externa"],
  ],
  musica: [["musical-instruments", "Instrumentos musicais"]],
  livros: [["books", "Livros"], ["digital-text", "eBooks Kindle", true]],
};
// Intercalado por departamento: cada rodada passa por um pouco de tudo.
export const FONTES_AMAZON = (() => {
  const listas = Object.entries(CATALOGO_AMAZON).map(([dept, l]) => l.map(([caminho, sub, ebook]) => ({ dept, caminho, sub, ebook: Boolean(ebook) })));
  const out = [];
  for (let i = 0; listas.some((l) => l[i]); i++) for (const l of listas) if (l[i]) out.push(l[i]);
  return out;
})();
const AMAZON_POR_PAGINA = 25;
const AMAZON_POR_RODADA = 35; // páginas por rodada; o coletor roda a cada 4h, então o catálogo todo gira em ~16h
const AMAZON_BLOQUEIOS_SEGUIDOS = 3; // a Amazon bloqueou 3 seguidas: para a rodada e tenta o resto na próxima
const AMAZON_DISPOSITIVOS = "https://www.amazon.com.br/gp/bestsellers/amazon-devices";
// Ofertas do Dia (pública): traz o preço "De" de verdade, que as listas de mais vendidos não mostram.
const AMAZON_OFERTAS = "https://www.amazon.com.br/gp/goldbox";
const AMAZON_ALEXA = "https://www.amazon.com.br/s?k=echo+alexa&i=amazon-devices";

const REGRAS = [
  ["camping", /barraca|camping|acampamento|saco de dormir|perneira|sobreviv/],
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

export function lerMaisVendidos(t, cat, tag, limite = AMAZON_POR_PAGINA) {
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

// Sem `cat`: busca de dispositivos Alexa (destaque). Com `cat`: produtos de uma subcategoria buscada por palavra.
export function lerBusca(t, tag, cat = null, limite = 12) {
  const out = [];
  for (const bloco of t.split('data-component-type="s-search-result"').slice(1)) {
    const asin = (bloco.match(/data-asin="([A-Z0-9]{10})"/) || [])[1]
      ?? (bloco.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    const nome = decodificar((bloco.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]{5,})<\/span>/) || [])[1]
      ?? (bloco.match(/<img[^>]+alt="([^"]{5,})"/) || [])[1] ?? "");
    const img = (bloco.match(/\/images\/I\/([A-Za-z0-9+_-]+)\./) || [])[1];
    const valor = preco((bloco.match(/class="a-offscreen">R\$(?:\s|&nbsp;)?([\d.]+,\d{2})/) || [])[1] ?? "");
    const antes = preco((bloco.match(/a-text-price[^>]*>\s*<span class="a-offscreen">R\$(?:\s|&nbsp;)?([\d.]+,\d{2})/) || [])[1] ?? "");
    const nota = Number(((bloco.match(/(\d,\d) de 5 estrelas/) || [])[1] ?? "0").replace(",", "."));
    if (!asin || !nome || !valor) continue;
    if (cat) out.push({ ...deAmazon(asin, nome, valor, nota, img, cat, tag), precoAntigo: antes > valor && antes < valor * 5 ? antes : null });
    else if (/echo|alexa|kindle|fire tv|ring/i.test(nome)) out.push(deAmazon(asin, nome, valor, nota, img, "tec", tag, true));
    if (out.length >= limite) break;
  }
  return out;
}

/** Ofertas do Dia: cada card traz o preço com desconto e o "De" riscado. Sem o "De", não é oferta. */
export function lerOfertas(t, tag) {
  const out = [];
  for (const bruto of t.split(/class="a-cardui dcl-product\b/).slice(1)) {
    const fim = bruto.indexOf("dcl-product-wrapper");
    const b = fim > 0 ? bruto.slice(0, fim) : bruto;
    const asin = (b.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    const nome = decodificar(((b.match(/dcl-product-label[^>]*>([\s\S]*?)<\/span>/) || [])[1] ?? "").replace(/<[^>]+>/g, ""));
    const img = (b.match(/\/images\/I\/([A-Za-z0-9+_-]+)\./) || [])[1];
    const valor = preco((b.match(/dcl-product-price-new[\s\S]*?a-offscreen">R\$(?:\s|&nbsp;)?([\d.]+,\d{2})/) || [])[1] ?? "");
    const antes = preco((b.match(/dcl-product-price-old[\s\S]*?a-offscreen">R\$(?:\s|&nbsp;)?([\d.]+,\d{2})/) || [])[1] ?? "");
    if (asin && nome.length >= 5 && valor && antes > valor) {
      out.push({ ...deAmazon(asin, nome, valor, 0, img, categoria(nome), tag), precoAntigo: antes, oferta: true });
    }
  }
  return out;
}

const urlFonte = (f) => (f.caminho.startsWith("busca:")
  ? `https://www.amazon.com.br/s?k=${encodeURIComponent(f.caminho.slice(6))}`
  : `https://www.amazon.com.br/gp/bestsellers/${f.caminho}`);

/**
 * Rodízio: visita AMAZON_POR_RODADA fontes a partir de `cursor`. Fonte não visitada (ou bloqueada) fica com os
 * produtos da última visita, então nenhuma subcategoria some da vitrine. Produtos antigos sem `fonte` (antes do
 * rodízio) ficam até o departamento deles ter produtos novos.
 */
async function coletarAmazon(tag, fetchImpl, log, anteriores = [], { cursor = 0, fontes = FONTES_AMAZON, porRodada = AMAZON_POR_RODADA, pausaMs = 2000 } = {}) {
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
  if (alexa.length < 3) alexa = anteriores.filter((p) => p.destaque);
  produtos.push(...alexa);

  // Ofertas do Dia: se a página falhar, valem as da rodada anterior.
  let ofertas = [];
  try { ofertas = lerOfertas(await html(AMAZON_OFERTAS, fetchImpl), tag); }
  catch (e) { log.warn(`[coletor] Ofertas do Dia: ${e.message}`); }
  if (ofertas.length < 5) ofertas = anteriores.filter((p) => p.oferta).map((p) => ({ ...p, fonte: undefined }));
  const emOferta = new Map(ofertas.map((p) => [p.id, p]));

  const total = fontes.length;
  const novos = new Map(); // caminho -> produtos desta rodada
  let visitadas = 0, seguidos = 0, bloqueadas = 0;
  while (visitadas < Math.min(porRodada, total) && seguidos < AMAZON_BLOQUEIOS_SEGUIDOS) {
    const f = fontes[(cursor + visitadas) % total];
    visitadas++;
    try {
      const t = await html(urlFonte(f), fetchImpl);
      let lista = f.caminho.startsWith("busca:") ? lerBusca(t, tag, f.dept, AMAZON_POR_PAGINA) : lerMaisVendidos(t, f.dept, tag);
      if (f.ebook) lista = lista.map(comoEbook);
      novos.set(f.caminho, lista.map((p) => ({ ...p, categoria: f.dept, sub: f.sub, fonte: f.caminho })));
      seguidos = 0;
    } catch (e) {
      log.warn(`[coletor] Amazon ${f.sub}: ${e.message}`);
      seguidos++; bloqueadas++;
    }
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
  const conhecidas = new Set(fontes.map((f) => f.caminho));
  for (const f of fontes) produtos.push(...(novos.get(f.caminho) ?? anteriores.filter((p) => p.fonte === f.caminho)));
  const comFonte = new Set(produtos.filter((p) => p.fonte).map((p) => p.categoria));
  produtos.push(...anteriores.filter((p) => !p.destaque && (!p.fonte || (p.fonte !== "ofertas" && !conhecidas.has(p.fonte))) && !comFonte.has(p.categoria)));

  // Preço "De" só enquanto o produto está nas Ofertas do Dia (ou na busca desta rodada): nada de desconto vencido.
  const comOferta = produtos.map(({ oferta, ...p }) => {
    const o = emOferta.get(p.id);
    if (o) { emOferta.delete(p.id); return { ...p, preco: o.preco, precoAntigo: o.precoAntigo, oferta: true }; }
    return novos.has(p.fonte) && p.precoAntigo ? p : { ...p, precoAntigo: null };
  });
  comOferta.push(...[...emOferta.values()].map((p) => ({ ...p, fonte: "ofertas" })));

  const vistos = new Set();
  const unicos = comOferta.filter((p) => !vistos.has(p.id) && vistos.add(p.id));
  if (unicos.length < 10) throw new Error(`Amazon devolveu só ${unicos.length} produtos`);
  return { produtos: unicos, cursor: (cursor + visitadas) % total, visitadas, bloqueadas };
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
export async function rodarColeta({ env, dadosDir, manual, fetchImpl = fetch, log = console, agora = Date.now, opcoesAmazon = {} }) {
  const arq = join(dadosDir, "coleta.json");
  let anterior = [], cursor = 0;
  try { ({ produtos: anterior = [], cursor = 0 } = JSON.parse(await readFile(arq, "utf8"))); } catch { /* primeira rodada */ }
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
  try {
    const r = await coletarAmazon(env.AMAZON_TAG || "citshop-20", fetchImpl, log, amazon, { cursor, ...opcoesAmazon });
    ({ produtos: amazon, cursor } = r);
    Object.assign(status, { amazon: amazon.length, paginas: r.visitadas, bloqueadas: r.bloqueadas });
  } catch (e) { status.erros.push(`Amazon: ${e.message}`); }

  const outros = anterior.filter((p) => p.loja !== "shopee" && p.loja !== "amazon");
  const juntos = [...amazon.filter((p) => p.destaque), ...shopee, ...amazon.filter((p) => !p.destaque), ...outros];
  const arqHist = join(dadosDir, "historico.json");
  let historico = {};
  try { historico = JSON.parse(await readFile(arqHist, "utf8")); } catch { /* primeira rodada */ }
  const { produtos, historico: novoHistorico } = aplicarHistorico(juntos, historico, agora());
  if (produtos.length) {
    await writeFile(arqHist + ".tmp", JSON.stringify(novoHistorico));
    await rename(arqHist + ".tmp", arqHist);
    await writeFile(arq + ".tmp", JSON.stringify({ atualizadoEm: status.ultimaTentativa, cursor, produtos }));
    await rename(arq + ".tmp", arq);
  }
  try {
    const r = await atualizarAfiliados({ env, dadosDir, manual });
    status.total = r.total;
  } catch (e) { status.erros.push(`afiliados.json: ${e.message}`); }
  await writeFile(join(dadosDir, "coleta-status.json"), JSON.stringify(status));
  return status;
}
