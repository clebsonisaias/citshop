import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanaisAfiliado, canalDoUtm, canalValido, lancarComissoesShopee, vendasPorCanal } from "../servidor/afiliados-canal.js";
import { resumoLivro } from "../servidor/financeiro.js";

test("canal: lido do utmContent da Shopee; sem a marca do CITshop é 'sem_canal'; canal desconhecido vira 'outros'", () => {
  assert.equal(canalDoUtm("citshop-whatsapp----"), "whatsapp");
  assert.equal(canalDoUtm("citshop-produto"), "produto");
  assert.equal(canalDoUtm("citshop-xyz"), "outros");
  assert.equal(canalDoUtm(""), "sem_canal");
  assert.equal(canalDoUtm("instagram"), "sem_canal", "sem 'citshop' não é nosso link");
  assert.equal(canalValido("<script>"), "outros");
});

const conversoes = [
  { conversionId: "c1", utm: "citshop-whatsapp", pedidos: [{ orderId: "o1", orderStatus: "COMPLETED", comissao: 4.2, itens: [{}] }] },
  { conversionId: "c2", utm: "citshop-site", pedidos: [{ orderId: "o2", orderStatus: "PENDING", comissao: 3, itens: [{}] }, { orderId: "o3", orderStatus: "COMPLETED", comissao: 1.8, itens: [{}] }] },
  { conversionId: "c3", utm: "", pedidos: [{ orderId: "o4", orderStatus: "CANCELLED", comissao: 2, itens: [{}] }] },
];

test("vendas por canal e comissão confirmada no livro (uma vez por pedido, estorno se cancelar depois)", () => {
  assert.deepEqual(vendasPorCanal(conversoes), {
    whatsapp: { pedidos: 1, estimada: 0, confirmada: 4.2, cancelados: 0 },
    site: { pedidos: 2, estimada: 3, confirmada: 1.8, cancelados: 0 },
    sem_canal: { pedidos: 1, estimada: 0, confirmada: 0, cancelados: 1 },
  });
  const banco = { d: {} }, agora = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(lancarComissoesShopee(banco, conversoes, agora), 2, "só os concluídos");
  assert.equal(lancarComissoesShopee(banco, conversoes, agora), 0, "rodar de novo não duplica");
  assert.equal(resumoLivro(banco.d.lancamentos).afiliado, 6);
  assert.equal(banco.d.lancamentos.find((l) => l.referencia === "o1").detalhe.canal, "whatsapp");
  // o1 foi devolvido depois de concluído: ajuste negativo, uma vez
  const depois = [{ ...conversoes[0], pedidos: [{ ...conversoes[0].pedidos[0], orderStatus: "CANCELLED" }] }];
  assert.equal(lancarComissoesShopee(banco, depois, agora), 1);
  assert.equal(lancarComissoesShopee(banco, depois, agora), 0);
  assert.equal(resumoLivro(banco.d.lancamentos).liquido, 1.8);
});

