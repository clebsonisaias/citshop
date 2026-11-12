import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";
import { Agente } from "../citshop-print/src/agente.js";
import { codificar, comandaEscPos, quebrar } from "../citshop-print/src/escpos.js";
import { enviarRede } from "../citshop-print/src/saidas.js";
import { criarInterface } from "../citshop-print/src/app.js";

test("ESC/POS: acentos em CP860, quebra de linha e largura de 58 mm", () => {
  assert.deepEqual(codificar("ãçé"), [0x84, 0x87, 0x82]);
  assert.deepEqual(codificar("ű"), [0x75], "sem a letra na tabela: sem acento");
  assert.ok(quebrar("Rua das Acácias, 120, Nova Parnamirim, perto da praça", 32).every((l) => l.length <= 32));
  const b = comandaEscPos({ tipo: "cozinha", restaurante: "Pizzaria", numero: 7, em: "2026-11-13T23:00:00Z", modalidade: "RETIRADA", cliente: "Ana", itens: [{ quantidade: 2, nome: "Pizza", opcoes: ["Sabores: Calabresa, Frango"], observacao: "sem cebola" }] }, { largura: 58 });
  const txt = b.toString("latin1");
  assert.ok(txt.includes("#7") && txt.includes("OBS: sem cebola") && txt.includes("Sabores: Calabresa, Frango"));
  assert.ok(!txt.includes("TOTAL"), "via da cozinha sem valores");
  assert.deepEqual([...b.subarray(-4)], [0x1d, 0x56, 0x42, 0], "termina cortando o papel");
});

