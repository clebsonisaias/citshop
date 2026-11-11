/**
 * CITshop: vitrine pública (afiliados + lojas locais), painel das lojas,
 * assinatura Mercado Pago e administração. `criarApp` recebe env e relógio
 * para os testes rodarem com pasta temporária e tempo controlado.
 */
import express from "express";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as S from "./seguranca.js";
import { Banco, DEPTS, DIAS_TESTE, lojaVisivel, ordenarVitrine, slugUnico, statusLoja } from "./dados.js";
import { MAX_FOTOS, apagarFoto, receberFotos, receberLogo, salvarFoto } from "./uploads.js";
import { criarMercadoPago, statusDoMp, webhookValido } from "./mercadopago.js";
import { MARKETPLACE, criarClienteAmazon } from "./amazon.js";
import { atualizarAfiliados } from "./afiliados.js";
import { MonitoramentoMotor } from "./tarefas/monitoramento.js";
import { AgendadorOfertas } from "./tarefas/agendador.js";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PRECO_PLANO = 49.9;
const DIA = 86_400_000;
const MAX_PRODUTOS = 200;
const ENTREGAS = ["retirada", "entrega", "ambos"];
const DISPONIBILIDADES = ["disponivel", "sob-encomenda", "consulte"];

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
    disponibilidade: DISPONIBILIDADES.includes(b.disponibilidade) ? b.disponibilidade : "consulte",
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
  const monitoramentoMotor = new MonitoramentoMotor({ dadosDir, log });
  const agendadorOfertas = new AgendadorOfertas({ dadosDir, manualPath: join(RAIZ, "manual.json"), log });
  const mp = criarMercadoPago({ token: env.MP_ACCESS_TOKEN, fetchImpl });
  const limiteLogin = new S.Limitador({ maximo: 8, janelaMs: 10 * 60_000 });
  const limiteCadastro = new S.Limitador({ maximo: 5, janelaMs: 60 * 60_000 });
  const iso = () => new Date(agora()).toISOString();

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => { S.aplicarCabecalhos(req, res); next(); });
  app.use("/uploads", express.static(uploadsDir, { index: false, fallthrough: false, immutable: true, maxAge: "30d" }));
  // Robô de coleta (tarefa agendada do Claude): recebe as ofertas de afiliados já prontas,
  // grava coleta.json no volume e refaz afiliados.json na hora. Protegido por ROBO_TOKEN.
  const roboToken = Buffer.from(String(env.ROBO_TOKEN ?? ""));
  const LOJAS_AF = new Set(["shopee", "amazon", "ml"]);
  const HOSTS_AF = /^https:\/\/([a-z0-9-]+\.)*(shopee\.com\.br|susercontent\.com|amazon\.com\.br|media-amazon\.com|ssl-images-amazon\.com|mercadolivre\.com|mercadolivre\.com\.br|mlstatic\.com)\//;
  app.post("/api/robo/afiliados", express.json({ limit: "2mb" }), async (req, res) => {
    try {
      const t = Buffer.from(String(req.get("x-robo-token") ?? ""));
      if (roboToken.length < 32 || t.length !== roboToken.length || !timingSafeEqual(t, roboToken)) return res.status(401).json({ erro: "Token inválido." });
      const lista = Array.isArray(req.body?.produtos) ? req.body.produtos.slice(0, 1000) : [];
      const produtos = [];
      const vistos = new Set();
      for (const b of lista) {
        if (!b || typeof b !== "object") continue;
        const n = Number(b.nota), v = Number(b.vendidos);
        const p = {
          id: txt(b.id, 60), nome: txt(b.nome, 160), loja: String(b.loja ?? ""),
          categoria: DEPTS.includes(b.categoria) ? b.categoria : "casa",
          preco: valor(b.preco), precoAntigo: b.precoAntigo ? valor(b.precoAntigo) : null,
          nota: n > 0 && n <= 5 ? n : 0, vendidos: Number.isFinite(v) && v > 0 ? Math.round(v) : 0,
          imagem: HOSTS_AF.test(String(b.imagem ?? "")) ? String(b.imagem) : null, link: String(b.link ?? ""),
        };
        if (/^[A-Z0-9]{10}$/.test(String(b.asin ?? ""))) p.asin = String(b.asin);
        if (!/^(shopee|amazon|ml)-[A-Za-z0-9_-]+$/.test(p.id) || vistos.has(p.id) || !LOJAS_AF.has(p.loja) || p.nome.length < 3 || !p.preco || !HOSTS_AF.test(p.link)) continue;
        if (p.precoAntigo && p.precoAntigo <= p.preco) p.precoAntigo = null;
        if (b.destaque === true) p.destaque = true;
        vistos.add(p.id);
        produtos.push(p);
      }
      if (produtos.length < 10) return res.status(400).json({ erro: "Lista muito pequena; nada foi alterado.", validos: produtos.length });
      const arq = join(dadosDir, "coleta.json");
      writeFileSync(arq + ".tmp", JSON.stringify({ atualizadoEm: iso(), produtos }));
      renameSync(arq + ".tmp", arq);
      const r = await atualizarAfiliados({ env, dadosDir, manual: join(RAIZ, "manual.json") });
      res.json({ ok: true, recebidos: lista.length, validos: produtos.length, ...r });
    } catch (e) {
      log.error("[robo] " + e.message);
      res.status(500).json({ erro: "Falha ao gravar a coleta." });
    }
  });
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
  // Lê o JSON só quando o arquivo muda (o robô grava com rename, que troca a data de modificação).
  const cacheArquivos = new Map();
  function ler(arquivo, padrao) {
    const caminho = join(dadosDir, arquivo);
    try {
      const { mtimeMs } = statSync(caminho);
      const c = cacheArquivos.get(caminho);
      if (c?.mtimeMs === mtimeMs) return c.dados;
      const dados = JSON.parse(readFileSync(caminho, "utf8"));
      cacheArquivos.set(caminho, { mtimeMs, dados });
      return dados;
    } catch {
      return padrao;
    }
  }
  // A Creators API só permite guardar oferta por 1 hora: passado isso, a Amazon da API some da vitrine
  // (a lista manual continua) em vez de mostrar preço vencido. Quando o ASIN se repete, vale o dado da API.
  const IDADE_MAXIMA_AMAZON = 60 * 60_000;
  function afiliados() {
    const af = ler("afiliados.json", { produtos: [] });
    const amz = ler("amazon.json", { produtos: [] });
    const frescos = amz.atualizadoEm && agora() - Date.parse(amz.atualizadoEm) <= IDADE_MAXIMA_AMAZON ? amz.produtos : [];
    const ids = new Set(frescos.map((p) => p.id));
    return { atualizadoEm: af.atualizadoEm, produtos: [...frescos, ...af.produtos.filter((p) => !ids.has(p.id))] };
  }
  const lojaPublica = (l) => ({
    slug: l.slug, nome: l.nome, cidade: l.cidade, categoria: l.categoria, whatsapp: l.whatsapp, desde: l.criadaEm,
    logo: l.logo ?? null, cor: l.cor ?? null, sobre: l.sobre ?? "", entrega: l.entrega ?? null,
    horario: l.horario ?? "", bairrosAtendidos: l.bairrosAtendidos ?? "", prazoEntrega: l.prazoEntrega ?? "",
  });
  const produtoLocal = (p, l) => ({
    id: `l-${p.id}`, nome: p.nome, descricao: p.descricao, dept: p.dept, loja: "local",
    lojaSlug: l.slug, lojaNome: l.nome, lojaLogo: l.logo ?? null, cidade: l.cidade, whatsapp: l.whatsapp,
    preco: p.preco, precoAntigo: p.precoAntigo, fotos: p.fotos, nota: 0, vendidos: 0, entrega: l.entrega ?? null,
    disponibilidade: p.disponibilidade ?? "consulte", horario: l.horario ?? "",
    bairrosAtendidos: l.bairrosAtendidos ?? "", prazoEntrega: l.prazoEntrega ?? "",
  });
  const produtoAfiliado = (x) => ({
    id: x.id, nome: x.nome, dept: DEPTS.includes(x.categoria) ? x.categoria : "casa", loja: x.loja,
    preco: x.preco, precoAntigo: x.precoAntigo, nota: x.nota ?? 0, vendidos: x.vendidos ?? 0,
    fotos: x.imagem ? [x.imagem] : [], link: x.link, queda: x.queda, atualizadoEm: x.atualizadoEm ?? null,
    destaque: x.destaque === true, menor30: x.menor30 === true, fixo: x.fixo === true, sub: x.sub ?? null,
    descricao: x.descricao ?? "", // destaques do produto, quando a API oficial manda
  });

  // A vitrine pública inteira; usada pela API e pela página de produto (/p/:id).
  function vitrine() {
    const t = agora();
    const visiveis = new Map(banco.lojas.filter((l) => lojaVisivel(l, t)).map((l) => [l.id, l]));
    const locais = banco.produtos
      .filter((p) => p.ativo && !p.bloqueado && visiveis.has(p.lojaId))
      .sort((x, y) => y.criadoEm.localeCompare(x.criadoEm))
      .map((p) => produtoLocal(p, visiveis.get(p.lojaId)));
    const af = afiliados();
    return {
      atualizadoEm: af.atualizadoEm ?? null,
      lojas: [...visiveis.values()].map(lojaPublica),
      produtos: ordenarVitrine([...locais, ...af.produtos.map(produtoAfiliado)]),
    };
  }
  app.get("/api/vitrine", (req, res) => res.set("Cache-Control", "no-cache").json(vitrine()));
  // Um produto só, com as mesmas regras de visibilidade da vitrine, sem montar o catálogo inteiro.
  function produtoPorId(id) {
    if (id.startsWith("l-")) {
      const p = banco.produto(id.slice(2));
      const l = p && banco.loja(p.lojaId);
      return p && l && p.ativo && !p.bloqueado && lojaVisivel(l, agora()) ? produtoLocal(p, l) : null;
    }
    const x = afiliados().produtos.find((y) => y.id === id);
    return x ? produtoAfiliado(x) : null;
  }

  // Conta o redirecionamento ao WhatsApp sem persistir IP ou identidade do visitante.
  app.get("/contato/:id", (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x || x.loja !== "local") return res.status(404).sendFile(join(publico, "404.html"));
    banco.registrarCliqueContato(`produto:${req.params.id.slice(2)}`, iso());
    const pagina = `${urlPublica}/p/${encodeURIComponent(req.params.id)}`;
    const mensagem = `Olá! Vi na CITshop e tenho interesse: ${x.nome} por ${x.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. ${pagina}`;
    const destino = `https://wa.me/${encodeURIComponent(x.whatsapp)}?text=${encodeURIComponent(mensagem)}`;
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex, nofollow").redirect(302, destino);
  });
  app.get("/contato/loja/:slug", (req, res) => {
    const loja = banco.lojas.find((l) => l.slug === req.params.slug && lojaVisivel(l, agora()));
    if (!loja) return res.status(404).sendFile(join(publico, "404.html"));
    banco.registrarCliqueContato(`loja:${loja.id}`, iso());
    const pagina = `${urlPublica}/loja/${encodeURIComponent(loja.slug)}`;
    const mensagem = `Olá! Encontrei sua loja na CITshop. ${pagina}`;
    const destino = `https://wa.me/${encodeURIComponent(loja.whatsapp)}?text=${encodeURIComponent(mensagem)}`;
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex, nofollow").redirect(302, destino);
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
      cliquesContatoLoja: banco.cliquesContato(`loja:${loja.id}`),
      produtos: banco.produtos.filter((p) => p.lojaId === loja.id).map((p) => ({
        ...p, disponibilidade: p.disponibilidade ?? "consulte",
        cliquesContato: banco.cliquesContato(`produto:${p.id}`),
      })),
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
      horario: b.horario === undefined ? req.loja.horario ?? "" : txt(b.horario, 120),
      bairrosAtendidos: b.bairrosAtendidos === undefined ? req.loja.bairrosAtendidos ?? "" : txt(b.bairrosAtendidos, 300),
      prazoEntrega: b.prazoEntrega === undefined ? req.loja.prazoEntrega ?? "" : txt(b.prazoEntrega, 120),
      // Sem o campo (ex.: formulário de aparência), mantém o que já estava.
      entrega: b.entrega === undefined ? req.loja.entrega ?? null : ENTREGAS.includes(b.entrega) ? b.entrega : null,
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

  // Relê no MP o status de toda assinatura conhecida. Roda a cada 6h (servidor.js) e cobre o caso
  // de o token ser compartilhado com outro sistema cujo webhook não aponta para cá.
  async function sincronizarAssinaturas() {
    if (!mp.configurado) return 0;
    let mudou = 0;
    for (const loja of banco.lojas.filter((l) => l.assinatura?.preapprovalId)) {
      try {
        const status = statusDoMp((await mp.consultarPreapproval(loja.assinatura.preapprovalId)).status);
        if (status !== loja.assinatura.status) { loja.assinatura = { ...loja.assinatura, status, atualizadaEm: iso() }; mudou++; }
      } catch (e) { log.warn?.(`[mp] ${loja.slug}: ${e.message}`); }
    }
    if (mudou) banco.salvar();
    return mudou;
  }

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
  // Senha do admin: a trocada no /admin, enquanto o ADMIN_SENHA_HASH do Coolify for o mesmo de quando ela foi
  // trocada. Mudar o hash no Coolify (esqueci a senha) volta a valer a do Coolify.
  const hashAdmin = () => (banco.d.admin && banco.d.admin.base === (env.ADMIN_SENHA_HASH ?? null) ? banco.d.admin.hash : env.ADMIN_SENHA_HASH);
  app.post("/api/admin/entrar", (req, res) => {
    if (!limiteLogin.registrar(`admin|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    const hash = hashAdmin();
    if (!hash || !S.conferirSenha(req.body?.senha, hash)) return erro(res, 401, "Senha incorreta.");
    abrirSessao(req, res, "admin", "admin");
    res.json({ ok: true });
  });
  app.post("/api/admin/senha", exigirAdmin, (req, res) => {
    if (!limiteLogin.registrar(`admin|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    if (!S.conferirSenha(req.body?.atual, hashAdmin())) return erro(res, 400, "A senha atual não confere.");
    if (String(req.body?.nova ?? "").length < 8) return erro(res, 400, "A nova senha precisa ter pelo menos 8 caracteres.");
    banco.d.admin = { hash: S.gerarHashSenha(req.body.nova), base: env.ADMIN_SENHA_HASH ?? null, trocadaEm: iso() };
    banco.salvar();
    res.json({ ok: true });
  });
  app.post("/api/admin/sair", (req, res) => { fecharSessao(req, res, "admin"); res.json({ ok: true }); });

  app.get("/api/admin/lojas", exigirAdmin, (req, res) => {
    const t = agora();
    res.json(banco.lojas.map(({ senhaHash, ...l }) => ({
      ...l, status: statusLoja(l, t),
      cliquesContatoLoja: banco.cliquesContato(`loja:${l.id}`),
      produtos: banco.produtos.filter((p) => p.lojaId === l.id).map((p) => ({
        id: p.id, nome: p.nome, preco: p.preco, foto: p.fotos[0], ativo: p.ativo, bloqueado: p.bloqueado,
        disponibilidade: p.disponibilidade ?? "consulte", cliquesContato: banco.cliquesContato(`produto:${p.id}`),
      })),
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

  // ---------- Amazon Afiliados (admin) ----------
  // As credenciais ficam só no ambiente do servidor; o admin vê se estão configuradas, nunca os valores.
  const amazonConfigurada = () => Boolean(env.AMAZON_CREDENCIAL_ID && env.AMAZON_CREDENCIAL_SEGREDO && env.AMAZON_PARTNER_TAG);
  const clienteAmazon = () => criarClienteAmazon({
    credencialId: env.AMAZON_CREDENCIAL_ID, credencialSegredo: env.AMAZON_CREDENCIAL_SEGREDO,
    versao: env.AMAZON_CREDENCIAL_VERSAO ?? "3.1", parceiro: env.AMAZON_PARTNER_TAG, fetchImpl,
  });
  app.get("/api/admin/coleta", exigirAdmin, (req, res) => {
    let st = {};
    try { st = JSON.parse(readFileSync(join(dadosDir, "coleta-status.json"), "utf8")); } catch { /* ainda não rodou */ }
    res.json({ shopeeCookie: Boolean(env.SHOPEE_COOKIE), ...st });
  });
  app.get("/api/admin/amazon", exigirAdmin, (req, res) => {
    let st = {};
    try { st = JSON.parse(readFileSync(join(dadosDir, "amazon-status.json"), "utf8")); } catch { /* ainda não rodou */ }
    res.json({
      configurada: amazonConfigurada(), marketplace: MARKETPLACE, parceiro: env.AMAZON_PARTNER_TAG ?? null,
      versao: env.AMAZON_CREDENCIAL_VERSAO ?? "3.1",
      ultimaSincronizacao: st.ultimaTentativa ?? null, ok: st.ok ?? null, erro: st.erro ?? null, total: st.total ?? 0,
    });
  });
  app.post("/api/admin/amazon/testar", exigirAdmin, a(async (req, res) => {
    if (!amazonConfigurada()) return erro(res, 400, "Configure AMAZON_CREDENCIAL_ID, AMAZON_CREDENCIAL_SEGREDO e AMAZON_PARTNER_TAG no Coolify.");
    const asin = String(req.body?.asin ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return erro(res, 400, "Informe um ASIN de 10 caracteres.");
    try {
      const [item] = await clienteAmazon().buscarAsins([asin]);
      if (!item) return res.json({ ok: false, mensagem: "A Amazon não devolveu esse produto." });
      res.json({ ok: true, titulo: item.itemInfo?.title?.displayValue ?? null, preco: item.offersV2?.listings?.[0]?.price?.money?.displayAmount ?? null });
    } catch (e) {
      res.json({ ok: false, mensagem: e.message });
    }
  }));

  // ---------- Central de Ofertas (admin) ----------
  app.get("/api/admin/central-ofertas", exigirAdmin, a(async (req, res) => {
    const st = await monitoramentoMotor.obterStatus();
    const af = ler("afiliados.json", { produtos: [] });
    res.json({
      ...st,
      produtosPublicados: af.produtos || [],
    });
  }));

  app.put("/api/admin/central-ofertas/config", exigirAdmin, express.json(), a(async (req, res) => {
    const salva = await monitoramentoMotor.salvarConfiguracao(req.body || {});
    res.json({ ok: true, configuracao: salva });
  }));

  app.post("/api/admin/central-ofertas/executar", exigirAdmin, express.json(), a(async (req, res) => {
    const marketplace = req.body?.marketplace || null;
    const resultado = await agendadorOfertas.executarRodada({ marketplace });
    res.json({ ok: true, resultado });
  }));

  // Rastreamento de clique / redirecionamento de afiliados
  app.get("/afiliado/:id", (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x || x.loja === "local" || !x.link) {
      return res.status(404).sendFile(join(publico, "404.html"));
    }
    monitoramentoMotor.registrarClique(x.id, x.loja).catch(() => {});
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex, nofollow").redirect(302, x.link);
  });

  // ---------- páginas ----------
  const semCache = (res) => res.setHeader("Cache-Control", "no-cache");
  app.use(express.static(publico, { extensions: ["html"], setHeaders: semCache }));
  app.get("/loja/:slug", (req, res) => { semCache(res); res.sendFile(join(publico, "index.html")); });
  app.get("/black-friday", (req, res) => { semCache(res); res.sendFile(join(publico, "index.html")); });

  // Página de produto renderizada no servidor: conteúdo, metadados e JSON-LD chegam no HTML inicial.
  const PAGINA_PRODUTO = readFileSync(join(publico, "produto.html"), "utf8");
  const NOME_LOJA = { amazon: "Amazon", shopee: "Shopee", ml: "Mercado Livre" };
  const attr = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function metaProduto(x) {
    const titulo = `${x.nome} · CITshop`;
    const desc = x.loja === "local"
      ? `${x.lojaNome}, ${x.cidade}. Produto disponível na CITshop; consulte a loja pelo WhatsApp.`
      : `Oferta na ${NOME_LOJA[x.loja] ?? "loja parceira"}, achada pela CITshop.`;
    const foto = x.fotos?.[0];
    const imagem = !foto ? null : foto.startsWith("/uploads/") ? `${urlPublica}/og/${basename(foto, ".webp")}.jpg` : foto;
    const canonical = `${urlPublica}/p/${encodeURIComponent(x.id)}`;
    const preco = Number(x.preco).toFixed(2);
    const local = x.loja === "local";
    const destino = local ? `/contato/${encodeURIComponent(x.id)}` : x.link;
    const infoLocal = local
      ? ` · ${attr(x.cidade)}${x.entrega ? ` · ${attr(x.entrega === "ambos" ? "Entrega ou retirada" : x.entrega === "entrega" ? "Entrega" : "Retirada na loja")}` : ""}`
      : "";
    const avaliacao = x.nota
      ? `<p class="product-rating"><strong>★ ${attr(Number(x.nota).toFixed(1).replace(".", ","))}</strong>${x.vendidos ? ` · ${Number(x.vendidos).toLocaleString("pt-BR")} vendidos` : ""}</p>`
      : "";
    const disponibilidade = x.disponibilidade ?? "consulte";
    const localDetalhes = local ? [
      x.horario && `Horário: ${x.horario}`,
      x.bairrosAtendidos && `Bairros atendidos: ${x.bairrosAtendidos}`,
      x.prazoEntrega && `Prazo de entrega informado: ${x.prazoEntrega}`,
    ].filter(Boolean).map(attr).join(" · ") : "";
    const descricao = String(x.descricao ?? "").trim();
    const imagemHtml = imagem
      ? `<img src="${attr(imagem)}" alt="${attr(x.nome)}" width="720" height="720" fetchpriority="high">`
      : `<div class="product-no-image" aria-label="Produto sem foto">CITshop</div>`;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: x.nome,
      description: descricao || desc,
      category: x.dept,
      ...(imagem ? { image: imagem } : {}),
      offers: {
        "@type": "Offer",
        url: canonical,
        priceCurrency: "BRL",
        price: preco,
        seller: { "@type": "Organization", name: local ? x.lojaNome : NOME_LOJA[x.loja] ?? "Loja parceira" },
      },
    };
    const substituir = {
      TITULO: attr(titulo), DESCRICAO_META: attr(desc), CANONICAL: attr(canonical), PRECO_DADOS: preco,
      OG_IMAGE: imagem ? `<meta property="og:image" content="${attr(imagem)}">` : "",
      CATEGORIA: attr(x.dept), NOME: attr(x.nome), VENDEDOR: attr(local ? x.lojaNome : NOME_LOJA[x.loja] ?? "Loja parceira"),
      LOCAL_INFO: infoLocal, AVALIACAO: avaliacao, DESCRICAO: descricao ? `<p class="product-highlights">${attr(descricao)}</p>` : "",
      DISPONIBILIDADE: local ? `<p class="product-availability">${attr(({ disponivel: "Disponível, conforme informado pela loja", "sob-encomenda": "Sob encomenda", consulte: "Consulte a disponibilidade com a loja" })[disponibilidade] ?? "Consulte a disponibilidade com a loja")}</p>` : "",
      LOCAL_DETALHES: localDetalhes ? `<p class="product-local-details">${localDetalhes}</p>` : "",
      IMAGEM: imagemHtml, PRECO_ANTIGO: x.precoAntigo > x.preco ? `<del>${attr(x.precoAntigo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))}</del>` : "",
      PRECO: attr(x.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })),
      DESCONTO: x.precoAntigo > x.preco ? `<span class="pct">${Math.round((1 - x.preco / x.precoAntigo) * 100)}% OFF</span>` : "",
      LINK_COMPRA: attr(destino), ALVO_COMPRA: local ? "_self" : "_blank",
      REL_COMPRA: local ? "" : "sponsored nofollow noopener",
      TEXTO_COMPRA: local ? "Pedir pelo WhatsApp da loja ↗" : `Comprar na ${NOME_LOJA[x.loja] ?? "loja parceira"} ↗`,
      AVISO_COMPRA: local
        ? `Vendido por ${attr(x.lojaNome)}, em ${attr(x.cidade)}. Combine pagamento, disponibilidade e entrega diretamente com a loja.`
        : `Você finaliza a compra no site da loja. Preço e frete são confirmados lá${x.atualizadoEm ? `; preço consultado em ${attr(new Date(x.atualizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}` : ""}.`,
      COMPARTILHAR: encodeURIComponent(`${x.nome} · ${canonical}`),
      DESCRICAO_LONGA: attr(descricao || "Consulte as informações e a disponibilidade com o vendedor."),
      AVISO_AFILIADO: local
        ? "Produtos de lojas locais são vendidos e entregues pela própria loja."
        : "O CITshop pode receber comissão por compras feitas pelos links de afiliado, sem custo adicional para você. Preço e estoque podem mudar.",
    };
    const html = PAGINA_PRODUTO.replace(/<!--meta-->|<!--\/meta-->/g, "")
      .replace("<!--structured-->", `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/[<>&\u2028\u2029]/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" })[c])}</script>`);
    return html.replace(/\{\{([A-Z_]+)\}\}/g, (_match, chave) => substituir[chave] ?? "");
  }
  app.get("/p/:id", (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x) return res.status(404).sendFile(join(publico, "404.html"));
    semCache(res);
    res.type("html").send(metaProduto(x));
  });
  // A prévia do WhatsApp não lê WebP com segurança: a foto vira JPEG 1200x630 uma vez só, gravado ao lado
  // da original (og-<uuid>.jpg). apagarFoto remove os dois.
  app.get("/og/:arquivo", a(async (req, res) => {
    const m = /^([0-9a-f-]{36})\.jpg$/.exec(req.params.arquivo);
    if (!m) return res.status(404).end();
    const jpg = join(uploadsDir, `og-${m[1]}.jpg`);
    try {
      if (!existsSync(jpg)) {
        const tmp = `${jpg}.${randomUUID()}.tmp`; // nome único: dois pedidos ao mesmo tempo não se atropelam
        await sharp(join(uploadsDir, `${m[1]}.webp`))
          .resize(1200, 630, { fit: "contain", background: "#FFFFFF" }).jpeg({ quality: 82 }).toFile(tmp);
        renameSync(tmp, jpg);
      }
      res.set("Cache-Control", "public, max-age=86400").sendFile(jpg);
    } catch {
      res.status(404).end();
    }
  }));
  app.use("/api", (req, res) => erro(res, 404, "Rota não encontrada."));
  app.use((req, res) => res.status(404).sendFile(join(publico, "404.html")));
  app.use((err, req, res, _next) => {
    if (err.type === "entity.parse.failed") return erro(res, 400, "Dados inválidos.");
    if (err.status === 404) return erro(res, 404, "Não encontrado."); // ex.: foto apagada em /uploads
    if (err.status >= 400 && err.status < 500) return erro(res, err.status, err.message);
    log.error?.(`[erro] ${req.method} ${req.path}: ${err.stack ?? err.message}`);
    erro(res, 500, "Algo deu errado do nosso lado. Tente de novo.");
  });

  return { app, banco, dadosDir, sincronizarAssinaturas, monitoramentoMotor, agendadorOfertas };
}
