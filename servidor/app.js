/**
 * CITshop: vitrine pública (afiliados + lojas locais), painel das lojas,
 * assinatura Mercado Pago e administração. `criarApp` recebe env e relógio
 * para os testes rodarem com pasta temporária e tempo controlado.
 */
import express from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import * as S from "./seguranca.js";
import { Banco, DEPTS, DIAS_TESTE, lojaVisivel, ordenarVitrine, slugUnico, statusLoja } from "./dados.js";
import { MAX_FOTOS, apagarFoto, receberFotos, receberLogo, salvarFoto } from "./uploads.js";
import { criarMercadoPago, statusDoMp, webhookValido } from "./mercadopago.js";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PRECO_PLANO = 49.9;
const DIA = 86_400_000;
const MAX_PRODUTOS = 200;

// ---------- validação ----------
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function whatsapp(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
function valor(v) {
  const s = String(v ?? "").trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}
function lerProduto(b) {
  const p = {
    nome: txt(b.nome, 90),
    descricao: String(b.descricao ?? "").trim().slice(0, 1000),
    dept: DEPTS.includes(b.dept) ? b.dept : null,
    preco: valor(b.preco),
    precoAntigo: b.precoAntigo ? valor(b.precoAntigo) : null,
  };
  if (p.nome.length < 3) return { erro: "Dê um nome ao produto." };
  if (!p.dept) return { erro: "Escolha o departamento." };
  if (!p.preco) return { erro: "Informe um preço válido." };
  if (p.precoAntigo && p.precoAntigo <= p.preco) p.precoAntigo = null;
  return { p };
}

export function criarApp({ env = process.env, log = console, agora = () => Date.now(), fetchImpl = fetch } = {}) {
  const segredo = env.SESSAO_SEGREDO ?? "";
  if (segredo.length < 32) throw new Error("SESSAO_SEGREDO precisa ter pelo menos 32 caracteres.");
  const dadosDir = env.DADOS_DIR ?? join(RAIZ, "dados");
  const uploadsDir = join(dadosDir, "uploads");
  const publico = join(RAIZ, "publico");
  const urlPublica = String(env.URL_PUBLICA ?? "http://localhost:3000").replace(/\/$/, "");
  const banco = new Banco(dadosDir);
  const mp = criarMercadoPago({ token: env.MP_ACCESS_TOKEN, fetchImpl });
  const limiteLogin = new S.Limitador({ maximo: 8, janelaMs: 10 * 60_000 });
  const limiteCadastro = new S.Limitador({ maximo: 5, janelaMs: 60 * 60_000 });
  const iso = () => new Date(agora()).toISOString();

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => { S.aplicarCabecalhos(req, res); next(); });
  app.use("/uploads", express.static(uploadsDir, { index: false, fallthrough: false, immutable: true, maxAge: "30d" }));
  app.use(express.json({ limit: "50kb" }));
  // Toda escrita na API precisa vir da própria página (junto com SameSite=Lax nos cookies).
  app.use("/api", (req, res, next) => (req.method !== "GET" && !S.origemConfiavel(req) ? erro(res, 403, "Origem não permitida.") : next()));

  const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const erro = (res, status, msg) => res.status(status).json({ erro: msg });

  // ---------- sessões ----------
  const CAMINHO = { loja: "/api/painel", admin: "/api/admin" };
  const sessao = (req, tipo) => {
    const d = S.lerSessao(S.lerCookies(req.headers.cookie)[`citshop_${tipo}`], { segredo, agora: agora() });
    return d?.t === tipo ? d : null;
  };
  const abrirSessao = (req, res, tipo, id) => res.setHeader("Set-Cookie", S.cookie({
    nome: `citshop_${tipo}`, caminho: CAMINHO[tipo], https: S.ehHttps(req),
    valor: S.criarSessao({ segredo, dados: { t: tipo, id }, agora: agora() }),
  }));
  const fecharSessao = (req, res, tipo) => res.setHeader("Set-Cookie", S.cookie({ nome: `citshop_${tipo}`, valor: "", caminho: CAMINHO[tipo], https: S.ehHttps(req) }));

  function exigirLoja(req, res, next) {
    const loja = banco.loja(sessao(req, "loja")?.id);
    if (!loja) return erro(res, 401, "Entre na sua conta.");
    req.loja = loja;
    next();
  }
  function exigirAdmin(req, res, next) {
    return sessao(req, "admin") ? next() : erro(res, 401, "Entre como administrador.");
  }

  // ---------- vitrine pública ----------
  function afiliados() {
    try { return JSON.parse(readFileSync(join(dadosDir, "afiliados.json"), "utf8")); } catch { return { produtos: [] }; }
  }
  const lojaPublica = (l) => ({
    slug: l.slug, nome: l.nome, cidade: l.cidade, categoria: l.categoria, whatsapp: l.whatsapp, desde: l.criadaEm,
    logo: l.logo ?? null, cor: l.cor ?? null, sobre: l.sobre ?? "",
  });
  const produtoLocal = (p, l) => ({
    id: `l-${p.id}`, nome: p.nome, descricao: p.descricao, dept: p.dept, loja: "local",
    lojaSlug: l.slug, lojaNome: l.nome, lojaLogo: l.logo ?? null, cidade: l.cidade, whatsapp: l.whatsapp,
    preco: p.preco, precoAntigo: p.precoAntigo, fotos: p.fotos, nota: 0, vendidos: 0,
  });
  const produtoAfiliado = (x) => ({
    id: x.id, nome: x.nome, dept: DEPTS.includes(x.categoria) ? x.categoria : "casa", loja: x.loja,
    preco: x.preco, precoAntigo: x.precoAntigo, nota: x.nota ?? 0, vendidos: x.vendidos ?? 0,
    fotos: x.imagem ? [x.imagem] : [], link: x.link, queda: x.queda,
  });

  app.get("/api/vitrine", (req, res) => {
    const t = agora();
    const visiveis = new Map(banco.lojas.filter((l) => lojaVisivel(l, t)).map((l) => [l.id, l]));
    const locais = banco.produtos
      .filter((p) => p.ativo && !p.bloqueado && visiveis.has(p.lojaId))
      .sort((x, y) => y.criadoEm.localeCompare(x.criadoEm))
      .map((p) => produtoLocal(p, visiveis.get(p.lojaId)));
    const af = afiliados();
    res.set("Cache-Control", "no-cache").json({
      atualizadoEm: af.atualizadoEm ?? null,
      lojas: [...visiveis.values()].map(lojaPublica),
      produtos: ordenarVitrine([...locais, ...af.produtos.map(produtoAfiliado)]),
    });
  });

  // ---------- painel da loja ----------
  function painelDe(loja) {
    const t = agora();
    const { senhaHash, ...dados } = loja;
    return {
      loja: dados,
      status: statusLoja(loja, t),
      diasTeste: Math.max(0, Math.ceil((Date.parse(loja.testeAte) - t) / DIA)),
      preco: PRECO_PLANO,
      pagamentoConfigurado: mp.configurado,
      produtos: banco.produtos.filter((p) => p.lojaId === loja.id),
    };
  }

  app.post("/api/painel/cadastro", a(async (req, res) => {
    if (!limiteCadastro.registrar(S.ipDe(req)).permitido) return erro(res, 429, "Muitos cadastros a partir desta conexão. Tente mais tarde.");
    const b = req.body ?? {};
    const loja = {
      nome: txt(b.nome, 60), responsavel: txt(b.responsavel, 80), email: txt(b.email, 120).toLowerCase(),
      whatsapp: whatsapp(b.whatsapp), cidade: txt(b.cidade, 60), categoria: txt(b.categoria, 60),
    };
    if (loja.nome.length < 2) return erro(res, 400, "Informe o nome da loja.");
    if (!loja.responsavel) return erro(res, 400, "Informe o nome do responsável.");
    if (!emailOk(loja.email)) return erro(res, 400, "Informe um e-mail válido.");
    if (String(b.senha ?? "").length < 8) return erro(res, 400, "A senha precisa ter pelo menos 8 caracteres.");
    if (!loja.whatsapp) return erro(res, 400, "Informe o WhatsApp com DDD.");
    if (!loja.cidade) return erro(res, 400, "Informe a cidade.");
    if (b.aceite !== true) return erro(res, 400, "Aceite os termos para continuar.");
    if (banco.lojaPorEmail(loja.email)) return erro(res, 409, "Já existe uma loja com este e-mail. Entre com sua senha.");
    const t = agora();
    Object.assign(loja, {
      id: randomUUID(), slug: slugUnico(loja.nome, banco.lojas), senhaHash: S.gerarHashSenha(b.senha),
      criadaEm: new Date(t).toISOString(), testeAte: new Date(t + DIAS_TESTE * DIA).toISOString(),
      aceiteEm: new Date(t).toISOString(), assinatura: { status: "nenhuma" }, suspensa: false,
    });
    banco.lojas.push(loja);
    banco.salvar();
    log.info?.(`[loja] cadastrada ${loja.slug}`);
    abrirSessao(req, res, "loja", loja.id);
    res.status(201).json(painelDe(loja));
  }));

  app.post("/api/painel/entrar", (req, res) => {
    const email = txt(req.body?.email, 120).toLowerCase();
    const chave = `${S.ipDe(req)}|${email}`;
    if (!limiteLogin.registrar(chave).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    const loja = banco.lojaPorEmail(email);
    const ok = S.conferirSenha(req.body?.senha, loja?.senhaHash ?? S.HASH_FALSO) && loja;
    if (!ok) return erro(res, 401, "E-mail ou senha incorretos.");
    limiteLogin.liberar(chave);
    abrirSessao(req, res, "loja", loja.id);
    res.json(painelDe(loja));
  });

  app.post("/api/painel/sair", (req, res) => { fecharSessao(req, res, "loja"); res.json({ ok: true }); });

  app.get("/api/painel/eu", exigirLoja, a(async (req, res) => {
    const loja = req.loja;
    // Volta do checkout do Mercado Pago: confere o status na hora em vez de esperar o webhook.
    if (req.query.atualizar && loja.assinatura?.preapprovalId && mp.configurado) {
      try {
        const pa = await mp.consultarPreapproval(loja.assinatura.preapprovalId);
        loja.assinatura = { ...loja.assinatura, status: statusDoMp(pa.status), atualizadaEm: iso() };
        banco.salvar();
      } catch (e) { log.warn?.(`[mp] consulta falhou: ${e.message}`); }
    }
    res.json(painelDe(loja));
  }));

  app.put("/api/painel/loja", exigirLoja, (req, res) => {
    const b = req.body ?? {};
    const nome = txt(b.nome, 60), zap = whatsapp(b.whatsapp), cidade = txt(b.cidade, 60);
    if (nome.length < 2) return erro(res, 400, "Informe o nome da loja.");
    if (!zap) return erro(res, 400, "Informe o WhatsApp com DDD.");
    if (!cidade) return erro(res, 400, "Informe a cidade.");
    const cor = /^#[0-9a-f]{6}$/i.test(b.cor ?? "") ? b.cor.toUpperCase() : req.loja.cor ?? null;
    Object.assign(req.loja, {
      nome, whatsapp: zap, cidade, cor, categoria: txt(b.categoria, 60),
      responsavel: txt(b.responsavel, 80) || req.loja.responsavel,
      sobre: b.sobre === undefined ? req.loja.sobre : String(b.sobre).trim().slice(0, 300),
    });
    banco.salvar();
    res.json(painelDe(req.loja));
  });

  // Logo da loja: um quadrado de 400px; trocar apaga o anterior.
  app.post("/api/painel/logo", exigirLoja, receberLogo, a(async (req, res) => {
    if (!req.files?.length) return erro(res, 400, "Escolha uma imagem para o logo.");
    const antigo = req.loja.logo;
    req.loja.logo = await salvarFoto(req.files[0].buffer, uploadsDir, { logo: true });
    banco.salvar();
    if (antigo) await apagarFoto(antigo, uploadsDir);
    res.json(painelDe(req.loja));
  }));
  app.delete("/api/painel/logo", exigirLoja, a(async (req, res) => {
    if (req.loja.logo) await apagarFoto(req.loja.logo, uploadsDir);
    req.loja.logo = null;
    banco.salvar();
    res.json(painelDe(req.loja));
  }));

  app.post("/api/painel/senha", exigirLoja, (req, res) => {
    if (!S.conferirSenha(req.body?.atual, req.loja.senhaHash)) return erro(res, 400, "A senha atual não confere.");
    if (String(req.body?.nova ?? "").length < 8) return erro(res, 400, "A nova senha precisa ter pelo menos 8 caracteres.");
    req.loja.senhaHash = S.gerarHashSenha(req.body.nova);
    banco.salvar();
    res.json({ ok: true });
  });

  const meuProduto = (req, res, next) => {
    const p = banco.produto(req.params.id);
    if (!p || p.lojaId !== req.loja.id) return erro(res, 404, "Produto não encontrado.");
    req.produto = p;
    next();
  };

  app.post("/api/painel/produtos", exigirLoja, receberFotos, a(async (req, res) => {
    const { p, erro: msg } = lerProduto(req.body ?? {});
    if (msg) return erro(res, 400, msg);
    if (!req.files?.length) return erro(res, 400, "Envie pelo menos uma foto.");
    if (banco.produtos.filter((x) => x.lojaId === req.loja.id).length >= MAX_PRODUTOS) return erro(res, 400, `Limite de ${MAX_PRODUTOS} produtos por loja.`);
    const fotos = [];
    for (const f of req.files) fotos.push(await salvarFoto(f.buffer, uploadsDir));
    const produto = { id: randomUUID(), lojaId: req.loja.id, ...p, fotos, ativo: true, bloqueado: false, criadoEm: iso() };
    banco.produtos.push(produto);
    banco.salvar();
    res.status(201).json(produto);
  }));

  app.put("/api/painel/produtos/:id", exigirLoja, meuProduto, receberFotos, a(async (req, res) => {
    const { p, erro: msg } = lerProduto(req.body ?? {});
    if (msg) return erro(res, 400, msg);
    let manter = [];
    try { manter = JSON.parse(req.body.manter ?? "[]"); } catch { /* ignora */ }
    manter = req.produto.fotos.filter((u) => manter.includes(u));
    if (manter.length + (req.files?.length ?? 0) > MAX_FOTOS) return erro(res, 400, `Use no máximo ${MAX_FOTOS} fotos.`);
    if (manter.length + (req.files?.length ?? 0) === 0) return erro(res, 400, "O produto precisa de pelo menos uma foto.");
    const novas = [];
    for (const f of req.files ?? []) novas.push(await salvarFoto(f.buffer, uploadsDir));
    for (const u of req.produto.fotos.filter((u) => !manter.includes(u))) await apagarFoto(u, uploadsDir);
    Object.assign(req.produto, p, { fotos: [...manter, ...novas], atualizadoEm: iso() });
    banco.salvar();
    res.json(req.produto);
  }));

  app.patch("/api/painel/produtos/:id", exigirLoja, meuProduto, (req, res) => {
    req.produto.ativo = Boolean(req.body?.ativo);
    banco.salvar();
    res.json(req.produto);
  });

  app.delete("/api/painel/produtos/:id", exigirLoja, meuProduto, a(async (req, res) => {
    for (const u of req.produto.fotos) await apagarFoto(u, uploadsDir);
    banco.d.produtos = banco.produtos.filter((p) => p !== req.produto);
    banco.salvar();
    res.json({ ok: true });
  }));

  // ---------- assinatura ----------
  app.post("/api/painel/assinar", exigirLoja, a(async (req, res) => {
    if (!mp.configurado) return erro(res, 503, "O pagamento ainda não está disponível. Fale com a CITshop.");
    const loja = req.loja;
    // Assinando durante o teste, a primeira cobrança só acontece quando o teste acaba.
    const inicio = Math.max(agora() + 5 * 60_000, Date.parse(loja.testeAte));
    const pa = await mp.criarPreapproval({
      referencia: loja.id, email: loja.email, motivo: "CITshop · Plano Loja", valor: PRECO_PLANO,
      inicio: new Date(inicio).toISOString(), retorno: `${urlPublica}/painel?assinatura=retorno`,
    });
    loja.assinatura = { status: "pendente", preapprovalId: pa.id, atualizadaEm: iso() };
    banco.salvar();
    res.json({ url: pa.initPoint });
  }));

  // O webhook só avisa que algo mudou; o status real é relido na API do Mercado Pago.
  app.post("/webhook/mercadopago", a(async (req, res) => {
    const dataId = String(req.query["data.id"] ?? req.body?.data?.id ?? "");
    if (env.MP_WEBHOOK_SECRET && !webhookValido({
      segredo: env.MP_WEBHOOK_SECRET, assinatura: req.headers["x-signature"], requestId: req.headers["x-request-id"], dataId,
    })) return res.status(401).json({ erro: "assinatura inválida" });
    const tipo = String(req.body?.type ?? req.query.type ?? "");
    if (tipo.includes("preapproval") && dataId && mp.configurado) {
      const pa = await mp.consultarPreapproval(dataId);
      const loja = banco.loja(pa.externalReference);
      if (loja) {
        loja.assinatura = { status: statusDoMp(pa.status), preapprovalId: pa.id, atualizadaEm: iso() };
        banco.salvar();
        log.info?.(`[mp] ${loja.slug}: ${pa.status}`);
      }
    }
    res.sendStatus(200);
  }));

  // ---------- administração ----------
  app.post("/api/admin/entrar", (req, res) => {
    if (!limiteLogin.registrar(`admin|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    if (!env.ADMIN_SENHA_HASH || !S.conferirSenha(req.body?.senha, env.ADMIN_SENHA_HASH)) return erro(res, 401, "Senha incorreta.");
    abrirSessao(req, res, "admin", "admin");
    res.json({ ok: true });
  });
  app.post("/api/admin/sair", (req, res) => { fecharSessao(req, res, "admin"); res.json({ ok: true }); });

  app.get("/api/admin/lojas", exigirAdmin, (req, res) => {
    const t = agora();
    res.json(banco.lojas.map(({ senhaHash, ...l }) => ({
      ...l, status: statusLoja(l, t),
      produtos: banco.produtos.filter((p) => p.lojaId === l.id).map((p) => ({ id: p.id, nome: p.nome, preco: p.preco, foto: p.fotos[0], ativo: p.ativo, bloqueado: p.bloqueado })),
    })));
  });

  const lojaAdmin = (req, res, next) => (req.loja = banco.loja(req.params.id)) ? next() : erro(res, 404, "Loja não encontrada.");
  app.post("/api/admin/lojas/:id/suspensa", exigirAdmin, lojaAdmin, (req, res) => {
    req.loja.suspensa = Boolean(req.body?.suspensa);
    banco.salvar();
    res.json({ ok: true });
  });
  app.post("/api/admin/lojas/:id/senha", exigirAdmin, lojaAdmin, (req, res) => {
    const senha = randomBytes(6).toString("base64url");
    req.loja.senhaHash = S.gerarHashSenha(senha);
    banco.salvar();
    res.json({ senha });
  });
  // Exclusão a pedido da loja (prometida nos termos): some a loja, os produtos e as fotos.
  app.delete("/api/admin/lojas/:id", exigirAdmin, lojaAdmin, a(async (req, res) => {
    const dela = banco.produtos.filter((p) => p.lojaId === req.loja.id);
    for (const p of dela) for (const u of p.fotos) await apagarFoto(u, uploadsDir);
    if (req.loja.logo) await apagarFoto(req.loja.logo, uploadsDir);
    banco.d.produtos = banco.produtos.filter((p) => p.lojaId !== req.loja.id);
    banco.d.lojas = banco.lojas.filter((l) => l !== req.loja);
    banco.salvar();
    log.info?.(`[loja] excluída ${req.loja.slug}`);
    res.json({ ok: true });
  }));
  app.post("/api/admin/produtos/:id/bloqueado", exigirAdmin, (req, res) => {
    const p = banco.produto(req.params.id);
    if (!p) return erro(res, 404, "Produto não encontrado.");
    p.bloqueado = Boolean(req.body?.bloqueado);
    banco.salvar();
    res.json({ ok: true });
  });

  // ---------- páginas ----------
  const semCache = (res) => res.setHeader("Cache-Control", "no-cache");
  app.use(express.static(publico, { extensions: ["html"], setHeaders: semCache }));
  app.get("/loja/:slug", (req, res) => { semCache(res); res.sendFile(join(publico, "index.html")); });
  app.use("/api", (req, res) => erro(res, 404, "Rota não encontrada."));
  app.use((req, res) => res.status(404).sendFile(join(publico, "404.html")));
  app.use((err, req, res, _next) => {
    if (err.type === "entity.parse.failed") return erro(res, 400, "Dados inválidos.");
    if (err.status === 404) return erro(res, 404, "Não encontrado."); // ex.: foto apagada em /uploads
    if (err.status >= 400 && err.status < 500) return erro(res, err.status, err.message);
    log.error?.(`[erro] ${req.method} ${req.path}: ${err.stack ?? err.message}`);
    erro(res, 500, "Algo deu errado do nosso lado. Tente de novo.");
  });

  return { app, banco, dadosDir };
}
