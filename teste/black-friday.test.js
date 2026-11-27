import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";
import {
  FILTROS_BF,
  descontoProgressivo,
  proximaRodadaMs,
  resumoBlackFriday,
  selecionarRelampago,
  tempoRestante,
} from "../publico/black-friday.js";

test("descontoProgressivo: calcula faixa atingida, valor descontado e quanto falta para a próxima", () => {
  const faixas = [{ acima: 250, pct: 20 }, { acima: 100, pct: 10 }];
  const r1 = descontoProgressivo(80, faixas);
  assert.deepEqual([r1.pct, r1.valor, r1.totalComDesconto, r1.falta], [0, 0, 80, 20]);
  assert.equal(r1.proximaFaixa.pct, 10);

  const r2 = descontoProgressivo(150, faixas);
  assert.deepEqual([r2.pct, r2.valor, r2.totalComDesconto, r2.falta], [10, 15, 135, 100]);
  assert.equal(r2.proximaFaixa.pct, 20);

  const r3 = descontoProgressivo(300, faixas);
  assert.deepEqual([r3.pct, r3.valor, r3.totalComDesconto, r3.falta, r3.proximaFaixa], [20, 60, 240, 0, null]);
});

test("selecionarRelampago: determinístico na mesma hora, rotaciona na hora seguinte e mistura loja local", () => {
  const catalogo = [
    { id: "l-1", nome: "Laço", loja: "local", dept: "moda", preco: 10, precoAntigo: 15 },
    { id: "l-2", nome: "Tiara", loja: "local", dept: "moda", preco: 12, precoAntigo: 20 },
    ...Array.from({ length: 16 }, (_, i) => ({
      id: `shopee-${i}`, nome: `Produto ${i}`, loja: "shopee",
      dept: ["tec", "casa", "cozinha", "moda", "ferr", "auto", "esporte", "beleza"][i % 8],
      preco: 50, precoAntigo: 100, menor30: i % 2 === 0,
    })),
  ];
  const h1 = Date.parse("2026-11-27T10:15:00-03:00");
  const h1b = Date.parse("2026-11-27T10:55:00-03:00");
  const h2 = Date.parse("2026-11-27T11:05:00-03:00");
  const a = selecionarRelampago(catalogo, h1, 8).map((p) => p.id);
  const b = selecionarRelampago(catalogo, h1b, 8).map((p) => p.id);
  const c = selecionarRelampago(catalogo, h2, 8).map((p) => p.id);
  assert.equal(a.length, 8);
  assert.deepEqual(a, b, "mesma hora devolve exatamente a mesma seleção");
  assert.notDeepEqual(a, c, "hora seguinte rotaciona as ofertas");
  assert.ok(a.some((id) => id.startsWith("l-")), "inclui oferta de loja local");
});

test("tempoRestante, proximaRodadaMs, resumoBlackFriday e FILTROS_BF", () => {
  const t = tempoRestante(Date.parse("2026-12-01T00:00:00-03:00"), Date.parse("2026-11-29T22:30:15-03:00"));
  assert.deepEqual(t, { dias: 1, horas: 1, minutos: 29, segundos: 45, encerrado: false });
  assert.equal(tempoRestante(1000, 2000).encerrado, true);
  assert.equal(proximaRodadaMs(Date.parse("2026-11-27T10:45:00Z")), 15 * 60_000);

  const prods = [
    { id: "a", nome: "Air Fryer", loja: "shopee", dept: "cozinha", preco: 200, precoAntigo: 400, menor30: true },
    { id: "b", nome: "Fone", loja: "local", dept: "tec", preco: 45, precoAntigo: 60 },
    { id: "c", nome: "Sem desconto", loja: "shopee", dept: "casa", preco: 30 },
  ];
  assert.deepEqual(resumoBlackFriday(prods), { total: 2, com40Off: 1, menor30: 1, locais: 1, maiorOff: 50 });
  const f40 = FILTROS_BF.find((f) => f.id === "off40");
  assert.deepEqual(prods.filter((p) => f40.testar(p)).map((p) => p.id), ["a"]);
});