test("link por canal: gerado uma vez e guardado; Shopee lenta ou com erro cai no link de sempre; destino fora das lojas é recusado; robô não conta clique", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-canal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let chamadas = 0, modo = "ok";
  const shopee = {
    estaConfigurado: () => true,
    gerarLinkComSubIds: async (url, subIds) => {
      chamadas++;
      if (modo === "erro") throw new Error("error [10000]: System Error");
      if (modo === "lento") return new Promise(() => {});
      if (modo === "fora") return "https://golpe.example.com/x";
      return `https://s.shopee.com.br/${subIds.join("-")}`;
    },
  };
  const canais = new CanaisAfiliado({ dadosDir: dir, shopee, log: { warn() {} } });
  const p = { id: "shopee-1", loja: "shopee", link: "https://s.shopee.com.br/padrao", linkOriginal: "https://shopee.com.br/produto-i.1.1" };
  assert.equal(await canais.destino(p, "whatsapp"), "https://s.shopee.com.br/citshop-whatsapp");
  assert.equal(await canais.destino(p, "whatsapp"), "https://s.shopee.com.br/citshop-whatsapp");
  assert.equal(chamadas, 1, "guardado: não chama a API de novo");
  assert.ok(JSON.parse(readFileSync(join(dir, "links-canal.json"), "utf8"))["shopee-1|whatsapp"], "guardado no disco");
  modo = "erro";
  assert.equal(await canais.destino(p, "site"), "https://s.shopee.com.br/padrao");
  modo = "fora";
  assert.equal(await canais.destino(p, "bio"), "https://s.shopee.com.br/padrao", "destino fora das lojas parceiras nunca é usado");
  modo = "lento";
  const t0 = Date.now();
  assert.equal(await canais.destino(p, "telegram"), "https://s.shopee.com.br/padrao");
  assert.ok(Date.now() - t0 < 6000, "o clique não fica preso esperando a Shopee");
  assert.equal(await canais.destino({ ...p, link: "javascript:alert(1)", linkOriginal: null }, "site"), null);
  assert.equal(await canais.destino({ id: "amazon-x", loja: "amazon", link: "https://www.amazon.com.br/dp/X?tag=t-20" }, "site"), "https://www.amazon.com.br/dp/X?tag=t-20");

  assert.equal(canais.registrarClique("whatsapp", "shopee", "WhatsApp/2.23.20 A"), false, "prévia do WhatsApp não é clique");
  assert.equal(canais.registrarClique("whatsapp", "shopee", "Mozilla/5.0 (Linux; Android 14) Mobile"), true);
  canais.registrarClique("site", "amazon", "Mozilla/5.0");
  canais.descarregar();
  const de = new CanaisAfiliado({ dadosDir: dir }).cliquesNoPeriodo("2000-01-01");
  assert.deepEqual([de.whatsapp.total, de.site.porLoja.amazon], [1, 1], "contadores gravados e relidos");
});

test("conector real da Shopee: link com subIds e relatório paginado com o canal (API simulada)", async () => {
  const { ConectorShopee } = await import("../servidor/integracoes/shopee/conector.js");
  const corpos = [];
  const fetchImpl = async (url, init) => {
    const { query } = JSON.parse(init.body);
    corpos.push(query);
    assert.match(init.headers.Authorization, /^SHA256 Credential=app, Timestamp=\d+, Signature=[a-f0-9]{64}$/);
    if (query.includes("generateShortLink")) return Response.json({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/novo" } } });
    const segunda = query.includes("scrollId: \"abc\"");
    return Response.json({ data: { conversionReport: {
      nodes: [{ conversionId: segunda ? 2 : 1, purchaseTime: 1, utmContent: segunda ? "citshop-site" : "citshop-whatsapp", totalCommission: 1, orders: [{ orderId: segunda ? 20 : 10, orderStatus: "COMPLETED", items: [{ itemTotalCommission: "2.50" }, { itemTotalCommission: "1" }] }] }],
      pageInfo: { hasNextPage: !segunda, scrollId: segunda ? null : "abc" } } } });
  };
  const c = new ConectorShopee({ appId: "app", segredo: "x", fetchImpl });
  assert.equal(await c.gerarLinkComSubIds("https://shopee.com.br/p-i.1.2", ["citshop", "whats-app!"]), "https://s.shopee.com.br/novo");
  assert.match(corpos[0], /subIds: \["citshop","whatsapp"\]/, "subIds limpos");
  const r = await c.relatorioConversoes({ dias: 30 });
  assert.equal(r.conversoes.length, 2, "leu as duas páginas pelo scrollId");
  assert.deepEqual(vendasPorCanal(r.conversoes), { whatsapp: { pedidos: 1, estimada: 0, confirmada: 3.5, cancelados: 0 }, site: { pedidos: 1, estimada: 0, confirmada: 3.5, cancelados: 0 } });
});