test("CITshop Print: vínculo, impressão automática uma vez, impressora desligada, queda de internet, reinício e troca de token", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-print-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: join(dir, "srv") }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = (m, p, c, ck) => fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(ck && { cookie: ck }) }, body: c ? JSON.stringify(c) : undefined });
  const r = await req("POST", "/api/painel/cadastro", { nome: "Pizzaria", responsavel: "D", email: "p@x.com", senha: randomBytes(8).toString("hex"), whatsapp: "84988880001", cidade: "Natal", aceite: true, segmento: "food" });
  const ck = r.headers.get("set-cookie").split(";")[0];
  await req("PUT", "/api/food/painel/config", { horarios: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: "00:00", fecha: "23:59" })) }, ck);
  const painel = await (await req("POST", "/api/food/painel/itens", { nome: "Pastel", preco: "8" }, ck)).json();
  const pedir = () => req("POST", "/api/food/pedidos", { loja: painel.slug, receber: "retirada", pagamento: "dinheiro", itens: [{ itemId: painel.itens[0].id, quantidade: 1, observacao: "sem cebola" }], comprador: { nome: "Ana", whatsapp: "84999990000" } });
  const pendentesNoServidor = async () => (await (await req("GET", "/api/food/painel", null, ck)).json()).impressao.pendentes;

  // Impressora de rede falsa (porta 9100 simulada)
  const recebidas = [];
  let impressora;
  const ligar = (porta = 0) => new Promise((ok) => { impressora = createServer((s) => { const partes = []; s.on("data", (d) => partes.push(d)); s.on("end", () => recebidas.push(Buffer.concat(partes))); }).listen(porta, "127.0.0.1", () => ok(impressora.address().port)); });
  const porta = await ligar();
  t.after(() => impressora.close());
  const espera = () => new Promise((ok) => setTimeout(ok, 80));

  let agora = Date.now(), internet = true;
  const fetchApp = (url, init) => (internet ? fetch(url, init) : Promise.reject(new Error("sem internet")));
  const novoAgente = () => new Agente({ dir: join(dir, "app"), servidor: base, fetchImpl: fetchApp, agora: () => agora, proteger: (x) => ({ claro: x }), abrir: (g) => g?.claro ?? null, log: { info() {}, warn() {}, error() {} },
    enviar: (bytes, destino) => enviarRede(bytes, { ...destino, timeout: 1000 }) });
  let ag = novoAgente();

  // Vínculo com código de uso único; impressora de rede de 80 mm
  const { codigo } = await (await req("POST", "/api/food/painel/acessos", { papel: "impressora" }, ck)).json();
  assert.equal(await ag.vincular(codigo, "Caixa"), "Pizzaria");
  ag.configurar({ destino: { tipo: "rede", host: "127.0.0.1", porta }, largura: 80 });
  await ag.testar();
  await espera();
  assert.equal(recebidas.length, 1, "impressão de teste");

  // Pedido novo → imprime uma vez; ciclos seguintes não repetem
  await pedir();
  await ag.ciclo(); await ag.ciclo(); await ag.ciclo();
  await espera();
  assert.equal(recebidas.length, 2);
  assert.ok(recebidas[1].toString("latin1").includes("OBS: sem cebola"));
  assert.equal(await pendentesNoServidor(), 0);

  // Impressora desligada: fica pendente com erro, não marca como impresso; volta e imprime uma vez
  await new Promise((ok) => impressora.close(ok));
  await pedir();
  await ag.ciclo();
  assert.equal(await pendentesNoServidor(), 1);
  const comErro = () => ag.historico().find((x) => x.estado === "erro");
  assert.match(comErro().erro, /recusou|não respondeu|ECONN/);
  await ag.ciclo();
  assert.equal(comErro().tentativas, 1, "espera o intervalo antes de tentar de novo");
  await ligar(porta);
  agora += 60_000;
  await ag.ciclo(); await ag.ciclo();
  await espera();
  assert.equal(recebidas.length, 3);
  assert.equal(await pendentesNoServidor(), 0);

  // Queda de internet logo depois de imprimir + reinício do app: não imprime de novo, só avisa quando volta
  await pedir();
  const fetchOriginal = ag.fetchImpl;
  ag.fetchImpl = (url, init) => (String(url).includes("/api/print/trabalhos/") && init?.method === "POST" ? Promise.reject(new Error("caiu")) : fetchOriginal(url, init));
  await ag.ciclo();
  await espera();
  assert.equal(recebidas.length, 4);
  assert.equal(await pendentesNoServidor(), 1, "servidor ainda acha que está pendente");
  ag = novoAgente(); // reinício do computador/app: lê a fila do disco
  await ag.ciclo();
  await espera();
  assert.equal(recebidas.length, 4, "não imprimiu de novo");
  assert.equal(await pendentesNoServidor(), 0);

  // Sem internet: nada quebra; volta e segue
  internet = false;
  await ag.ciclo();
  assert.equal(ag.estado.online, false);
  internet = true;

  // Troca de token depois de 24 h: o antigo para de valer e o app segue funcionando
  const antigo = ag.token;
  agora += 25 * 60 * 60 * 1000;
  await pedir();
  await ag.ciclo();
  await espera();
  assert.notEqual(ag.token, antigo);
  assert.equal((await fetch(`${base}/api/print/trabalhos`, { headers: { authorization: `Bearer ${antigo}` } })).status, 401);
  assert.equal(recebidas.length, 5);

  // Revogado pelo painel: o app perde o acesso
  const acessoId = ag.cfg.acessoId;
  await req("DELETE", `/api/food/painel/acessos/${acessoId}`, null, ck);
  await ag.ciclo();
  assert.equal(ag.vinculado, false);
});

test("CITshop Print: tela local só aceita o próprio computador e pedidos com o cabeçalho do app", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-print-ui-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ag = new Agente({ dir, proteger: (x) => ({ claro: x }), abrir: (g) => g?.claro ?? null });
  const ui = await new Promise((ok) => { const s = criarInterface(ag).listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => ui.close());
  const url = `http://127.0.0.1:${ui.address().port}`;
  assert.equal((await fetch(`${url}/`)).status, 200);
  const comHost = await new Promise((ok) => request(`${url}/`, { headers: { host: "malicioso.com" } }, (r) => { r.resume(); ok(r.statusCode); }).end());
  assert.equal(comHost, 403, "DNS rebinding: outro host é recusado");
  assert.equal((await fetch(`${url}/desvincular`, { method: "POST" })).status, 404, "sem X-CIT (formulário de outro site)");
  assert.equal((await fetch(`${url}/configurar`, { method: "POST", headers: { "X-CIT": "1" }, body: JSON.stringify({ largura: 58 }) })).status, 200);
  assert.equal(ag.cfg.largura, 58);
});
