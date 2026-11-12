/**
 * CIT Shopping: vitrine pública (afiliados + lojas locais), painel das lojas,
 * assinatura Mercado Pago e administração. `criarApp` recebe env e relógio
 * para os testes rodarem com pasta temporária e tempo controlado.
 */
import express from "express";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as S from "./seguranca.js";
import { Banco, DEPTS, DIAS_TESTE, lojaVisivel, ordenarVitrine, slugUnico, statusLoja, temEstoque } from "./dados.js";
import { MAX_FOTOS, apagarFoto, receberFotos, receberLogo, salvarFoto } from "./uploads.js";
import { cifrar, criarMercadoPago, decifrar, statusDoMp, webhookValido } from "./mercadopago.js";
import { MARKETPLACE, criarClienteAmazon } from "./amazon.js";
import { atualizarAfiliados } from "./afiliados.js";
import { MonitoramentoMotor } from "./tarefas/monitoramento.js";
import { AgendadorOfertas } from "./tarefas/agendador.js";
import { ConectorWaha } from "./integracoes/whatsapp/waha.js";
import { RadarOfertas } from "./motor-ofertas/radar.js";
import { ConectorInstagram } from "./integracoes/instagram/conector.js";
import { GeradorCardInstagram } from "./integracoes/instagram/gerador-card.js";
import { aplicarCatalogo } from "./catalogo-loja.js";
import { campanhaAtual, proximaCampanha } from "./campanha.js";
import { ConectorTelegram } from "./integracoes/telegram/conector.js";

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
// Estoque: vazio = sem contagem; senão um inteiro de 0 a 99999.
function estoqueDe(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 99999) : null;
}
function lerProduto(b) {
  const p = {
    esgotado: String(b.esgotado) === "true",
    estoque: estoqueDe(b.estoque),
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
  const conectorWaha = new ConectorWaha({
    apiUrl: env.WAHA_API_URL || "http://waha:3000",
    session: env.WAHA_SESSION || "default",
    apiKey: env.WAHA_API_KEY || null,
    fetchImpl,
  });
  const conectorInstagram = new ConectorInstagram({
    accountId: env.INSTAGRAM_ACCOUNT_ID,
    accessToken: env.INSTAGRAM_ACCESS_TOKEN,
    pageAccessToken: env.INSTAGRAM_PAGE_ACCESS_TOKEN,
    // Post do Feed -> produto, para o QUERO responder com o link do produto certo.
    aoPublicar: ({ mediaId, produtoId }) => {
      banco.d.instagramPosts ??= {};
      banco.d.instagramPosts[mediaId] = { produtoId, em: new Date(agora()).toISOString() };
      banco.salvar();
    },
    fetchImpl,
  });
  const conectorTelegram = new ConectorTelegram({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    fetchImpl,
  });
  const radarOfertas = new RadarOfertas({
    dadosDir,
    waha: conectorWaha,
    instagram: conectorInstagram,
    telegram: conectorTelegram,
    urlPublica,
  });
  agendadorOfertas.radar = radarOfertas;

  // Carrega credenciais salvas em motor-config.json no volume persistente
  monitoramentoMotor.obterConfiguracao().then((cfg) => {
    if (cfg?.instagram?.accountId && !conectorInstagram.accountId) conectorInstagram.accountId = cfg.instagram.accountId;
    if (cfg?.instagram?.accessToken && !conectorInstagram.accessToken) conectorInstagram.accessToken = cfg.instagram.accessToken;
    if (cfg?.instagram?.pageAccessToken && !conectorInstagram.pageAccessToken) conectorInstagram.pageAccessToken = cfg.instagram.pageAccessToken;
    if (cfg?.telegram?.botToken && !conectorTelegram.botToken) conectorTelegram.botToken = cfg.telegram.botToken;
    if (cfg?.telegram?.chatId && !conectorTelegram.chatId) conectorTelegram.chatId = cfg.telegram.chatId;
  }).catch(() => {});
  const geradorCardInstagram = new GeradorCardInstagram({ publicoDir: publico, dadosDir, fetchImpl });
  const mp = criarMercadoPago({ token: env.MP_ACCESS_TOKEN, clientId: env.MP_CLIENT_ID, clientSecret: env.MP_CLIENT_SECRET, fetchImpl });
  const limitePagamento = new S.Limitador({ maximo: 10, janelaMs: 10 * 60_000 });
  const limiteLogin = new S.Limitador({ maximo: 8, janelaMs: 10 * 60_000 });
  const limiteCadastro = new S.Limitador({ maximo: 5, janelaMs: 60 * 60_000 });
  const iso = () => new Date(agora()).toISOString();
  // Catálogo da Mimos da Delly versionado no repo (aplicado uma vez por versão).
  aplicarCatalogo(banco, JSON.parse(readFileSync(join(RAIZ, "servidor", "catalogos", "mimosdadelly.json"), "utf8")), iso());

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => { S.aplicarCabecalhos(req, res); next(); });
  app.use("/uploads", express.static(uploadsDir, { index: false, fallthrough: false, immutable: true, maxAge: "30d" }));
  // Robô de coleta (tarefa agendada do Claude): recebe as ofertas de afiliados já prontas,
  // grava coleta.json no volume e refaz afiliados.json na hora. Protegido por ROBO_TOKEN.
  const roboToken = Buffer.from(String(env.ROBO_TOKEN ?? ""));
  const LOJAS_AF = new Set(["shopee", "amazon", "ml", "mercado-livre", "shein"]);
  const HOSTS_AF = /^https:\/\/([a-z0-9-]+\.)*(shopee\.com\.br|susercontent\.com|amazon\.com\.br|media-amazon\.com|ssl-images-amazon\.com|mercadolivre\.com|mercadolivre\.com\.br|mlstatic\.com|shein\.com|shein\.top|ltwebstatic\.com)\//;
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
        if (!/^(shopee|amazon|ml|shein)-[A-Za-z0-9_-]+$/.test(p.id) || vistos.has(p.id) || !LOJAS_AF.has(p.loja) || p.nome.length < 3 || !p.preco || !HOSTS_AF.test(p.link)) continue;
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
  // Guarda o corpo cru: a assinatura do webhook da Meta (X-Hub-Signature-256) é calculada sobre ele.
  app.use(express.json({ limit: "50kb", verify: (req, _res, buf) => { req.corpoBruto = buf; } }));
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
    const amazonDesativada = process.env.AMAZON_DESATIVADA === "true" || process.env.DESATIVAR_AMAZON === "true";
    if (amazonDesativada) {
      const semAmazon = (af.produtos || []).filter((p) => (p.loja || p.marketplace) !== "amazon" && !p.id?.startsWith("amazon-"));
      return { atualizadoEm: af.atualizadoEm, produtos: semAmazon };
    }
    const amz = ler("amazon.json", { produtos: [] });
    const frescos = amz.atualizadoEm && agora() - Date.parse(amz.atualizadoEm) <= IDADE_MAXIMA_AMAZON ? amz.produtos : [];
    const ids = new Set(frescos.map((p) => p.id));
    return { atualizadoEm: af.atualizadoEm, produtos: [...frescos, ...af.produtos.filter((p) => !ids.has(p.id))] };
  }
  // Loja que paga por venda (comissão) vende só pelo Mercado Pago, para a comissão da CIT cair em toda venda:
  // sem pedido pelo WhatsApp e sem o número dela no site.
  const soPeloSite = (l) => l.modeloCobranca === "comissao_fixa";
  const lojaPublica = (l) => ({
    slug: l.slug, nome: l.nome, cidade: l.cidade, categoria: l.categoria, whatsapp: soPeloSite(l) ? null : l.whatsapp, desde: l.criadaEm,
    soPeloSite: soPeloSite(l),
    logo: l.logo ?? null, cor: l.cor ?? null, sobre: l.sobre ?? "", entrega: l.entrega ?? null,
    horario: l.horario ?? "", bairrosAtendidos: l.bairrosAtendidos ?? "", prazoEntrega: l.prazoEntrega ?? "",
    modeloCobranca: l.modeloCobranca ?? "mensalidade",
  });
  const produtoLocal = (p, l) => ({
    id: `l-${p.id}`, nome: p.nome, descricao: p.descricao, dept: p.dept, loja: "local",
    lojaId: l.id,
    lojaSlug: l.slug, lojaNome: l.nome, lojaLogo: l.logo ?? null, cidade: l.cidade, whatsapp: soPeloSite(l) ? null : l.whatsapp,
    soPeloSite: soPeloSite(l),
    preco: p.preco, precoAntigo: p.precoAntigo, fotos: p.fotos, nota: 0, vendidos: 0, entrega: l.entrega ?? null,
    disponibilidade: p.disponibilidade ?? "consulte", horario: l.horario ?? "",
    bairrosAtendidos: l.bairrosAtendidos ?? "", prazoEntrega: l.prazoEntrega ?? "",
    modeloCobranca: l.modeloCobranca ?? "mensalidade",
    comissaoPorVenda: l.comissaoPorVenda ?? 1.00,
    esgotado: !temEstoque(p, l),
    // Poucas unidades: avisa o cliente (só no modo por quantidade).
    restam: l.modoEstoque === "quantidade" && p.estoque > 0 && p.estoque <= 5 ? p.estoque : null,
    // Compra pelo site (Pix/cartão com split) só para lojas que pagam por venda e conectaram o Mercado Pago.
    // As de mensalidade vendem pelo WhatsApp.
    compraOnline: l.modeloCobranca === "comissao_fixa" && Boolean(l.mpConta) && mp.oauthConfigurado,
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
      .filter((p) => p.ativo && !p.bloqueado && visiveis.has(p.lojaId) && temEstoque(p, visiveis.get(p.lojaId)))
      .sort((x, y) => y.criadoEm.localeCompare(x.criadoEm))
      .map((p) => produtoLocal(p, visiveis.get(p.lojaId)));
    const af = afiliados();
    return {
      atualizadoEm: af.atualizadoEm ?? null,
      campanha: campanhaAtual(agora()),
      proximaCampanha: proximaCampanha(agora()),
      cupons: cuponsAtivos().map(cupomPublico),
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
  // ---------- pedidos: vendas pagas no site e pedidos pelo WhatsApp, com os dados do cliente ----------
  // Os dados do cliente servem só para a loja combinar o pedido e ficam 12 meses (LGPD: o necessário).
  const DIAS_GUARDA_PEDIDOS = 365;
  const ETAPAS = ["novo", "atendimento", "vendido", "cancelado"];
  const limitePedido = new S.Limitador({ maximo: 20, janelaMs: 10 * 60_000 });
  function limparPedidosVencidos() {
    const limite = agora() - DIAS_GUARDA_PEDIDOS * DIA;
    const antes = banco.d.pedidos?.length ?? 0;
    banco.d.pedidos = (banco.d.pedidos ?? []).filter((p) => Date.parse(p.criadoEm) >= limite);
    if (banco.d.pedidos.length !== antes) banco.salvar();
  }
  limparPedidosVencidos();
  function lerComprador(c = {}) {
    const comprador = {
      nome: txt(c.nome, 80), whatsapp: whatsapp(c.whatsapp),
      receber: c.receber === "entrega" ? "entrega" : "retirada", endereco: txt(c.endereco, 200), observacao: txt(c.observacao, 300),
    };
    if (comprador.nome.length < 2) return { erro: "Informe seu nome." };
    if (!comprador.whatsapp) return { erro: "Informe seu WhatsApp com DDD." };
    if (comprador.receber === "entrega" && comprador.endereco.length < 8) return { erro: "Informe o endereço de entrega." };
    return { comprador };
  }
  const quantidadeDe = (v) => Math.min(10, Math.max(1, Math.floor(Number(v)) || 1));
  const reais = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const MAX_ITENS_PEDIDO = 20;
  // Itens do pedido: um produto (produtoId + quantidade) ou o carrinho de uma loja (itens: [{produtoId, quantidade, observacao}]).
  // Nome e preço vêm sempre do servidor; o carrinho finaliza uma loja por vez.
  function lerItens(corpo = {}) {
    const brutos = Array.isArray(corpo.itens) ? corpo.itens : [{ produtoId: corpo.produtoId, quantidade: corpo.quantidade }];
    if (!brutos.length || brutos.length > MAX_ITENS_PEDIDO) return { status: 400, erro: `O pedido precisa ter de 1 a ${MAX_ITENS_PEDIDO} produtos.` };
    const produtos = brutos.map((b) => produtoPorId(String(b?.produtoId ?? "")));
    if (produtos.some((x) => !x || x.loja !== "local")) {
      return { status: 404, erro: brutos.length > 1 ? "Um dos produtos não está mais disponível. Atualize o carrinho." : "Produto não encontrado." };
    }
    if (new Set(produtos.map((x) => x.lojaId)).size > 1) return { status: 400, erro: "Finalize um pedido por loja." };
    const itens = produtos.map((x, i) => ({
      produtoId: x.id, nome: x.nome, preco: x.preco, quantidade: quantidadeDe(brutos[i].quantidade), observacao: txt(brutos[i].observacao, 150),
    }));
    // Estoque: esgotado não vende; no modo por quantidade, ninguém leva mais do que a loja tem.
    const pedidas = new Map();
    for (const i of itens) pedidas.set(i.produtoId, (pedidas.get(i.produtoId) ?? 0) + i.quantidade);
    for (const x of new Map(produtos.map((y) => [y.id, y])).values()) {
      if (x.esgotado) return { status: 409, erro: `${x.nome} está esgotado. Tire do carrinho para continuar.` };
      const tem = banco.loja(x.lojaId)?.modoEstoque === "quantidade" ? banco.produtos.find((r) => `l-${r.id}` === x.id)?.estoque : null;
      if (tem != null && pedidas.get(x.id) > tem) return { status: 409, erro: `Só ${tem === 1 ? "resta 1 unidade" : `restam ${tem} unidades`} de ${x.nome}.` };
    }
    const valorTotal = Math.round(itens.reduce((s, i) => s + i.preco * i.quantidade, 0) * 100) / 100;
    const unidades = itens.reduce((s, i) => s + i.quantidade, 0);
    // Resumo nos campos antigos, para quem lê pedidos de um produto só (painel, planilha, avisos).
    const resumo = { produtoId: itens[0].produtoId, produtoNome: itens.length === 1 ? itens[0].nome : `${itens.length} produtos`, quantidade: unidades, valorTotal, itens };
    return { x: produtos[0], itens, valorTotal, unidades, resumo };
  }
  const linhaItem = (i) => `${i.quantidade}x ${i.nome} (${reais(i.preco * i.quantidade)})${i.observacao ? ` · ${i.observacao}` : ""}`;
  const itensDo = (p) => p.itens ?? [{ nome: p.produtoNome ?? p.produtoId, quantidade: p.quantidade, preco: p.valorTotal / (p.quantidade || 1) }];

  // Estoque por quantidade: desconta (sinal 1) ou devolve (-1) os itens de um pedido, uma vez só (estoqueBaixado).
  // Só em lojas no modo "quantidade" e em produtos com número. Quem chama salva o banco.
  function moverEstoque(loja, pedido, sinal) {
    if (loja.modoEstoque !== "quantidade" || Boolean(pedido.estoqueBaixado) === sinal > 0) return;
    for (const i of pedido.itens ?? [{ produtoId: pedido.produtoId, quantidade: pedido.quantidade }]) {
      const p = banco.produtos.find((r) => r.lojaId === loja.id && `l-${r.id}` === i.produtoId);
      if (!p || p.estoque == null) continue;
      const antes = p.estoque;
      p.estoque = Math.max(0, antes - sinal * i.quantidade);
      if (antes > 0 && p.estoque === 0) avisarEstoqueZerado(loja, p);
    }
    pedido.estoqueBaixado = sinal > 0;
  }
  function avisarEstoqueZerado(loja, p) {
    const texto = `📦 *Acabou o estoque!*\n\n${p.nome} esgotou e saiu da vitrine do CIT Shopping.\nQuando chegar mais, atualize a quantidade no painel: ${urlPublica}/painel#produtos`;
    conectorWaha.enviarTexto({ chatId: loja.whatsapp, texto })
      .catch((e) => log.warn?.(`[estoque] ${loja.slug}: aviso no WhatsApp falhou (${e.message})`));
  }

  // Pedido pelo WhatsApp: registra o pedido (com código) e devolve o link do WhatsApp da loja já com a mensagem.
  app.post("/api/pedidos/whatsapp", (req, res) => {
    if (!limitePedido.registrar(`ped|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitos pedidos seguidos. Espere alguns minutos.");
    const lido = lerItens(req.body);
    if (lido.erro) return erro(res, lido.status, lido.erro);
    const { x, itens, resumo } = lido;
    if (x.soPeloSite) return erro(res, 409, "Esta loja vende só pelo site, com Pix ou cartão.");
    const { comprador, erro: msg } = lerComprador(req.body?.comprador);
    if (msg) return erro(res, 400, msg);
    const pedido = {
      id: `P-${randomBytes(3).toString("hex").toUpperCase()}`, origem: "whatsapp", lojaId: x.lojaId, ...resumo,
      comprador, etapa: "novo", criadoEm: iso(),
    };
    limparPedidosVencidos();
    (banco.d.pedidos ??= []).push(pedido);
    for (const i of itens) banco.registrarCliqueContato(`produto:${i.produtoId.slice(2)}`, iso());
    banco.salvar();
    const mensagem = [
      "Olá! Vi no CIT Shopping e quero fazer um pedido:",
      ...itens.map((i) => `🛍️ *${linhaItem(i)}*`),
      ...(itens.length > 1 ? [`💰 Total: ${reais(pedido.valorTotal)}`] : []),
      `🧾 Pedido ${pedido.id}`,
      "",
      `👤 ${comprador.nome}`,
      comprador.receber === "entrega" ? `🚚 Entrega em: ${comprador.endereco}` : "🏪 Vou retirar na loja",
      ...(comprador.observacao ? [`📝 ${comprador.observacao}`] : []),
      "",
      `🔗 ${urlPublica}/${itens.length > 1 ? encodeURIComponent(x.lojaSlug) : `p/${encodeURIComponent(x.id)}`}`,
    ].join("\n");
    res.json({ ok: true, pedido: pedido.id, url: `https://wa.me/${encodeURIComponent(x.whatsapp)}?text=${encodeURIComponent(mensagem)}` });
  });

  // ---------- cupons ----------
  // Cupons de verdade: o admin cadastra os das lojas parceiras (Shopee, Amazon, Mercado Livre, SHEIN) e cada loja
  // local cadastra os dela no painel. Vale até o fim do dia da validade (Brasília).
  const LOJAS_CUPOM = ["shopee", "amazon", "mercado-livre", "shein"];
  const hojeBR = () => new Date(agora() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cuponsAtivos = () => (banco.d.cupons ?? [])
    .filter((c) => c.validoAte >= hojeBR() && (c.loja !== "local" || lojaVisivel(banco.loja(c.lojaId), agora())))
    .sort((x, y) => x.validoAte.localeCompare(y.validoAte));
  function cupomPublico(c) {
    const l = c.loja === "local" ? banco.loja(c.lojaId) : null;
    return { id: c.id, codigo: c.codigo, descricao: c.descricao, validoAte: c.validoAte, loja: c.loja,
      lojaNome: l?.nome ?? NOME_LOJA[c.loja] ?? "Loja parceira", lojaSlug: l?.slug ?? null, link: c.link ?? (l ? `/loja/${l.slug}` : null) };
  }
  function lerCupom(b = {}) {
    const cupom = {
      codigo: txt(b.codigo, 40).toUpperCase().replace(/\s+/g, ""), descricao: txt(b.descricao, 140),
      validoAte: /^\d{4}-\d{2}-\d{2}$/.test(b.validoAte ?? "") ? b.validoAte : "",
      link: /^https:\/\/[^\s"<>]+$/.test(b.link ?? "") ? String(b.link).slice(0, 300) : null,
    };
    if (cupom.codigo.length < 3) return { erro: "Informe o código do cupom." };
    if (cupom.descricao.length < 3) return { erro: "Diga o que o cupom dá (ex.: 10% em laços)." };
    if (!cupom.validoAte || cupom.validoAte < hojeBR()) return { erro: "Informe uma validade de hoje em diante." };
    return { cupom };
  }
  app.get("/api/cupons", (req, res) => res.set("Cache-Control", "no-cache").json(cuponsAtivos().map(cupomPublico)));
  app.get("/cupons", (req, res) => { semCache(res); res.sendFile(join(publico, "cupons.html")); });
  app.get("/carrinho", (req, res) => { semCache(res); res.sendFile(join(publico, "carrinho.html")); });

  // ---------- alerta "baixou de preço" ----------
  // O cliente deixa o WhatsApp num produto; quando o preço cair abaixo do daquele dia, recebe um aviso
  // pelo robô (WAHA) e o alerta acaba. Alertas sem queda expiram em 90 dias. O aviso traz link para cancelar.
  const DIAS_ALERTA = 90;
  const limiteAlerta = new S.Limitador({ maximo: 15, janelaMs: 60 * 60_000 });
  app.post("/api/alertas", (req, res) => {
    if (!limiteAlerta.registrar(`al|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitos alertas seguidos. Espere um pouco.");
    const x = produtoPorId(String(req.body?.produtoId ?? ""));
    if (!x) return erro(res, 404, "Produto não encontrado.");
    const zap = whatsapp(req.body?.whatsapp);
    if (!zap) return erro(res, 400, "Informe seu WhatsApp com DDD.");
    banco.d.alertas ??= [];
    if (banco.d.alertas.filter((a) => a.whatsapp === zap).length >= 30) return erro(res, 400, "Você já tem 30 alertas ativos. Cancele algum para criar outro.");
    // tipo "estoque": "avise-me quando voltar" num produto esgotado; o padrão é o alerta de queda de preço.
    const tipo = req.body?.tipo === "estoque" ? "estoque" : "preco";
    if (tipo === "estoque" && !x.esgotado) return erro(res, 409, "Este produto está disponível agora.");
    const existente = banco.d.alertas.find((a) => a.whatsapp === zap && a.produtoId === x.id && (a.tipo ?? "preco") === tipo);
    if (!existente) banco.d.alertas.push({ id: randomBytes(12).toString("hex"), produtoId: x.id, produtoNome: x.nome, whatsapp: zap, tipo, precoBase: x.preco, criadoEm: iso() });
    banco.salvar();
    res.json({ ok: true, preco: x.preco });
  });
  app.get("/alertas/cancelar/:id", (req, res) => {
    banco.d.alertas = (banco.d.alertas ?? []).filter((a) => a.id !== req.params.id);
    banco.salvar();
    res.set("Cache-Control", "no-store").type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alerta cancelado · CIT Shopping</title><link rel="stylesheet" href="/estilo.css"></head><body><main class="wrap" style="padding:48px 16px;max-width:520px"><h1 style="color:var(--deep)">Alerta cancelado</h1><p>Você não vai mais receber esse aviso.</p><p><a class="btn" href="/">Voltar às ofertas</a></p></main></body></html>`);
  });
  // Roda a cada hora (servidor.js): avisa quem tem alerta de produto que baixou e limpa os vencidos.
  async function verificarAlertas() {
    const alertas = banco.d.alertas ?? [];
    if (!alertas.length) return { avisados: 0 };
    const limite = agora() - DIAS_ALERTA * DIA;
    const ficam = [];
    let avisados = 0;
    for (const a of alertas) {
      if (Date.parse(a.criadoEm) < limite) continue;
      const x = produtoPorId(a.produtoId);
      // Queda que vale aviso: pelo menos 1% e R$ 0,50 abaixo do preço do dia do alerta.
      const quer = a.tipo === "estoque" ? x && !x.esgotado : x && !x.esgotado && x.preco <= a.precoBase * 0.99 && a.precoBase - x.preco >= 0.5;
      if (!quer) { if (x) ficam.push(a); continue; }
      const texto = a.tipo === "estoque" ? [
        "📦 *Voltou ao estoque!*",
        "",
        x.nome,
        "",
        `👉 ${urlPublica}/p/${encodeURIComponent(x.id)}`,
        "",
        `Não quer mais esse aviso? ${urlPublica}/alertas/cancelar/${a.id}`,
      ].join("\n") : [
        "🔔 *Baixou de preço!*",
        "",
        `📦 ${x.nome}`,
        `De ${reais(a.precoBase)} por *${reais(x.preco)}*`,
        "",
        `👉 ${urlPublica}/p/${encodeURIComponent(x.id)}`,
        "",
        `Não quer mais esse aviso? ${urlPublica}/alertas/cancelar/${a.id}`,
      ].join("\n");
      try {
        await conectorWaha.enviarTexto({ chatId: a.whatsapp, texto });
        avisados++;
      } catch (e) {
        log.warn?.(`[alertas] aviso de ${x.id} falhou: ${e.message}`);
        ficam.push(a); // tenta de novo na próxima rodada
      }
    }
    banco.d.alertas = ficam;
    banco.salvar();
    if (avisados) log.info?.(`[alertas] ${avisados} aviso(s) de queda de preço enviados`);
    return { avisados };
  }

  // ---------- Story diário da loja local ----------
  // Benefício das lojas de mensalidade: 1 Story por dia (a partir das 10h de Brasília) com o card de um produto,
  // em rodízio entre as lojas com assinatura ativa. Liga e desliga no /admin (Instagram).
  async function publicarStoryDoDia() {
    const cfg = await monitoramentoMotor.obterConfiguracao();
    if (!cfg.instagram?.storyDiario || !conectorInstagram.estaConfigurado()) return { publicado: false, motivo: "desligado" };
    const br = new Date(agora() - 3 * 60 * 60 * 1000);
    const hoje = br.toISOString().slice(0, 10);
    const registro = (banco.d.storiesLojas ??= { ultimoDia: null, porLoja: {} });
    if (registro.ultimoDia === hoje || br.getUTCHours() < 10) return { publicado: false, motivo: "fora do horário ou já publicado hoje" };
    const t = agora();
    const candidatas = banco.lojas
      .filter((l) => statusLoja(l, t) === "ativa")
      .map((l) => ({ l, produtos: banco.produtos.filter((p) => p.lojaId === l.id && p.ativo && !p.bloqueado && p.fotos?.length && temEstoque(p, l)) }))
      .filter((c) => c.produtos.length)
      .sort((a, b) => String(registro.porLoja[a.l.id]?.dia ?? "").localeCompare(String(registro.porLoja[b.l.id]?.dia ?? "")));
    if (!candidatas.length) return { publicado: false, motivo: "nenhuma loja com assinatura ativa e produto com foto" };
    const { l, produtos } = candidatas[0];
    const jaFoi = new Set(registro.porLoja[l.id]?.produtos ?? []);
    const produto = produtos.find((p) => !jaFoi.has(p.id)) ?? produtos[0];
    const id = `l-${produto.id}`;
    await conectorInstagram.publicarStory({ urlImagem: `${urlPublica}/api/instagram/card-stories/${encodeURIComponent(id)}` });
    const usados = jaFoi.has(produto.id) ? [produto.id] : [...jaFoi, produto.id];
    registro.ultimoDia = hoje;
    registro.porLoja[l.id] = { dia: hoje, produtos: usados.slice(-50) };
    registro.ultimo = { dia: hoje, loja: l.nome, produto: produto.nome };
    banco.salvar();
    log.info?.(`[story] ${l.slug}: ${produto.nome}`);
    return { publicado: true, loja: l.slug, produto: id };
  }

  // Link antigo/sem JavaScript: vai direto ao WhatsApp, sem registrar pedido.
  app.get("/contato/:id", (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x || x.loja !== "local") return res.status(404).sendFile(join(publico, "404.html"));
    if (x.soPeloSite) return res.redirect(302, `/p/${encodeURIComponent(x.id)}`);
    banco.registrarCliqueContato(`produto:${req.params.id.slice(2)}`, iso());
    const pagina = `${urlPublica}/p/${encodeURIComponent(req.params.id)}`;
    const precoFormatado = x.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const modelo = typeof req.query.modelo === "string" ? req.query.modelo.trim() : "";
    const tamanho = typeof req.query.tamanho === "string" ? req.query.tamanho.trim() : "";
    const cor = typeof req.query.cor === "string" ? req.query.cor.trim() : "";
    const obs = typeof req.query.obs === "string" ? req.query.obs.trim() : "";

    const detalhes = [];
    if (modelo) detalhes.push(`▫️ *Modelo:* ${modelo}`);
    if (tamanho) detalhes.push(`▫️ *Tamanho:* ${tamanho}`);
    if (cor) detalhes.push(`▫️ *Cor:* ${cor}`);
    if (obs) detalhes.push(`▫️ *Obs:* ${obs}`);

    const linhas = [
      "Olá! Vi o produto no CIT Shopping e tenho interesse em pedir:",
      `🛍️ *${x.nome}* (${precoFormatado})`,
    ];
    if (detalhes.length) {
      linhas.push("", "Minhas preferências:", ...detalhes);
    }
    linhas.push("", `🔗 ${pagina}`);

    const mensagem = linhas.join("\n");
    const destino = `https://wa.me/${encodeURIComponent(x.whatsapp)}?text=${encodeURIComponent(mensagem)}`;
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex, nofollow").redirect(302, destino);
  });
  app.get("/contato/loja/:slug", (req, res) => {
    const loja = banco.lojas.find((l) => l.slug === req.params.slug && lojaVisivel(l, agora()));
    if (!loja) return res.status(404).sendFile(join(publico, "404.html"));
    if (soPeloSite(loja)) return res.redirect(302, `/${encodeURIComponent(loja.slug)}`);
    banco.registrarCliqueContato(`loja:${loja.id}`, iso());
    const pagina = `${urlPublica}/loja/${encodeURIComponent(loja.slug)}`;
    const mensagem = `Olá! Encontrei sua loja na CIT Shopping. ${pagina}`;
    const destino = `https://wa.me/${encodeURIComponent(loja.whatsapp)}?text=${encodeURIComponent(mensagem)}`;
    res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex, nofollow").redirect(302, destino);
  });

  // ---------- painel da loja ----------
  // Pedidos da loja, do mais novo ao mais antigo. Compra no site sem pagamento iniciado ("criado") não conta.
  const pedidosDa = (loja) => (banco.d.pedidos ?? [])
    .filter((p) => p.lojaId === loja.id && !(p.origem !== "whatsapp" && p.status === "criado"))
    .sort((x, y) => y.criadoEm.localeCompare(x.criadoEm));
  // Resumo da aba Início: pedidos novos, vendas por período e o que mais interessa aos clientes.
  // Venda = pago no site (approved) ou pedido do WhatsApp marcado como "vendido"; cancelado não conta.
  function resumoDe(loja) {
    const t = agora();
    const dia = (ms) => new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // dia em Brasília
    const hoje = dia(t);
    const pedidos = pedidosDa(loja).filter((p) => p.etapa !== "cancelado");
    const vendas = pedidos.filter((p) => (p.origem === "whatsapp" ? p.etapa === "vendido" : p.status === "approved"));
    const periodo = (dias) => {
      const doPeriodo = vendas.filter((p) => dias === 1 ? dia(Date.parse(p.criadoEm)) === hoje : Date.parse(p.criadoEm) >= t - dias * DIA);
      return { qtd: doPeriodo.length, valor: Math.round(doPeriodo.reduce((s, p) => s + p.valorTotal, 0) * 100) / 100 };
    };
    const porProduto = new Map();
    for (const p of pedidos) for (const i of itensDo(p)) porProduto.set(i.nome, (porProduto.get(i.nome) ?? 0) + i.quantidade);
    return {
      novos: pedidos.filter((p) => (p.etapa ?? "novo") === "novo").length,
      hoje: periodo(1), semana: periodo(7), mes: periodo(30),
      maisPedidos: [...porProduto].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([nome, quantidade]) => ({ nome, quantidade })),
      maisVistos: banco.produtos.filter((p) => p.lojaId === loja.id)
        .map((p) => ({ nome: p.nome, cliques: banco.cliquesContato(`produto:${p.id}`) }))
        .filter((p) => p.cliques > 0).sort((x, y) => y.cliques - x.cliques).slice(0, 5),
    };
  }
  function painelDe(loja) {
    const t = agora();
    const { senhaHash, mpConta, mpOauth, ...dados } = loja;
    return {
      loja: { ...dados, mpConectado: Boolean(mpConta) },
      pedidos: pedidosDa(loja).slice(0, 200),
      resumo: resumoDe(loja),
      cupons: (banco.d.cupons ?? []).filter((c) => c.lojaId === loja.id).map(cupomPublico),
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
      mpEmail: b.mpEmail === undefined ? req.loja.mpEmail ?? null : (txt(b.mpEmail, 120).toLowerCase() || null),
      mpChavePix: b.mpChavePix === undefined ? req.loja.mpChavePix ?? null : (txt(b.mpChavePix, 120) || null),
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
    const b = req.body ?? {};
    if (b.ativo !== undefined) req.produto.ativo = Boolean(b.ativo);
    if (b.esgotado !== undefined) req.produto.esgotado = b.esgotado === true;
    if (b.estoque !== undefined) req.produto.estoque = estoqueDe(b.estoque);
    banco.salvar();
    res.json(req.produto);
  });
  // Como a loja controla o estoque: "simples" (marca quando acaba) ou "quantidade" (o site desconta a cada venda).
  app.put("/api/painel/estoque", exigirLoja, (req, res) => {
    if (!["simples", "quantidade"].includes(req.body?.modo)) return erro(res, 400, "Modo de estoque inválido.");
    req.loja.modoEstoque = req.body.modo;
    banco.salvar();
    res.json(painelDe(req.loja));
  });

  app.delete("/api/painel/produtos/:id", exigirLoja, meuProduto, a(async (req, res) => {
    for (const u of req.produto.fotos) await apagarFoto(u, uploadsDir);
    banco.d.produtos = banco.produtos.filter((p) => p !== req.produto);
    banco.salvar();
    res.json({ ok: true });
  }));

  // ---------- assinatura ----------
  app.post("/api/painel/assinar", exigirLoja, a(async (req, res) => {
    if (!mp.configurado) return erro(res, 503, "O pagamento ainda não está disponível. Fale com a CIT Shopping.");
    const loja = req.loja;
    // Assinando durante o teste, a primeira cobrança só acontece quando o teste acaba.
    const inicio = Math.max(agora() + 5 * 60_000, Date.parse(loja.testeAte));
    const pa = await mp.criarPreapproval({
      referencia: loja.id, email: loja.email, motivo: "CIT Shopping · Plano Loja", valor: PRECO_PLANO,
      inicio: new Date(inicio).toISOString(), retorno: `${urlPublica}/painel?assinatura=retorno`,
    });
    loja.assinatura = { status: "pendente", preapprovalId: pa.id, atualizadaEm: iso() };
    banco.salvar();
    res.json({ url: pa.initPoint });
  }));

  // ---------- conta Mercado Pago da loja (OAuth) ----------
  // A loja autoriza o aplicativo de marketplace da CIT; com o token dela as vendas caem na conta dela.
  const retornoMp = `${urlPublica}/mercadopago/retorno`;
  function guardarContaMp(loja, c) {
    loja.mpConta = {
      userId: c.userId, token: cifrar(c.accessToken, segredo), refresh: cifrar(c.refreshToken, segredo),
      expiraEm: new Date(agora() + c.expiraEmSeg * 1000).toISOString(), conectadaEm: loja.mpConta?.conectadaEm ?? iso(),
    };
  }
  // Token da loja, renovado quando faltam menos de 7 dias (o do MP vale ~180).
  async function tokenDaLoja(loja) {
    if (!loja.mpConta) return null;
    if (Date.parse(loja.mpConta.expiraEm) - agora() < 7 * DIA) {
      try { guardarContaMp(loja, await mp.renovarToken(decifrar(loja.mpConta.refresh, segredo))); banco.salvar(); }
      catch (e) { log.warn?.(`[mp] ${loja.slug}: renovação do token falhou: ${e.message}`); }
    }
    return decifrar(loja.mpConta.token, segredo);
  }
  app.get("/api/painel/mercadopago/conectar", exigirLoja, (req, res) => {
    if (!mp.oauthConfigurado) return erro(res, 503, "Conexão com o Mercado Pago ainda não configurada pela CIT.");
    req.loja.mpOauth = { state: randomBytes(16).toString("hex"), em: iso() };
    banco.salvar();
    res.redirect(mp.urlAutorizacao({ state: req.loja.mpOauth.state, redirectUri: retornoMp }));
  });
  app.get("/mercadopago/retorno", a(async (req, res) => {
    const state = String(req.query.state ?? "");
    const loja = state && banco.lojas.find((l) => l.mpOauth?.state === state && agora() - Date.parse(l.mpOauth.em) < 15 * 60_000);
    if (!loja || !req.query.code) return res.redirect("/painel?mp=erro");
    try {
      guardarContaMp(loja, await mp.trocarCodigo({ code: String(req.query.code), redirectUri: retornoMp }));
      delete loja.mpOauth;
      banco.salvar();
      log.info?.(`[mp] ${loja.slug}: conta Mercado Pago conectada`);
      res.redirect("/painel?mp=conectado");
    } catch (e) {
      log.warn?.(`[mp] ${loja.slug}: troca do código OAuth falhou: ${e.message}`);
      res.redirect("/painel?mp=erro");
    }
  }));
  app.post("/api/painel/cupons", exigirLoja, (req, res) => {
    const { cupom, erro: msg } = lerCupom(req.body);
    if (msg) return erro(res, 400, msg);
    if ((banco.d.cupons ?? []).filter((c) => c.lojaId === req.loja.id).length >= 20) return erro(res, 400, "Limite de 20 cupons. Apague algum antigo.");
    (banco.d.cupons ??= []).push({ id: randomUUID(), ...cupom, link: null, loja: "local", lojaId: req.loja.id, criadoEm: iso() });
    banco.salvar();
    res.status(201).json(painelDe(req.loja));
  });
  app.delete("/api/painel/cupons/:id", exigirLoja, (req, res) => {
    banco.d.cupons = (banco.d.cupons ?? []).filter((c) => !(c.id === req.params.id && c.lojaId === req.loja.id));
    banco.salvar();
    res.json(painelDe(req.loja));
  });
  app.patch("/api/painel/pedidos/:id", exigirLoja, (req, res) => {
    const p = (banco.d.pedidos ?? []).find((x) => x.id === req.params.id && x.lojaId === req.loja.id);
    if (!p) return erro(res, 404, "Pedido não encontrado.");
    if (!ETAPAS.includes(req.body?.etapa)) return erro(res, 400, "Situação inválida.");
    Object.assign(p, { etapa: req.body.etapa, atualizadoEm: iso() });
    if (p.etapa === "vendido") moverEstoque(req.loja, p, 1);
    if (p.etapa === "cancelado") moverEstoque(req.loja, p, -1);
    banco.salvar();
    res.json(painelDe(req.loja));
  });
  // Planilha (CSV com ; e BOM, abre direto no Excel em português).
  app.get("/api/painel/pedidos.csv", exigirLoja, (req, res) => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const ETAPA = { novo: "Novo", atendimento: "Em atendimento", vendido: "Vendido", cancelado: "Cancelado" };
    // Uma linha por produto; o código do pedido agrupa as linhas de um mesmo carrinho.
    const linhas = [["Data", "Pedido", "Origem", "Pagamento", "Situação", "Produto", "Opções", "Qtd", "Valor", "Total do pedido", "Cliente", "WhatsApp", "Receber", "Endereço", "Observação"]];
    const virgula = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
    for (const p of pedidosDa(req.loja)) {
      const c = p.comprador ?? {};
      for (const i of itensDo(p)) {
        linhas.push([new Date(p.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }), p.id, p.origem === "whatsapp" ? "Pedido no WhatsApp" : "Pago no site",
          p.origem === "whatsapp" ? "" : p.status, ETAPA[p.etapa ?? "novo"], i.nome, i.observacao, i.quantidade, virgula(i.preco * i.quantidade), virgula(p.valorTotal),
          c.nome, c.whatsapp, c.receber === "entrega" ? "Entrega" : "Retirada", c.endereco, c.observacao]);
      }
    }
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="pedidos-${req.loja.slug}.csv"`)
      .set("Cache-Control", "no-store").send("\ufeff" + linhas.map((l) => l.map(cel).join(";")).join("\r\n"));
  });

  app.post("/api/painel/mercadopago/desconectar", exigirLoja, (req, res) => {
    delete req.loja.mpConta;
    banco.salvar();
    res.json(painelDe(req.loja));
  });

  // Venda com split: cobrança criada com o token da loja; a CIT recebe a comissão (marketplace_fee/application_fee).
  app.post("/api/pagamento/split", express.json(), a(async (req, res) => {
    if (!limitePagamento.registrar(`pag|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    const { emailComprador, metodo = "checkout_pro" } = req.body ?? {};
    const lido = lerItens(req.body);
    if (lido.erro) return erro(res, lido.status, lido.erro);
    const { x: prod, itens, valorTotal, unidades, resumo } = lido;
    const carrinho = Array.isArray(req.body?.itens);
    const loja = banco.loja(prod.lojaId);
    if (!loja) return erro(res, 404, "Loja não encontrada.");
    if (!prod.compraOnline) return erro(res, 409, "Esta loja ainda não recebe pagamentos pelo site. Peça pelo WhatsApp.");
    // Quem compra: a loja precisa saber com quem combinar a entrega.
    const { comprador, erro: msgComprador } = lerComprador(req.body?.comprador);
    if (msgComprador) return erro(res, 400, msgComprador);

    // Comissão da CIT: R$ 1 (comissaoPorVenda) por unidade vendida, só nas lojas que pagam por venda.
    const taxaMarketplace = loja.modeloCobranca === "comissao_fixa" ? Math.round(Number(loja.comissaoPorVenda ?? 1) * unidades * 100) / 100 : 0;
    if (!(taxaMarketplace < valorTotal)) return erro(res, 400, "Valor da compra menor que a taxa da plataforma.");
    const email = String(emailComprador ?? "").trim().toLowerCase();
    if (metodo === "pix" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro(res, 400, "Informe seu e-mail para gerar o Pix.");

    const referencia = `venda-${loja.slug}-${randomUUID()}`;
    const titulo = `${itens.length === 1 ? prod.nome : `${itens.length} produtos`} · ${loja.nome}`;
    const webhookUrl = `${urlPublica}/webhook/mercadopago?loja=${encodeURIComponent(loja.id)}`;
    banco.d.pedidos ??= [];
    limparPedidosVencidos();
    const pedido = { id: referencia, origem: "site", lojaId: loja.id, ...resumo, taxaMarketplace, metodo, comprador, status: "criado", etapa: "novo", criadoEm: iso() };
    try {
      const tokenVendedor = await tokenDaLoja(loja);
      if (metodo === "pix") {
        const pix = await mp.criarPixSplit({ tokenVendedor, titulo, valor: valorTotal, referencia, taxaMarketplace, emailComprador: email, webhookUrl });
        banco.d.pedidos.push({ ...pedido, mpPagamentoId: pix.id, status: pix.status ?? "pending" });
        banco.salvar();
        return res.json({ ok: true, pix, taxaMarketplace, valorTotal });
      }
      const pref = await mp.criarPreferenciaSplit({
        tokenVendedor, titulo, valor: valorTotal, referencia, taxaMarketplace, webhookUrl,
        itens: itens.map((i) => ({ titulo: i.observacao ? `${i.nome} (${i.observacao})`.slice(0, 120) : i.nome, quantidade: i.quantidade, preco: i.preco })),
        // Carrinho volta para /carrinho (e tira dele os itens desta loja); compra de um produto volta para a página dele.
        retornos: Object.fromEntries([["success", "aprovada"], ["pending", "pendente"], ["failure", "falhou"]]
          .map(([k, v]) => [k, carrinho
            ? `${urlPublica}/carrinho?compra=${v}&loja=${encodeURIComponent(loja.id)}`
            : `${urlPublica}/p/${encodeURIComponent(prod.id)}?compra=${v}`])),
      });
      banco.d.pedidos.push(pedido);
      banco.salvar();
      res.json({ ok: true, initPoint: pref.initPoint, taxaMarketplace, valorTotal });
    } catch (e) {
      log.error?.(`[split-mp] ${loja.slug}: falha ao criar pagamento: ${e.message}`);
      erro(res, 502, "Não foi possível gerar o pagamento agora. Tente de novo em instantes.");
    }
  }));

  // Venda paga: a loja recebe no WhatsApp (robô WAHA) o que vender e com quem combinar. Também fica no painel.
  function avisarLojaVenda(loja, p) {
    const c = p.comprador ?? {};
    const texto = [
      "🛍️ *Nova venda paga pelo CIT Shopping!*",
      "",
      ...itensDo(p).map((i) => `📦 ${linhaItem(i)}`),
      `💰 Total ${reais(p.valorTotal)} (pagamento aprovado no Mercado Pago)`,
      "",
      `👤 ${c.nome ?? "-"}`,
      c.whatsapp ? `📱 https://wa.me/${c.whatsapp}` : "",
      c.receber === "entrega" ? `🚚 Entregar em: ${c.endereco}` : "🏪 Vai retirar na loja",
      c.observacao ? `📝 ${c.observacao}` : "",
      "",
      "Fale com o cliente para combinar a entrega.",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    conectorWaha.enviarTexto({ chatId: loja.whatsapp, texto })
      .then(() => log.info?.(`[venda] ${loja.slug}: aviso enviado no WhatsApp`))
      .catch((e) => log.warn?.(`[venda] ${loja.slug}: aviso no WhatsApp falhou (${e.message}); a venda está no painel`));
  }

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
    // Sem segredo configurado não há como provar que veio do Mercado Pago: recusa (falha fechada).
    if (!env.MP_WEBHOOK_SECRET || !webhookValido({
      segredo: env.MP_WEBHOOK_SECRET, assinatura: req.headers["x-signature"], requestId: req.headers["x-request-id"], dataId,
    })) {
      if (!env.MP_WEBHOOK_SECRET) log.warn?.("[mp] webhook recusado: MP_WEBHOOK_SECRET não configurado");
      return res.status(401).json({ erro: "assinatura inválida" });
    }
    const tipo = String(req.body?.type ?? req.query.type ?? "");
    // Pagamento de venda: relido na API com o token da loja (o pagamento é da conta dela).
    if (tipo === "payment" && dataId) {
      const loja = banco.loja(String(req.query.loja ?? ""));
      const token = loja && await tokenDaLoja(loja);
      if (token) {
        const pg = await mp.consultarPagamento(dataId, token);
        const pedido = banco.d.pedidos?.find((p) => p.id === pg.externalReference && p.lojaId === loja.id);
        if (pedido) {
          const acabouDeAprovar = pg.status === "approved" && pedido.status !== "approved";
          Object.assign(pedido, { status: pg.status, mpPagamentoId: pg.id, atualizadoEm: iso() });
          if (acabouDeAprovar) moverEstoque(loja, pedido, 1);
          if (["refunded", "cancelled", "charged_back"].includes(pg.status)) moverEstoque(loja, pedido, -1);
          banco.salvar();
          log.info?.(`[mp] venda ${pedido.id}: ${pg.status}`);
          if (acabouDeAprovar) avisarLojaVenda(loja, pedido);
        }
      }
    }
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
    res.json(banco.lojas.map(({ senhaHash, mpConta, mpOauth, ...l }) => ({
      ...l, status: statusLoja(l, t), mpConectado: Boolean(mpConta),
      pedidos: (() => { const ps = pedidosDa(l); return { total: ps.length, pagos: ps.filter((p) => p.status === "approved").length, whatsapp: ps.filter((p) => p.origem === "whatsapp").length }; })(),
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
  app.put("/api/admin/lojas/:id/modelo-cobranca", exigirAdmin, lojaAdmin, express.json(), (req, res) => {
    const { modeloCobranca, comissaoPorVenda } = req.body || {};
    req.loja.modeloCobranca = modeloCobranca === "comissao_fixa" ? "comissao_fixa" : "mensalidade";
    if (comissaoPorVenda !== undefined) req.loja.comissaoPorVenda = Number(comissaoPorVenda) || 1.00;
    req.loja.atualizadaEm = iso();
    banco.salvar();
    res.json({ ok: true, loja: req.loja });
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
  app.get("/api/admin/cupons", exigirAdmin, (req, res) => res.json((banco.d.cupons ?? []).filter((c) => c.loja !== "local").map(cupomPublico)));
  app.post("/api/admin/cupons", exigirAdmin, (req, res) => {
    if (!LOJAS_CUPOM.includes(req.body?.loja)) return erro(res, 400, "Escolha a loja do cupom.");
    const { cupom, erro: msg } = lerCupom(req.body);
    if (msg) return erro(res, 400, msg);
    (banco.d.cupons ??= []).push({ id: randomUUID(), ...cupom, loja: req.body.loja, criadoEm: iso() });
    banco.salvar();
    res.status(201).json({ ok: true });
  });
  app.delete("/api/admin/cupons/:id", exigirAdmin, (req, res) => {
    banco.d.cupons = (banco.d.cupons ?? []).filter((c) => c.id !== req.params.id);
    banco.salvar();
    res.json({ ok: true });
  });
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

  // Relatório de Vendas e Conversões da Shopee Open API (admin)
  app.get("/api/admin/shopee/relatorio", exigirAdmin, a(async (req, res) => {
    const dias = Number(req.query.dias) || 30;
    const conector = agendadorOfertas.coletor?.conectores?.shopee;
    if (!conector) return res.json({ configurado: false, erro: "Conector Shopee não inicializado." });
    const relatorio = await conector.obterRelatorioVendas({ dias });
    res.json(relatorio);
  }));

  // ---------- Radar de Ofertas no WhatsApp via WAHA (admin) ----------
  app.get("/api/admin/radar/status", exigirAdmin, a(async (req, res) => {
    const statusWaha = await conectorWaha.verificarStatus();
    const config = await monitoramentoMotor.obterConfiguracao();
    const historico = radarOfertas.carregarHistoricoEnviados();
    const agoraMs = Date.now();
    const umDiaMs = 24 * 3600 * 1000;
    const enviados24h = historico.filter((h) => agoraMs - new Date(h.enviadoEm).getTime() < umDiaMs);

    res.json({
      waha: statusWaha,
      config: config.radar || {},
      totalHistorico: historico.length,
      enviados24h: enviados24h.length,
      ultimosEnviados: historico.slice(-10).reverse(),
    });
  }));

  app.post("/api/admin/radar/config", exigirAdmin, express.json(), a(async (req, res) => {
    const configAtual = await monitoramentoMotor.obterConfiguracao();
    const novaConfig = {
      ...configAtual,
      radar: {
        ...(configAtual.radar || {}),
        ...(req.body || {}),
      },
    };
    const salva = await monitoramentoMotor.salvarConfiguracao(novaConfig);
    res.json({ ok: true, radar: salva.radar });
  }));

  app.post("/api/admin/radar/testar", exigirAdmin, express.json(), a(async (req, res) => {
    const config = await monitoramentoMotor.obterConfiguracao();
    const chatId = req.body?.chatId || config.radar?.chatId;
    if (!chatId) return res.status(400).json({ ok: false, erro: "Informe o chatId de destino (número, canal ou grupo do WhatsApp)." });

    try {
      const envio = await radarOfertas.enviarMensagemTeste({ chatId });
      res.json({ ok: true, envio });
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message });
    }
  }));

  app.post("/api/admin/radar/disparar-agora", exigirAdmin, express.json(), a(async (req, res) => {
    const config = await monitoramentoMotor.obterConfiguracao();
    const chatId = req.body?.chatId || config.radar?.chatId;
    if (!chatId) return res.status(400).json({ ok: false, erro: "Informe o chatId de destino (número, canal ou grupo do WhatsApp)." });

    const maxDisparos = Number(req.body?.maxDisparos) || config.radar?.maxDisparosPorRodada || 3;
    const descontoMinimoPct = Number(req.body?.descontoMinimoPct) || config.radar?.descontoMinimoPct || 25;

    const catalogo = vitrine().produtos;
    const resultado = await radarOfertas.executarRodada({
      produtos: catalogo,
      chatId,
      maxDisparos,
      descontoMinimoPct,
    });

    res.json({ ok: true, resultado });
  }));

  // ---------- Instagram @shopcitmax ----------
  app.get("/bio", (req, res) => { semCache(res); res.sendFile(join(publico, "bio.html")); });
  app.get("/instagram", (req, res) => { semCache(res); res.sendFile(join(publico, "bio.html")); });
  app.get("/links", (req, res) => { semCache(res); res.sendFile(join(publico, "bio.html")); });

  // Produtos postados no Feed, do mais recente ao mais antigo: a /bio mostra esses primeiro.
  app.get("/api/instagram/feed", (req, res) => {
    const posts = Object.values(banco.d.instagramPosts ?? {}).sort((x, y) => String(y.em).localeCompare(String(x.em)));
    res.set("Cache-Control", "no-cache").json({ ids: [...new Set(posts.map((x) => x.produtoId))] });
  });

  app.get("/api/instagram/card/:id", a(async (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x) return res.status(404).json({ erro: "Produto não encontrado." });
    try {
      const buffer = await geradorCardInstagram.gerarCardFeed(x);
      res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=3600").send(buffer);
    } catch (e) {
      res.status(500).json({ erro: e.message });
    }
  }));

  app.get("/api/instagram/card-stories/:id", a(async (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x) return res.status(404).json({ erro: "Produto não encontrado." });
    try {
      const buffer = await geradorCardInstagram.gerarCardStories(x);
      res.set("Content-Type", "image/jpeg").set("Cache-Control", "public, max-age=3600").send(buffer);
    } catch (e) {
      res.status(500).json({ erro: e.message });
    }
  }));

  // Webhook da Meta / Instagram: quem comenta QUERO recebe no direct o link do produto do post.
  // Sem INSTAGRAM_WEBHOOK_VERIFY_TOKEN não há handshake; sem INSTAGRAM_APP_SECRET nenhum evento é aceito.
  app.get("/api/webhook/instagram", (req, res) => {
    const token = env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (token && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === token) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).send("Forbidden");
  });

  const assinaturaMetaValida = (req) => {
    const segredo = env.INSTAGRAM_APP_SECRET;
    const recebida = String(req.headers["x-hub-signature-256"] ?? "");
    if (!segredo || !req.corpoBruto || !recebida.startsWith("sha256=")) return false;
    const esperada = Buffer.from(`sha256=${createHmac("sha256", segredo).update(req.corpoBruto).digest("hex")}`);
    const veio = Buffer.from(recebida);
    return veio.length === esperada.length && timingSafeEqual(veio, esperada);
  };
  // "quero" ou "link" como palavra, sem "não quero".
  const pedeLink = (texto) => /(^|[^\p{L}])(quero|link)([^\p{L}]|$)/iu.test(texto) && !/n[ãa]o\s+quero/i.test(texto);

  app.post("/api/webhook/instagram", a(async (req, res) => {
    if (!assinaturaMetaValida(req)) {
      log.warn?.("[webhook-instagram] evento recusado: assinatura ausente ou inválida (confira INSTAGRAM_APP_SECRET)");
      return res.sendStatus(401);
    }
    res.status(200).send("EVENT_RECEIVED");
    // A Meta agrupa vários eventos num mesmo POST: todos os entries e changes.
    for (const entry of req.body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const val = change.value;
        if (change.field !== "comments" || !val?.id || !val.text || !pedeLink(String(val.text))) continue;
        if (val.from?.id && val.from.id === conectorInstagram.accountId) continue; // comentário da própria conta
        const vinculo = banco.d.instagramPosts?.[val.media?.id];
        const x = vinculo && produtoPorId(vinculo.produtoId);
        const texto = x
          ? `Oi! Aqui está o link de ${x.nome} por ${Number(x.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}: ${urlPublica}/p/${encodeURIComponent(x.id)}`
          : `Oi! As ofertas do CIT Shopping estão aqui: ${urlPublica}/bio`;
        try {
          await conectorInstagram.responderComentarioDirect({ commentId: val.id, texto });
          log.info?.(`[webhook-instagram] direct enviado (comentário ${val.id}, ${x ? `produto ${x.id}` : "sem produto ligado ao post"})`);
        } catch (e) {
          log.warn?.(`[webhook-instagram] falha ao enviar direct do comentário ${val.id}: ${e.message}`);
        }
      }
    }
  }));

  app.get("/api/admin/instagram/legenda/:id", exigirAdmin, (req, res) => {
    const x = produtoPorId(req.params.id);
    if (!x) return res.status(404).json({ erro: "Produto não encontrado." });
    const legenda = conectorInstagram.formatarLegenda(x, { urlPublica });
    res.json({ ok: true, legenda });
  });

  app.get("/api/admin/instagram/status", exigirAdmin, a(async (req, res) => {
    const cfg = await monitoramentoMotor.obterConfiguracao();
    let perfilDetalhes = null;
    let conexaoErro = null;
    if (conectorInstagram.estaConfigurado()) {
      try {
        perfilDetalhes = await conectorInstagram.obterPerfil();
      } catch (e) {
        conexaoErro = e.message;
      }
    }
    res.json({
      configurado: conectorInstagram.estaConfigurado(),
      conectado: Boolean(perfilDetalhes && !conexaoErro),
      accountId: conectorInstagram.accountId || cfg.instagram?.accountId || null,
      perfil: perfilDetalhes?.username ? `@${perfilDetalhes.username}` : "@citshopping",
      perfilDetalhes,
      conexaoErro,
      linkBio: `${urlPublica}/bio`,
      postarAutomatico: Boolean(cfg.instagram?.postarAutomatico ?? cfg.radar?.postarInstagram),
      storyDiario: Boolean(cfg.instagram?.storyDiario),
      ultimoStory: banco.d.storiesLojas?.ultimo ?? null,
    });
  }));

  app.post("/api/admin/instagram/config", exigirAdmin, express.json(), a(async (req, res) => {
    const cfgAtual = await monitoramentoMotor.obterConfiguracao();
    const postarAuto = req.body?.postarAutomatico !== undefined ? Boolean(req.body.postarAutomatico) : Boolean(cfgAtual.instagram?.postarAutomatico);
    const novaCfg = {
      ...cfgAtual,
      instagram: {
        ...(cfgAtual.instagram || {}),
        ...(req.body || {}),
        postarAutomatico: postarAuto,
      },
      radar: {
        ...(cfgAtual.radar || {}),
        postarInstagram: postarAuto,
      },
    };
    if (req.body?.accountId) conectorInstagram.accountId = req.body.accountId;
    if (req.body?.accessToken) conectorInstagram.accessToken = req.body.accessToken;
    if (req.body?.pageAccessToken) conectorInstagram.pageAccessToken = req.body.pageAccessToken;
    await monitoramentoMotor.salvarConfiguracao(novaCfg);
    res.json({ ok: true, instagram: novaCfg.instagram });
  }));

  app.post("/api/admin/instagram/publicar", exigirAdmin, express.json(), a(async (req, res) => {
    const id = req.body?.produtoId;
    const x = id && produtoPorId(id);
    if (!x) return res.status(400).json({ erro: "produtoId inválido ou não encontrado." });

    const urlCard = `${urlPublica}/api/instagram/card/${encodeURIComponent(x.id)}`;
    const legenda = req.body?.legenda || conectorInstagram.formatarLegenda(x, { urlPublica });

    try {
      const resPub = await conectorInstagram.publicarFeed({ urlImagem: urlCard, legenda, produtoId: x.id });
      res.json({ ok: true, publicacao: resPub });
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message });
    }
  }));

  // ---------- Telegram Oficial ----------
  app.get("/api/admin/telegram/status", exigirAdmin, a(async (req, res) => {
    const cfg = await monitoramentoMotor.obterConfiguracao();
    res.json({
      configurado: conectorTelegram.estaConfigurado(),
      chatId: conectorTelegram.chatId || cfg.telegram?.chatId || null,
      ativo: Boolean(cfg.telegram?.ativo ?? cfg.radar?.postarTelegram),
    });
  }));

  app.post("/api/admin/telegram/config", exigirAdmin, express.json(), a(async (req, res) => {
    const cfgAtual = await monitoramentoMotor.obterConfiguracao();
    const ativo = req.body?.ativo !== undefined ? Boolean(req.body.ativo) : Boolean(cfgAtual.telegram?.ativo);
    const novaCfg = {
      ...cfgAtual,
      telegram: {
        ...(cfgAtual.telegram || {}),
        ...(req.body || {}),
        ativo,
      },
      radar: {
        ...(cfgAtual.radar || {}),
        postarTelegram: ativo,
      },
    };
    if (req.body?.botToken) conectorTelegram.botToken = req.body.botToken;
    if (req.body?.chatId) conectorTelegram.chatId = req.body.chatId;
    await monitoramentoMotor.salvarConfiguracao(novaCfg);
    res.json({ ok: true, telegram: novaCfg.telegram });
  }));

  app.post("/api/admin/telegram/testar", exigirAdmin, express.json(), a(async (req, res) => {
    const todos = [...produtosAfiliadosMemoria, ...produtosLocaisParaVitrine()];
    if (!todos.length) return res.status(400).json({ erro: "Nenhum produto disponível para teste." });
    const p = todos[0];
    try {
      const envio = await conectorTelegram.enviarOferta({ produto: p, urlPublica });
      res.json({ ok: true, envio });
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message });
    }
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

  // Rota direta da loja (ex: /mimosdadelly)
  app.get("/:slug", (req, res, next) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const rotasReservadas = new Set(["api", "bio", "admin", "painel", "contato", "p", "og", "uploads", "webhook", "black-friday", "termos", "privacidade", "sitemap.xml", "robots.txt"]);
    if (rotasReservadas.has(slug)) return next();
    const loja = banco.lojas.find((l) => l.slug === slug);
    if (loja && lojaVisivel(loja, agora())) {
      semCache(res);
      return res.sendFile(join(publico, "index.html"));
    }
    next();
  });

  // Mapa do site XML dinâmico (Sitemap) para o Google e motores de IA
  app.get("/sitemap.xml", (req, res) => {
    const v = vitrine();
    const agoraIso = new Date(agora()).toISOString().slice(0, 10);
    const urls = [
      `  <url>\n    <loc>${urlPublica}/</loc>\n    <lastmod>${agoraIso}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
      `  <url>\n    <loc>${urlPublica}/black-friday</loc>\n    <lastmod>${agoraIso}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    ];

    for (const loja of v.lojas) {
      if (loja.slug) {
        urls.push(`  <url>\n    <loc>${urlPublica}/loja/${encodeURIComponent(loja.slug)}</loc>\n    <lastmod>${agoraIso}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>`);
      }
    }

    for (const p of v.produtos) {
      const dataMod = p.atualizadoEm ? new Date(p.atualizadoEm).toISOString().slice(0, 10) : agoraIso;
      const prioridade = p.loja === "local" ? "0.9" : "0.7";
      urls.push(`  <url>\n    <loc>${urlPublica}/p/${encodeURIComponent(p.id)}</loc>\n    <lastmod>${dataMod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${prioridade}</priority>\n  </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(xml);
  });

  // Página de produto renderizada no servidor: conteúdo, metadados e JSON-LD chegam no HTML inicial.
  const PAGINA_PRODUTO = readFileSync(join(publico, "produto.html"), "utf8");
  const NOME_LOJA = { amazon: "Amazon", shopee: "Shopee", ml: "Mercado Livre", "mercado-livre": "Mercado Livre", shein: "SHEIN" };
  const attr = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function metaProduto(x) {
    const titulo = `${x.nome} · CIT Shopping`;
    const desc = x.loja === "local"
      ? `${x.lojaNome}, ${x.cidade}. Produto disponível na CIT Shopping; consulte a loja pelo WhatsApp.`
      : `Oferta na ${NOME_LOJA[x.loja] ?? "loja parceira"}, achada pela CIT Shopping.`;
    const foto = x.fotos?.[0];
    const imagem = !foto ? null : foto.startsWith("/uploads/") ? `${urlPublica}/og/${basename(foto, ".webp")}.jpg` : foto;
    const canonical = `${urlPublica}/p/${encodeURIComponent(x.id)}`;
    const preco = Number(x.preco).toFixed(2);
    const local = x.loja === "local";
    const esgotado = local && x.esgotado === true;
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

    let seletoresVariacoes = "";
    if (local) {
      const nomeLower = String(x.nome || "").toLowerCase();
      const ehCalcado = x.dept === "calc" || /tenis|tênis|sapato|sandalia|sandália|chinelo|bota|chuteira/i.test(nomeLower);
      const ehVestuario = x.dept === "moda" || /camiseta|camisa|blusa|cropped|calca|calça|shorts|bermuda|vestido|jaqueta|casaco|conjunto|saia/i.test(nomeLower);

      const tamanhos = ehCalcado
        ? ["36", "37", "38", "39", "40", "41", "42", "43", "44"]
        : (ehVestuario ? ["P", "M", "G", "GG", "XG"] : ["Padrão / Único"]);

      const modelos = ehVestuario
        ? ["Tradicional", "Slim", "Babylook", "Oversized"]
        : ["Padrão", "Especial"];

      const cores = ["Preto", "Branco", "Azul", "Vermelho", "Cinza", "Verde", "Rosa", "Bege"];

      seletoresVariacoes = `
      <div class="local-variants" id="variacoes-produto">
        <div class="variant-title">Opções para o pedido</div>
        ${modelos.length > 1 ? `
        <div class="variant-group">
          <span>Modelo / Estilo:</span>
          <div class="chips">
            ${modelos.map((m) => `<button type="button" class="chip-opt" data-var="modelo" data-val="${attr(m)}">${attr(m)}</button>`).join("")}
          </div>
        </div>` : ""}
        <div class="variant-group">
          <span>Tamanho:</span>
          <div class="chips">
            ${tamanhos.map((t) => `<button type="button" class="chip-opt" data-var="tamanho" data-val="${attr(t)}">${attr(t)}</button>`).join("")}
          </div>
        </div>
        <div class="variant-group">
          <span>Cor:</span>
          <div class="chips">
            ${cores.map((c) => `<button type="button" class="chip-opt" data-var="cor" data-val="${attr(c)}">${attr(c)}</button>`).join("")}
          </div>
        </div>
        <div class="variant-group">
          <span>Observação para a loja (opcional):</span>
          <input type="text" class="variant-obs" name="obs" placeholder="Ex: detalhes da estampa, número extra...">
        </div>
      </div>`;
    }

    const descricao = String(x.descricao ?? "").trim();
    const imagemHtml = imagem
      ? `<img src="${attr(imagem)}" alt="${attr(x.nome)}" width="720" height="720" fetchpriority="high">`
      : `<div class="product-no-image" aria-label="Produto sem foto">CIT Shopping</div>`;
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
        ...(esgotado ? { availability: "https://schema.org/OutOfStock" } : {}),
        seller: { "@type": "Organization", name: local ? x.lojaNome : NOME_LOJA[x.loja] ?? "Loja parceira" },
      },
    };
    const substituir = {
      TITULO: attr(titulo), DESCRICAO_META: attr(desc), CANONICAL: attr(canonical), PRECO_DADOS: preco,
      OG_IMAGE: imagem ? `<meta property="og:image" content="${attr(imagem)}">` : "",
      CATEGORIA: attr(x.dept), NOME: attr(x.nome), VENDEDOR: attr(local ? x.lojaNome : NOME_LOJA[x.loja] ?? "Loja parceira"),
      LOCAL_INFO: infoLocal, AVALIACAO: avaliacao, DESCRICAO: descricao ? `<p class="product-highlights">${attr(descricao)}</p>` : "",
      DISPONIBILIDADE: local && x.restam ? `<p class="product-availability product-restam">Restam só ${x.restam} ${x.restam === 1 ? "unidade" : "unidades"}</p>` : local ? `<p class="product-availability">${attr(({ disponivel: "Disponível, conforme informado pela loja", "sob-encomenda": "Sob encomenda", consulte: "Consulte a disponibilidade com a loja" })[disponibilidade] ?? "Consulte a disponibilidade com a loja")}</p>` : "",
      LOCAL_DETALHES: localDetalhes ? `<p class="product-local-details">${localDetalhes}</p>` : "",
      SELETORES_VARIACOES: seletoresVariacoes,
      IMAGEM: imagemHtml, PRECO_ANTIGO: x.precoAntigo > x.preco ? `<del>${attr(x.precoAntigo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))}</del>` : "",
      PRECO: attr(x.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })),
      DESCONTO: x.precoAntigo > x.preco ? `<span class="pct">${Math.round((1 - x.preco / x.precoAntigo) * 100)}% OFF</span>` : "",
      BOTAO_COMPRA_ONLINE: esgotado ? `<p class="compra-esgotada">Esgotado no momento</p>` : x.compraOnline
        ? `<button type="button" class="buybtn product-buy" data-comprar="${attr(x.id)}" data-entrega="${attr(x.entrega ?? "")}">Comprar com Pix ou cartão</button>`
        : x.soPeloSite ? `<p class="compra-em-breve">Compra pelo site disponível em breve.</p>` : "",
      CLASSE_COMPRA: x.compraOnline ? "zapbtn product-buy" : "buybtn product-buy",
      BOTAO_FAVORITO: `<button type="button" class="favbtn" data-favorito="${attr(x.id)}" aria-pressed="false"><svg class="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg><span>Salvar nos favoritos</span></button>`,
      BOTAO_ALERTA: esgotado ? `<button type="button" class="alertabtn" data-alerta="${attr(x.id)}" data-tipo="estoque"><svg class="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>Avise-me quando voltar</button>` : `<button type="button" class="alertabtn" data-alerta="${attr(x.id)}"><svg class="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>Avisar quando baixar o preço</button>`,
      BOTAO_CARRINHO: local && !esgotado && (x.compraOnline || !x.soPeloSite)
        ? `<button type="button" class="favbtn carrinhobtn" data-carrinho="${attr(x.id)}" data-loja="${attr(x.lojaId)}"><svg class="ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h11L21 7H6.2M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1"/></svg><span>Adicionar ao carrinho</span></button>`
        : "",
      ATTR_PEDIDO: x.soPeloSite || esgotado ? "hidden" : local ? `data-pedir-zap="${attr(x.id)}" data-entrega="${attr(x.entrega ?? "")}"` : "",
      LINK_COMPRA: attr(destino), ALVO_COMPRA: local ? "_self" : "_blank",
      REL_COMPRA: local ? "" : "sponsored nofollow noopener",
      TEXTO_COMPRA: local ? "Pedir pelo WhatsApp da loja ↗" : `Comprar na ${NOME_LOJA[x.loja] ?? "loja parceira"} ↗`,
      AVISO_COMPRA: esgotado
        ? `Este produto esgotou. Deixe seu WhatsApp e avisamos quando ${attr(x.lojaNome)} tiver de novo.`
        : x.compraOnline
        ? `Pague aqui com Pix ou cartão pelo Mercado Pago. ${attr(x.lojaNome)} recebe o pedido e combina a entrega com você pelo WhatsApp.`
        : x.soPeloSite
        ? `${attr(x.lojaNome)} vende pelo CIT Shopping com Pix ou cartão. A loja está ativando os pagamentos.`
        : local
        ? `Vendido por ${attr(x.lojaNome)}, em ${attr(x.cidade)}. Combine pagamento, disponibilidade e entrega diretamente com a loja.`
        : `Você finaliza a compra no site da loja. Preço e frete são confirmados lá${x.atualizadoEm ? `; preço consultado em ${attr(new Date(x.atualizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}` : ""}.`,
      COMPARTILHAR: encodeURIComponent(`${x.nome} · ${canonical}`),
      DESCRICAO_LONGA: attr(descricao || "Consulte as informações e a disponibilidade com o vendedor."),
      AVISO_AFILIADO: local
        ? "Produtos de lojas locais são vendidos e entregues pela própria loja."
        : "O CIT Shopping pode receber comissão por compras feitas pelos links de afiliado, sem custo adicional para você. Preço e estoque podem mudar.",
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

  return { app, banco, dadosDir, sincronizarAssinaturas, verificarAlertas, publicarStoryDoDia, monitoramentoMotor, agendadorOfertas };
}