test("Black Friday no servidor: /api/vitrine, meta tags em /black-friday e desconto progressivo no painel/WhatsApp", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-bf-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = Date.parse("2026-11-27T14:00:00-03:00");
  const iso = new Date(agora).toISOString();
  const senhaLoja = "loja-bf-123";
  const banco = new Banco(dir);
  banco.lojas.push({
    id: "l1", slug: "delly", nome: "Delly", email: "d@bf.com",
    senhaHash: gerarHashSenha(senhaLoja), cidade: "Macaíba", whatsapp: "5584999990001",
    criadaEm: iso, testeAte: "2999-01-01T00:00:00Z",
  });
  banco.produtos.push({
    id: "p1", lojaId: "l1", nome: "Kit Laços", dept: "moda", preco: 60, precoAntigo: 80,
    fotos: ["/delly/tiara-laco-rosa.webp"], ativo: true, bloqueado: false, criadoEm: iso,
  });
  banco.salvar();
  writeFileSync(join(dir, "afiliados.json"), JSON.stringify({
    produtos: [{ id: "shopee-1", nome: "Smartwatch", loja: "shopee", categoria: "tec", preco: 120, precoAntigo: 240, menor30: true, link: "https://s.shopee.com.br/x" }],
  }));

  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br" }, log: {}, agora: () => agora });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const reqJson = (method, path, body, cookie) => fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

  // 1. /api/vitrine sinaliza Black Friday ativa
  const v = await (await fetch(`${base}/api/vitrine`)).json();
  assert.equal(v.campanha, "Black Friday");
  assert.equal(v.blackFriday.ativa, true);
  assert.equal(v.blackFriday.fase, "ativa");

  // 2. /black-friday entrega SEO/OpenGraph próprios
  const htmlBf = await (await fetch(`${base}/black-friday`)).text();
  assert.match(htmlBf, /<title>Black Friday CIT Shopping/);
  assert.match(htmlBf, /<link rel="canonical" href="https:\/\/shop\.citmax\.com\.br\/black-friday">/);

  // 3. Lojista configura desconto progressivo (10% acima de R$ 100, 20% acima de R$ 200)
  const login = await reqJson("POST", "/api/painel/entrar", { email: "d@bf.com", senha: senhaLoja });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const invalido = await reqJson("PUT", "/api/painel/desconto-progressivo", { faixas: [{ acima: 100, pct: 20 }, { acima: 200, pct: 10 }] }, cookie);
  assert.equal(invalido.status, 400, "desconto decrescente é recusado");

  const salvo = await reqJson("PUT", "/api/painel/desconto-progressivo", { faixas: [{ acima: "100,00", pct: 10 }, { acima: 200, pct: 20 }] }, cookie);
  assert.equal(salvo.status, 200);
  const painel = await salvo.json();
  assert.deepEqual(painel.loja.descontoProgressivo, [{ acima: 100, pct: 10 }, { acima: 200, pct: 20 }]);

  // 4. Vitrine expõe as faixas de desconto progressivo da loja
  const v2 = await (await fetch(`${base}/api/vitrine`)).json();
  assert.deepEqual(v2.lojas[0].descontoProgressivo, [{ acima: 100, pct: 10 }, { acima: 200, pct: 20 }]);

  // 5. Pedido pelo WhatsApp com 2 unidades (R$ 120) aplica 10% OFF automaticamente no servidor (total R$ 108)
  const ped = await (await reqJson("POST", "/api/pedidos/whatsapp", {
    produtoId: "l-p1", quantidade: 2,
    comprador: { nome: "Maria", whatsapp: "84999998888", receber: "retirada" },
  })).json();
  assert.equal(ped.ok, true);
  assert.match(decodeURIComponent(ped.url), /Desconto progressivo \(10% OFF\): -R\$\s*12,00/);
  assert.match(decodeURIComponent(ped.url), /Total: R\$\s*108,00/);
});
