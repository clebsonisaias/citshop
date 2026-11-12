import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Buscas, normalizarBusca } from "../servidor/buscas.js";
import { escolherPelaBusca, escolherProduto, horarioDaVez, prepararToken, semSegredos } from "../servidor/instagram-diario.js";
import { criarApp } from "../servidor/app.js";
import { gerarHashSenha } from "../servidor/seguranca.js";

const sp = (s) => Date.parse(`${s}-03:00`);

test("buscas: só o texto, sem telefone/CPF; começo de busca soma na busca completa", () => {
  assert.equal(normalizarBusca("  Capa de CELULAR!! "), "capa de celular");
  assert.equal(normalizarBusca("84999990000"), null);
  assert.equal(normalizarBusca("cpf 12345678900"), null);
  assert.equal(normalizarBusca("ab"), null);
  const dir = mkdtempSync(join(tmpdir(), "cit-buscas-"));
  let agora = sp("2026-11-12T10:00:00");
  const b = new Buscas({ dadosDir: dir, agora: () => agora });
  for (const q of ["capa", "capa de celular", "capa de celular", "capa de", "laço", "laço", "fone"]) b.registrar(q);
  b.descarregar();
  const top = new Buscas({ dadosDir: dir, agora: () => agora }).top(7);
  assert.deepEqual(top.map((x) => [x.termo, x.n]), [["capa de celular", 4], ["laco", 2], ["fone", 1]]);
  assert.deepEqual(top[0].palavras, ["capa", "celular"]);
  agora = sp("2026-11-25T10:00:00");
  assert.equal(b.top(7).length, 0, "passou a semana");
  rmSync(dir, { recursive: true, force: true });
});

test("horário da vez: no máximo 3 h depois, uma vez por horário", () => {
  const h = ["11:00", "19:00"];
  assert.equal(horarioDaVez(h, {}, sp("2026-11-12T10:59:00")), null);
  assert.equal(horarioDaVez(h, {}, sp("2026-11-12T11:05:00")), "2026-11-12|11:00");
  assert.equal(horarioDaVez(h, { "2026-11-12|11:00": "ok" }, sp("2026-11-12T12:00:00")), null);
  assert.equal(horarioDaVez(h, {}, sp("2026-11-12T14:30:00")), null, "passou de 3 h: não posta atrasado");
  assert.equal(horarioDaVez(h, { "2026-11-12|11:00": "ok" }, sp("2026-11-12T19:10:00")), "2026-11-12|19:00");
});

const foto = ["/x.webp"];
const produtos = [
  { id: "shopee-1", loja: "shopee", nome: "Capa de celular antichoque iPhone 13", preco: 19.9, precoAntigo: 39.9, fotos: foto, dept: "cel" },
  { id: "shopee-2", loja: "shopee", nome: "Fone bluetooth TWS", preco: 59, fotos: foto, dept: "tec" },
  { id: "l-laco", loja: "local", lojaSlug: "mimosdadelly", nome: "Faixa laço cruzado rosa", descricao: "Laços e Acessórios Infantis", preco: 5.9, fotos: foto, dept: "moda" },
  { id: "l-semfoto", loja: "local", lojaSlug: "outra", nome: "Sem foto", preco: 10, fotos: [] },
];

test("escolha pela busca: capa de celular acha a capa; roupinha de menina acha o laço da loja da cidade", () => {
  const t = sp("2026-11-12T11:00:00");
  const r1 = escolherPelaBusca(produtos, [], [{ termo: "capa de celular", n: 9, palavras: ["capa", "celular"] }], t);
  assert.deepEqual([r1.produto.id, r1.termo], ["shopee-1", "capa de celular"]);
  const r2 = escolherPelaBusca(produtos, [], [{ termo: "roupinha de menina", n: 3, palavras: ["roupinha", "menina"] }], t);
  assert.equal(r2.produto.id, "l-laco");
  const hist = [{ ok: true, em: new Date(t - 3600_000).toISOString(), produtoId: "x", termo: "capa de celular" }];
  assert.equal(escolherPelaBusca(produtos, hist, [{ termo: "capa de celular", n: 9, palavras: ["capa", "celular"] }], t), null, "termo já postado nos últimos 3 dias");
  assert.equal(escolherPelaBusca(produtos, [], [{ termo: "geladeira", n: 9, palavras: ["geladeira"] }], t), null, "sem produto que responda");
  assert.equal(escolherPelaBusca(produtos, [], [{ termo: "fone", n: 1, palavras: ["fone"] }], t), null, "1 busca só não basta");
});

