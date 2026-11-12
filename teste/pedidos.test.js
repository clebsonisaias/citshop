import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../servidor/dados.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

test("pedidos: WhatsApp registra com código, loja vê só os dela, muda situação, baixa planilha e dados vencem em 12 meses", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-pedidos-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agora = new Date().toISOString();
  const futuro = "2999-01-01T00:00:00.000Z";
  const banco = new Banco(dir);
  const senha = "senha-da-loja";
  for (const id of ["a", "b"]) {
    banco.lojas.push({ id: `loja-${id}`, slug: `loja-${id}`, nome: `Loja ${id}`, email: `${id}@loja.com`, senhaHash: gerarHashSenha(senha), cidade: "Natal", whatsapp: `558499999000${id === "a" ? 1 : 2}`, entrega: "ambos", criadaEm: agora, testeAte: futuro });
    banco.produtos.push({ id: `p${id}`, lojaId: `loja-${id}`, nome: `Laço ${id}`, dept: "moda", preco: 9.5, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: agora });
  }
  banco.d.pedidos = [
    { id: "P-VELHO", origem: "whatsapp", lojaId: "loja-a", produtoId: "l-pa", produtoNome: "Laço a", quantidade: 1, valorTotal: 9.5, comprador: { nome: "Antigo" }, etapa: "novo", criadoEm: "2020-01-01T00:00:00.000Z" },
    { id: "venda-sem-pagar", origem: "site", lojaId: "loja-a", produtoId: "l-pa", produtoNome: "Laço a", quantidade: 1, valorTotal: 9.5, comprador: { nome: "Desistiu" }, status: "criado", etapa: "novo", criadoEm: agora },
  ];
  banco.salvar();

  const { app, banco: b } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.citmax.com.br" }, log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (caminho, corpo, cookie) => fetch(`${base}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(corpo) });
  const entrar = async (email) => (await post("/api/painel/entrar", { email, senha })).headers.get("set-cookie").split(";")[0];

  // Dados de clientes com mais de 12 meses somem ao subir o servidor
  assert.ok(!b.d.pedidos.some((p) => p.id === "P-VELHO"));

  // Pedido pelo WhatsApp exige nome e WhatsApp; registra com código e manda para o WhatsApp da loja
  assert.equal((await post("/api/pedidos/whatsapp", { produtoId: "l-pa" })).status, 400);
  const r = await post("/api/pedidos/whatsapp", { produtoId: "l-pa", quantidade: 2, comprador: { nome: "Ana Cliente", whatsapp: "(84) 98888-7777", receber: "entrega", endereco: "Rua A, 10, Centro", observacao: "cor: Rosa" } });
  assert.equal(r.status, 200);
  const { pedido, url } = await r.json();
  assert.match(pedido, /^P-[0-9A-F]{6}$/);
  assert.ok(url.startsWith("https://wa.me/5584999990001?text="));
  const texto = decodeURIComponent(url.split("text=")[1]);
  assert.ok(texto.includes(pedido) && texto.includes("2x Laço a") && texto.includes("Rua A, 10"));

  // A loja A vê o pedido (e não vê a compra no site sem pagamento); a loja B não vê nada
  const cookieA = await entrar("a@loja.com"), cookieB = await entrar("b@loja.com");
  const painelA = await (await fetch(`${base}/api/painel/eu`, { headers: { cookie: cookieA } })).json();
  assert.deepEqual(painelA.pedidos.map((p) => p.id), [pedido]);
  assert.equal(painelA.pedidos[0].comprador.whatsapp, "5584988887777");
  const painelB = await (await fetch(`${base}/api/painel/eu`, { headers: { cookie: cookieB } })).json();
  assert.equal(painelB.pedidos.length, 0);

  // Situação: só a dona do pedido muda, e só para valores válidos
  const patch = (cookie, etapa) => fetch(`${base}/api/painel/pedidos/${pedido}`, { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ etapa }) });
  assert.equal((await patch(cookieB, "vendido")).status, 404);
  assert.equal((await patch(cookieA, "qualquer")).status, 400);
  const mudou = await (await patch(cookieA, "vendido")).json();
  assert.equal(mudou.pedidos[0].etapa, "vendido");

  // Planilha da loja A
  const csv = await fetch(`${base}/api/painel/pedidos.csv`, { headers: { cookie: cookieA } });
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const conteudo = await csv.text();
  assert.ok(conteudo.includes("Ana Cliente") && conteudo.includes("Pedido no WhatsApp") && conteudo.includes("Vendido"));
  assert.ok(!conteudo.includes("Desistiu"));
  assert.equal((await fetch(`${base}/api/painel/pedidos.csv`)).status, 401);
});
