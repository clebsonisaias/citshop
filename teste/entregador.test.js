import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { criarApp } from "../servidor/app.js";

test("Entregador do restaurante: link do painel, só entregas do restaurante, só marca saída e entrega, revogar corta o acesso", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-entr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { app } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, URL_PUBLICA: "https://shop.test" }, fetchImpl: async () => Response.json({}), log: { info() {}, warn() {}, error() {} } });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 0;
  const req = (metodo, caminho, corpo, h = {}) => fetch(`${base}${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.6.0.${++ip % 250}`, ...h }, body: corpo ? JSON.stringify(corpo) : undefined });
  const senha = randomBytes(8).toString("hex");
  const todos = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: "00:00", fecha: "23:59" }));
  const restaurante = async (nome, email) => {
    const c = (await req("POST", "/api/painel/cadastro", { nome, responsavel: "Dono", email, senha, whatsapp: `849${String(++ip).padStart(8, "1")}`, cidade: "Macaíba", aceite: true, segmento: "food" })).headers.get("set-cookie").split(";")[0];
    await req("PUT", "/api/food/painel/config", { horarios: todos, taxaEntrega: 5 }, { cookie: c });
    const p = await (await req("POST", "/api/food/painel/itens", { nome: "Lanche", preco: "20", categoria: "Lanches" }, { cookie: c })).json();
    return { c, slug: p.slug, item: p.itens[0].id };
  };
  const A = await restaurante("Lanches A", "a@x.com"), B = await restaurante("Lanches B", "b@x.com");
  const login = await req("POST", "/api/painel/entrar", { email: "a@x.com", senha, segmento: "food" });
  assert.match(login.headers.get("set-cookie"), /Path=\/api;/, "a sessão do restaurante vale para /api/food/* no navegador (não só /api/painel)");
  const pedir = (r, receber) => req("POST", "/api/food/pedidos", { loja: r.slug, receber, pagamento: "dinheiro", troco: "50", itens: [{ itemId: r.item, quantidade: 1, escolhas: {} }], comprador: { nome: "Ana", whatsapp: "84922222222", endereco: "Rua das Flores, 10, Centro" } }).then((x) => x.json());
  const entrega = await pedir(A, "entrega"), retirada = await pedir(A, "retirada");
  await pedir(B, "entrega");

  const novo = await (await req("POST", "/api/food/painel/acessos", { papel: "entregador" }, { cookie: A.c })).json();
  assert.match(novo.link, /^https:\/\/shop\.test\/entregador#[A-Za-z0-9_-]{20,}$/);
  const auth = { Authorization: `Bearer ${novo.link.split("#")[1]}` };
  assert.equal((await req("GET", "/api/food/entregas")).status, 401);
  assert.equal((await req("GET", "/api/food/kds", null, auth)).status, 401, "o link do entregador não abre a cozinha");

  let d = await (await req("GET", "/api/food/entregas", null, auth)).json();
  assert.equal(d.restaurante, "Lanches A");
  assert.deepEqual(d.entregas.map((e) => e.id), [], "pedido aguardando confirmação ainda não aparece");
  await req("PATCH", `/api/food/painel/pedidos/${entrega.pedido}`, { situacao: "pronto" }, { cookie: A.c });
  await req("PATCH", `/api/food/painel/pedidos/${retirada.pedido}`, { situacao: "pronto" }, { cookie: A.c });
  d = await (await req("GET", "/api/food/entregas", null, auth)).json();
  assert.deepEqual(d.entregas.map((e) => e.id), [entrega.pedido], "só entrega, só deste restaurante");
  assert.deepEqual(d.entregas[0].cobrar, { valor: 25, forma: "dinheiro", troco: 50 });
  assert.equal(d.entregas[0].cliente.endereco, "Rua das Flores, 10, Centro");

  const mudar = (id, situacao) => req("PATCH", `/api/food/entregas/pedidos/${id}`, { situacao }, auth);
  assert.equal((await mudar(entrega.pedido, "cancelado")).status, 403, "entregador não cancela");
  assert.equal((await mudar(retirada.pedido, "saiu")).status, 403, "pedido de retirada não é do entregador");
  assert.equal((await mudar(entrega.pedido, "saiu")).status, 200);
  assert.equal((await mudar(entrega.pedido, "entregue")).status, 200);
  d = await (await req("GET", "/api/food/entregas", null, auth)).json();
  assert.equal(d.entregas[0].situacao, "entregue");

  await req("DELETE", `/api/food/painel/acessos/${novo.acesso.id}`, null, { cookie: A.c });
  assert.equal((await req("GET", "/api/food/entregas", null, auth)).status, 401, "revogado: perde o acesso na hora");
});