test("rodízio: alterna loja da cidade e oferta, só com foto, sem repetir em 14 dias", () => {
  const t = sp("2026-11-12T11:00:00");
  assert.equal(escolherProduto(produtos, [], 0, t).id, "l-laco");
  assert.equal(escolherProduto(produtos, [], 1, t).id, "shopee-1", "a melhor oferta (com desconto)");
  const hist = [{ ok: true, em: new Date(t - 864e5).toISOString(), produtoId: "l-laco" }];
  assert.equal(escolherProduto(produtos, hist, 0, t).id, "shopee-1", "laço postado ontem: vai a oferta");
  assert.equal(escolherProduto([], [], 0, t), null);
  const tudo = [{ ok: true, em: new Date(t - 2 * 864e5).toISOString(), produtoId: "shopee-1" }, { ok: true, em: new Date(t - 864e5).toISOString(), produtoId: "l-laco" }, { ok: true, em: new Date(t - 3600e3).toISOString(), produtoId: "shopee-2" }];
  assert.equal(escolherProduto(produtos, tudo, 0, t).id, "shopee-1", "tudo já postado: repete o mais antigo (todo dia tem post)");
});

test("token: de Página passa direto; de usuário vira longo e de Página; inválido é recusado; segredos tapados", async () => {
  const graph = "https://g.test";
  const fake = (respostas) => async (url) => {
    const u = String(url);
    const k = Object.keys(respostas).find((p) => u.includes(p));
    return Response.json(typeof respostas[k] === "function" ? respostas[k](u) : respostas[k] ?? {});
  };
  assert.deepEqual(await prepararToken({ token: "PG", accountId: "17", appSecret: "s", graph, fetchImpl: fake({ debug_token: { data: { is_valid: true, type: "PAGE", expires_at: 0 } } }) }), { token: "PG", expiraEm: null, tipo: "PAGE" });
  const r = await prepararToken({ token: "CURTO", accountId: "17", appSecret: "s", graph, fetchImpl: fake({
    "input_token=CURTO": { data: { is_valid: true, type: "USER", app_id: "99", expires_at: 1763000000 } },
    "oauth/access_token": { access_token: "LONGO" },
    "me/accounts": { data: [{ access_token: "OUTRA", instagram_business_account: { id: "1" } }, { access_token: "PAGINA", instagram_business_account: { id: "17" } }] },
    "input_token=PAGINA": { data: { is_valid: true, type: "PAGE", expires_at: 0 } },
  }) });
  assert.deepEqual(r, { token: "PAGINA", expiraEm: null, tipo: "PAGE" });
  await assert.rejects(prepararToken({ token: "X", accountId: "17", graph, fetchImpl: fake({ debug_token: { data: { is_valid: false } } }) }), /não é válido/);
  // Sem App Secret: ainda pega o token da Página a partir do token colado (ex.: o de 60 dias do "Estender")
  const semSegredo = await prepararToken({ token: "LONGO60", accountId: "17", graph, fetchImpl: fake({
    "input_token=LONGO60": { data: { is_valid: true, type: "USER", app_id: "99", expires_at: 1768000000 } },
    "me/accounts": { data: [{ access_token: "PAGINA2", instagram_business_account: { id: "17" } }] },
    "input_token=PAGINA2": { data: { is_valid: true, type: "PAGE", expires_at: 0 } },
  }) });
  assert.deepEqual(semSegredo, { token: "PAGINA2", expiraEm: null, tipo: "PAGE" });
  assert.deepEqual(semSegredos({ instagram: { accessToken: "EAAabcd1234", accountId: "17" }, telegram: { botToken: "123:xyz9" } }), { instagram: { accessToken: "••••1234", accountId: "17" }, telegram: { botToken: "••••xyz9" } });
});

