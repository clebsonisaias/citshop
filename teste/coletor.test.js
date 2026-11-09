import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONTES_AMAZON, aplicarHistorico, categoria, comoEbook, lerOfertas, rodarColeta } from "../servidor/coletor.js";

const DIA = 86_400_000;
const agora = Date.parse("2026-11-20T15:00:00Z");
const dia = (n) => new Date(agora - n * DIA).toISOString().slice(0, 10);
const tv = (preco) => ({ id: "amazon-TV", nome: "TV", loja: "amazon", preco });

test("primeira vez que o produto aparece: grava o preço e não marca nada", () => {
  const { produtos, historico } = aplicarHistorico([tv(100)], {}, agora);
  assert.equal(produtos[0].queda, undefined);
  assert.equal(produtos[0].menor30, undefined);
  assert.deepEqual(historico["amazon-TV"], [[dia(0), 100]]);
});

test("baixou mais de 3% em relação aos últimos 7 dias: marca queda e menor preço em 30 dias", () => {
  const h = { "amazon-TV": [[dia(20), 110], [dia(3), 120], [dia(1), 118]] };
  const { produtos } = aplicarHistorico([tv(99.9)], h, agora);
  assert.equal(produtos[0].queda, 20.1);
  assert.equal(produtos[0].menor30, true);
});

test("oscilação pequena ou preço acima do mínimo não ganha selo", () => {
  const h = { "amazon-TV": [[dia(10), 90], [dia(2), 101]] };
  const { produtos } = aplicarHistorico([tv(100)], h, agora);
  assert.equal(produtos[0].queda, undefined); // caiu só 1%
  assert.equal(produtos[0].menor30, undefined); // já esteve a 90
});

test("histórico guarda um preço por dia, esquece o que passou de 30 dias e limpa marca velha", () => {
  const h = { "amazon-TV": [[dia(40), 500], [dia(5), 120], [dia(0), 115]], "amazon-SUMIU": [[dia(2), 10]] };
  const { produtos, historico } = aplicarHistorico([{ ...tv(120), queda: 50, menor30: true }], h, agora);
  assert.deepEqual(historico["amazon-TV"], [[dia(5), 120], [dia(0), 120]]);
  assert.deepEqual(historico["amazon-SUMIU"], [[dia(2), 10]]); // fora da vitrine hoje, mas dentro dos 30 dias
  assert.equal(produtos[0].queda, undefined);
  assert.equal(produtos[0].menor30, undefined);
});

test("eBook Kindle vai sem ASIN (o carrinho da Amazon não aceita eBook) e com o formato no nome", () => {
  const e = comoEbook({ id: "amazon-B0X", asin: "B0X", nome: "A loja container", categoria: "livros", link: "https://www.amazon.com.br/dp/B0X?tag=t-20" });
  assert.equal(e.asin, undefined);
  assert.equal(e.nome, "A loja container (eBook Kindle)");
  assert.equal(comoEbook({ nome: "Box Kindle Edition" }).nome, "Box Kindle Edition");
});

test("categoria reconhece livros e games", () => {
  assert.equal(categoria("Livro de receitas da vovó"), "livros");
  assert.equal(categoria("Controle sem fio para PS5 DualSense"), "games");
  assert.equal(categoria("Fone Bluetooth"), "cel");
});

test("catálogo da Amazon cobre geladeira, air fryer, camping e perneira, sem caminho repetido", () => {
  const subs = FONTES_AMAZON.map((f) => f.sub);
  for (const s of ["Geladeiras e freezers", "Air fryer e fritadeiras", "Barracas e abrigos", "Perneiras", "Lava-louças"]) assert.ok(subs.includes(s), s);
  assert.equal(new Set(FONTES_AMAZON.map((f) => f.caminho)).size, FONTES_AMAZON.length);
});

