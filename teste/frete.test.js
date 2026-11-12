import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

// 1° de latitude ≈ 111,2 km: 0,018° ≈ 2 km, 0,0405° ≈ 4,5 km, 0,135° ≈ 15 km ao norte da loja
const LOJA = { lat: -5.8, lng: -35.2 };
const A_2KM = { lat: LOJA.lat + 0.018, lng: LOJA.lng }, A_4KM = { lat: LOJA.lat + 0.0405, lng: LOJA.lng }, A_15KM = { lat: LOJA.lat + 0.135, lng: LOJA.lng };

test("frete por km: faixas, fora da área, grátis acima de, total e Mercado Pago com frete, painel e planilha", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-frete-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const senha = "senha-da-loja";
  const banco = new Banco(dir);
  banco.lojas.push({
    id: "lf", slug: "lf", nome: "Loja F", email: "f@loja.com", senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: "5584999990001", criadaEm: agora, testeAte: "2999-01-01T00:00:00.000Z",
    local: { ...LOJA, endereco: "Rua da Loja, 1" }, frete: { faixas: [{ ateKm: 3, valor: 5 }, { ateKm: 6, valor: 8 }, { ateKm: 10, valor: 12 }], gratisAcima: 100 },
  });
  banco.lojas.push({ id: "ln", slug: "ln", nome: "Loja N", cidade: "Natal", whatsapp: "5584999990002", criadaEm: agora, testeAte: "2999-01-01T00:00:00.000Z" });
  banco.produtos.push({ id: "pf", lojaId: "lf", nome: "Laço F", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.produtos.push({ id: "pn", lojaId: "ln", nome: "Laço N", dept: "moda", preco: 10, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  banco.salvar();

  const consultas = [];
  const { app, banco: b } = criarApp({
    env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br" },
    fetchImpl: async (url) => {
      if (String(url).startsWith("https://nominatim.openstreetmap.org/")) {
        consultas.push(String(url));
        // O OpenStreetMap não conhece o número da casa "77": só acha a rua
        if (decodeURIComponent(String(url)).includes("77")) return { ok: true, json: async () => [] };
        return { ok: true, json: async () => [{ lat: String(A_4KM.lat), lon: String(A_4KM.lng), display_name: "Rua do Cliente, Natal, RN" }] };
      }
      return { ok: true, json: async () => ({}) };
    },
    log: { info() {}, warn() {}, error() {} },
  });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const json = (metodo, caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const cliente = (extra) => ({ nome: "Ana Cliente", whatsapp: "84988887777", receber: "entrega", endereco: "Rua do Cliente, 10, Natal", ...extra });

  // 1. Cotação: sem ponto devolve a tabela; com ponto, a faixa certa; fora da última faixa avisa
  assert.deepEqual((await (await json("POST", "/api/frete", { produtoId: "l-pn" })).json()), { configurado: false });
  const tabela = await (await json("POST", "/api/frete", { produtoId: "l-pf" })).json();
  assert.equal(tabela.configurado, true);
  assert.equal(tabela.faixas.length, 3);
  assert.ok(!("lat" in tabela), "a tabela não revela onde a loja fica");
  const q2 = await (await json("POST", "/api/frete", { produtoId: "l-pf", ...A_2KM })).json();
  assert.deepEqual([q2.km, q2.valor], [2, 5]);
  assert.deepEqual((await (await json("POST", "/api/frete", { produtoId: "l-pf", ...A_4KM })).json()).valor, 8);
  const longe = await (await json("POST", "/api/frete", { produtoId: "l-pf", ...A_15KM })).json();
  assert.equal(longe.fora, true);
  // grátis acima de R$ 100 (10 unidades de R$ 10)
  const gratis = await (await json("POST", "/api/frete", { produtoId: "l-pf", quantidade: 10, ...A_2KM })).json();
  assert.deepEqual([gratis.valor, gratis.gratis], [0, true]);

  // 2. Endereço digitado vira ponto pelo OpenStreetMap (uma consulta; repetir usa o cache)
  const porEndereco = await (await json("POST", "/api/frete", { produtoId: "l-pf", endereco: "Rua do Cliente, 10, Natal" })).json();
  assert.equal(porEndereco.valor, 8);
  assert.equal(porEndereco.encontrado, "Rua do Cliente, Natal, RN");
  await json("POST", "/api/frete", { produtoId: "l-pf", endereco: "Rua do Cliente, 10, Natal" });
  assert.equal(consultas.length, 1);
  assert.ok(consultas[0].includes("countrycodes=br"));
  // Número não encontrado: tenta de novo só com a rua e avisa que é aproximado
  const aprox = await (await json("POST", "/api/frete", { produtoId: "l-pf", endereco: "Rua do Fundo 77, Natal" })).json();
  assert.deepEqual([aprox.aproximado, aprox.valor], [true, 8]);
  assert.equal(consultas.length, 3, "completo + sem número");

  // 3. Pedido pelo WhatsApp: entrega exige o cálculo, recusa fora da área e soma o frete calculado no servidor
  assert.equal((await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pf", comprador: cliente() })).status, 400, "entrega sem cálculo");
  const recusa = await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pf", comprador: cliente(A_15KM) });
  assert.equal(recusa.status, 400);
  assert.match((await recusa.json()).erro, /fora da área/);
  const ok = await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pf", quantidade: 2, comprador: cliente({ ...A_2KM, frete: 0, valor: 0 }) });
  assert.equal(ok.status, 200);
  const { pedido, url } = await ok.json();
  const ped = b.d.pedidos.find((p) => p.id === pedido);
  assert.deepEqual([ped.valorTotal, ped.entrega.valor, ped.entrega.km], [25, 5, 2], "R$ 20 de produtos + R$ 5 de frete; valor do aparelho não vale");
  const texto = decodeURIComponent(url.split("text=")[1]);
  assert.ok(/Entrega \(2 km\): R\$\s5,00/.test(texto) && texto.includes("maps?q=-5.782") && /Total: R\$\s25,00/.test(texto));
  // Retirada na loja não cobra frete
  const retirada = await (await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pf", comprador: cliente({ receber: "retirada" }) })).json();
  assert.equal(b.d.pedidos.find((p) => p.id === retirada.pedido).entrega, undefined);
  // Loja sem faixas: entrega continua combinada com a loja, sem cálculo
  assert.equal((await json("POST", "/api/pedidos/whatsapp", { produtoId: "l-pn", comprador: cliente() })).status, 200);

  // 4. Painel: valida e grava; planilha traz o frete e o link do mapa; desligar remove
  const cookie = (await json("POST", "/api/painel/entrar", { email: "f@loja.com", senha })).headers.get("set-cookie").split(";")[0];
  const faixas = [{ ateKm: 6, valor: "8,5" }, { ateKm: 3, valor: 4 }];
  assert.equal((await json("PUT", "/api/painel/entrega", { faixas }, cookie)).status, 400, "sem ponto da loja");
  assert.equal((await json("PUT", "/api/painel/entrega", { local: LOJA, faixas: [{ ateKm: 3, valor: 4 }, { ateKm: 3, valor: 5 }] }, cookie)).status, 400, "faixas repetidas");
  assert.equal((await json("PUT", "/api/painel/entrega", { local: LOJA, faixas: Array.from({ length: 7 }, (_, i) => ({ ateKm: i + 1, valor: 1 })) }, cookie)).status, 400, "no máximo 6 faixas");
  const salvo = await (await json("PUT", "/api/painel/entrega", { local: { ...LOJA, endereco: "Rua Nova, 2" }, faixas: [{ ateKm: 6, valor: 8 }, { ateKm: 3, valor: 4 }], gratisAcima: "" }, cookie)).json();
  assert.deepEqual(salvo.loja.frete, { faixas: [{ ateKm: 3, valor: 4 }, { ateKm: 6, valor: 8 }], gratisAcima: null });
  assert.equal(salvo.loja.local.endereco, "Rua Nova, 2");
  const csv = await (await fetch(`${base}/api/painel/pedidos.csv`, { headers: { cookie } })).text();
  assert.ok(csv.includes("Frete") && csv.includes("maps?q=-5.782"));
  assert.equal((await fetch(`${base}/api/painel/geocodificar?q=Rua+X`)).status, 401);
  const geo = await (await fetch(`${base}/api/painel/geocodificar?q=Rua+do+Cliente,+Natal`, { headers: { cookie } })).json();
  assert.equal(geo.nome, "Rua do Cliente, Natal, RN");
  const desligado = await (await json("DELETE", "/api/painel/entrega", null, cookie)).json();
  assert.equal(desligado.loja.frete, undefined);
  assert.deepEqual(await (await json("POST", "/api/frete", { produtoId: "l-pf" })).json(), { configurado: false });

  // 5. Localização: privada por padrão (quem trabalha em casa); se a loja escolher mostrar, sai só o texto do endereço, nunca o pino
  const soLocal = await json("PUT", "/api/painel/entrega", { local: { ...LOJA, endereco: "Rua da Casa, 5, Centro" }, faixas: [] }, cookie);
  assert.equal(soLocal.status, 200, "só a localização, sem entrega por km");
  const vazou = async () => JSON.stringify(await (await fetch(`${base}/api/vitrine`)).json()) + (await (await fetch(`${base}/p/l-pf`)).text());
  let publico = await vazou();
  assert.ok(!publico.includes("Rua da Casa") && !publico.includes("-35.2") && !publico.includes('"lat"'), "escondido por padrão");
  assert.equal((await json("PUT", "/api/painel/entrega", { local: { ...LOJA, endereco: "Rua" }, mostrarLocal: true, faixas: [] }, cookie)).status, 400, "mostrar exige o endereço");
  await json("PUT", "/api/painel/entrega", { local: { ...LOJA, endereco: "Rua da Casa, 5, Centro" }, mostrarLocal: true, faixas: [] }, cookie);
  const vit = await (await fetch(`${base}/api/vitrine`)).json();
  assert.equal(vit.lojas.find((l) => l.slug === "lf").localEndereco, "Rua da Casa, 5, Centro");
  assert.equal(vit.produtos.find((p) => p.id === "l-pf").localEndereco, "Rua da Casa, 5, Centro");
  assert.ok((await (await fetch(`${base}/p/l-pf`)).text()).includes("Endereço: Rua da Casa, 5, Centro"));
  publico = await vazou();
  assert.ok(!publico.includes("-35.2") && !publico.includes('"lat"') && !publico.includes("lng"), "o pino nunca sai, mesmo mostrando o endereço");
  // Desligar o frete não apaga a escolha de mostrar o endereço
  await json("DELETE", "/api/painel/entrega", null, cookie);
  assert.equal((await (await fetch(`${base}/api/vitrine`)).json()).lojas.find((l) => l.slug === "lf").localEndereco, "Rua da Casa, 5, Centro");
  await json("PUT", "/api/painel/entrega", { local: { ...LOJA, endereco: "Rua da Casa, 5, Centro" }, mostrarLocal: false, faixas: [] }, cookie);
  assert.equal((await (await fetch(`${base}/api/vitrine`)).json()).lojas.find((l) => l.slug === "lf").localEndereco, "", "desmarcar esconde de novo");
});