test("postagem diária ponta a ponta (Meta simulada): conecta, posta 1 vez no horário, registra o motivo; campo vazio não apaga token; admin não vê token", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cit-insta-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const publicados = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes("debug_token")) return Response.json({ data: { is_valid: true, type: "PAGE", expires_at: 0 } });
    if (u.includes("/media_publish")) { publicados.push(init?.body ? String(init.body) : u); return Response.json({ id: `m${publicados.length}` }); }
    if (u.includes("/media")) return Response.json({ id: "c1" });
    if (u.includes("status_code")) return Response.json({ status_code: "FINISHED" });
    if (u.includes("fields=id,username")) return Response.json({ id: "17", username: "citshopping" });
    return Response.json({});
  };
  let agora = sp("2026-11-12T11:05:00");
  const senha = randomBytes(8).toString("hex");
  const { app, postarInstagramDoDia, buscas, banco } = criarApp({ env: { SESSAO_SEGREDO: "s".repeat(40), DADOS_DIR: dir, ADMIN_SENHA_HASH: gerarHashSenha(senha) }, fetchImpl, agora: () => agora, log: { info() {}, warn() {}, error() {} } });
  banco.lojas.push({ id: "d", slug: "mimosdadelly", nome: "Mimos da Delly", categoria: "Laços e Acessórios Infantis", cidade: "Macaíba", whatsapp: "5584900000001", criadaEm: new Date(agora).toISOString(), testeAte: "2999-01-01T00:00:00Z" });
  banco.produtos.push({ id: "laco", lojaId: "d", nome: "Faixa laço cruzado rosa", dept: "moda", preco: 5.9, fotos: ["/x.webp"], ativo: true, bloqueado: false, criadoEm: new Date(agora).toISOString() });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const admin = (await fetch(`${base}/api/admin/entrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha }) })).headers.get("set-cookie").split(";")[0];
  const cfg = (corpo) => fetch(`${base}/api/admin/instagram/config`, { method: "POST", headers: { "Content-Type": "application/json", cookie: admin }, body: JSON.stringify(corpo) });

  assert.equal((await cfg({ accountId: "17", accessToken: "EAAtokenNovo9876", diario: { ativo: true, horarios: "11:00, 19:00" } })).status, 200);
  assert.equal((await cfg({ accountId: "17", accessToken: "", diario: { ativo: true, horarios: "11:00, 19:00" } })).status, 200, "salvar sem token");
  const central = await (await fetch(`${base}/api/admin/central-ofertas`, { headers: { cookie: admin } })).json();
  assert.equal(central.configuracao.instagram.accessToken, "••••9876", "token guardado e tapado para o navegador");

  // Busca no site vira o motivo do post
  for (let i = 0; i < 3; i++) await fetch(`${base}/api/busca`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "roupinha de menina" }) });
  assert.deepEqual(buscas.top(7)[0], { termo: "roupinha de menina", n: 3, palavras: ["roupinha", "menina"] });

  const r = await postarInstagramDoDia();
  assert.deepEqual([r.postado, r.produto], [true, "l-laco"]);
  assert.equal((await postarInstagramDoDia()).postado, false, "o mesmo horário não posta de novo");
  const st = await (await fetch(`${base}/api/admin/instagram/status`, { headers: { cookie: admin } })).json();
  assert.match(st.historicoDiario[0].motivo, /mais buscado da semana: "roupinha de menina"/);
  assert.deepEqual([st.diario.ativo, st.diario.horarios, st.token.tipo], [true, ["11:00", "19:00"], "PAGE"]);
  agora = sp("2026-11-12T19:02:00");
  assert.equal((await postarInstagramDoDia()).postado, true, "segundo horário do dia");
  assert.equal(publicados.length, 2);
});