test("rodízio: visita um pedaço por rodada, e o que não foi visitado ou foi bloqueado continua na vitrine", async () => {
  const dir = mkdtempSync(join(tmpdir(), "citshop-coleta-"));
  const manual = join(dir, "manual.json");
  writeFileSync(manual, "[]");
  // Antes do rodízio: um produto antigo de "eletro" sem fonte.
  writeFileSync(join(dir, "coleta.json"), JSON.stringify({ produtos: [{ id: "amazon-VELHO", nome: "Velho", loja: "amazon", asin: "VELHO00000", categoria: "eletro", preco: 10 }] }));
  const fontes = [
    { dept: "eletro", caminho: "appliances/1", sub: "Geladeiras" },
    { dept: "camping", caminho: "sports/2", sub: "Barracas" },
    { dept: "camping", caminho: "busca:perneira", sub: "Perneiras" },
  ];
  let bloquear = "";
  let n = 0;
  const pagina = (url) => Array.from({ length: 12 }, (_, i) => {
    const asin = `B${String(++n).padStart(9, "0")}`;
    return url.includes("/s?k=")
      ? `<div data-component-type="s-search-result" data-asin="${asin}"><h2><span>Perneira ${i}</span></h2><span class="a-offscreen">R$ 49,90</span></div>`
      : `<div id="gridItemRoot"><div data-asin="${asin}"><img alt="Produto ${i}">R$ 1.299,00</div></div>`;
  }).join("");
  const fetchImpl = async (url) => new Response(bloquear && url.includes(bloquear) ? "captcha" : pagina(url));
  const rodar = () => rodarColeta({ env: {}, dadosDir: dir, manual, fetchImpl, log: { warn() {} }, opcoesAmazon: { fontes, porRodada: 2, pausaMs: 0 } });
  const ler = () => JSON.parse(readFileSync(join(dir, "coleta.json"), "utf8"));
  try {
    await rodar();
    let c = ler();
    assert.equal(c.cursor, 2);
    assert.equal(c.produtos.some((p) => p.id === "amazon-VELHO"), false); // eletro já tem produto novo
    assert.equal(c.produtos.filter((p) => p.sub === "Geladeiras").length, 12);
    assert.equal(c.produtos.filter((p) => p.sub === "Barracas").length, 12);
    assert.equal(c.produtos.find((p) => p.sub === "Barracas").categoria, "camping");

    bloquear = "appliances"; // 2ª rodada: perneira (nova) e geladeira (bloqueada)
    await rodar();
    c = ler();
    assert.equal(c.cursor, 1);
    assert.equal(c.produtos.filter((p) => p.sub === "Perneiras").length, 12);
    assert.equal(c.produtos.filter((p) => p.sub === "Geladeiras").length, 12); // bloqueada: fica a da rodada anterior
    assert.equal(c.produtos.filter((p) => p.sub === "Barracas").length, 12); // não visitada: continua
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const cardOferta = (asin, nome, novo, velho) => `<div class="a-cardui dcl-product" ><a class="dcl-product-link" href="/dp/${asin}">
  <img src="https://m.media-amazon.com/images/I/41abc._AC_.jpg"><span class="dcl-truncate dcl-product-label"><span>${nome}</span></span>
  <span class="a-price dcl-product-price-new"><span class="a-offscreen">R$ ${novo}</span></span>
  ${velho ? `<span class="a-price a-text-price dcl-product-price-old"><span class="a-offscreen">R$ ${velho}</span></span>` : ""}</a></div><div class="dcl-product-wrapper">`;

test("Ofertas do Dia: lê preço com desconto e o De; sem De não é oferta", () => {
  const html = cardOferta("B0AIRFRY01", "Fritadeira Air Fryer Philips 12L", "549,00", "999,90") + cardOferta("B0SEMDE001", "Produto sem desconto", "10,00", "");
  const o = lerOfertas(html, "citshop-20");
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].id, o[0].preco, o[0].precoAntigo, o[0].categoria, o[0].oferta], ["amazon-B0AIRFRY01", 549, 999.9, "cozinha", true]);
});

test("desconto vale só enquanto o produto está nas Ofertas do Dia", async () => {
  const dir = mkdtempSync(join(tmpdir(), "citshop-ofertas-"));
  const manual = join(dir, "manual.json");
  writeFileSync(manual, "[]");
  const fontes = [{ dept: "cozinha", caminho: "kitchen/1", sub: "Air fryer" }];
  const grade = `<div id="gridItemRoot"><div data-asin="B0AIRFRY01"><img alt="Fritadeira Air Fryer Philips 12L">R$ 999,90</div></div>` +
    Array.from({ length: 11 }, (_, i) => `<div id="gridItemRoot"><div data-asin="B0OUTRO0${String(i).padStart(2, "0")}"><img alt="Outro produto ${i}">R$ 50,00</div></div>`).join("");
  const ofertasHoje = Array.from({ length: 5 }, (_, i) => cardOferta(`B0OFERTA0${i}`, `Oferta avulsa numero ${i}`, "10,00", "20,00")).join("");
  let comAirFryer = true;
  const fetchImpl = async (url) => new Response(url.includes("goldbox")
    ? ofertasHoje + (comAirFryer ? cardOferta("B0AIRFRY01", "Fritadeira Air Fryer Philips 12L", "549,00", "999,90") : cardOferta("B0OFERTA09", "Outra oferta qualquer", "10,00", "20,00"))
    : grade);
  const rodar = () => rodarColeta({ env: {}, dadosDir: dir, manual, fetchImpl, log: { warn() {} }, opcoesAmazon: { fontes, porRodada: 1, pausaMs: 0 } });
  const airfryer = () => JSON.parse(readFileSync(join(dir, "coleta.json"), "utf8")).produtos.filter((p) => p.id === "amazon-B0AIRFRY01");
  try {
    await rodar();
    let a = airfryer();
    assert.equal(a.length, 1); // não duplica: a oferta entra no produto da lista
    assert.deepEqual([a[0].preco, a[0].precoAntigo, a[0].sub], [549, 999.9, "Air fryer"]);
    comAirFryer = false;
    await rodar();
    a = airfryer();
    assert.deepEqual([a[0].preco, a[0].precoAntigo], [999.9, null]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
