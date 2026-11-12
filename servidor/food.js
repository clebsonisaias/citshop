// CITshop Food: rotas da praça de alimentação, do painel do restaurante, da cozinha (KDS) e do CITshop Print.
// Restaurante = conta em banco.lojas com segmento "food" (reaproveita cadastro, sessão, assinatura FOOD PRO e Mercado Pago).
// Coleções: d.cardapio (itens), d.pedidos (origem "food"), d.acessos (cozinha/atendente/impressora), d.impressoes (fila).
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { ATIVAS, ROTULO_SITUACAO, TIPOS_COMANDA, comandaDe, lerHorarios, lerItem, montarItens, podeMudar, situacaoLoja } from "./food-regras.js";
import { receberFotos, salvarFoto } from "./uploads.js";

const reais = (n) => Math.round(Number(n) * 100) / 100;
const hash = (t) => createHash("sha256").update(String(t)).digest("hex");
const MIN = 60_000;

export function instalarFood(app, ctx) {
  const { banco, agora, iso, erro, a, exigirLoja, exigirAdmin, S, segredo, urlPublica, mp, tokenDaLoja, freteDe, freteAtivo, auditar, conectorWaha, log, lojaVisivel, notaDaLoja, whatsapp, txt, uploadsDir } = ctx;
  const ehFood = (l) => l?.segmento === "food";
  const cardapioDa = (lojaId) => (banco.d.cardapio ??= []).filter((i) => i.lojaId === lojaId);
  const pedidosFood = (lojaId) => (banco.d.pedidos ?? []).filter((p) => p.origem === "food" && p.lojaId === lojaId);
  // Na cozinha só entra pedido confirmado: pago (online aprovado) ou para cobrar na entrega.
  const naCozinha = (p) => p.status === "na_entrega" || p.status === "approved";
  const tokenAcompanhar = (id) => createHmac("sha256", segredo).update(`food:${id}`).digest("base64url").slice(0, 24);

  // Versão por restaurante: a tela da cozinha pergunta a cada poucos segundos e só baixa a lista quando mudou.
  const versoes = new Map(), vistos = new Map();
  const versao = (lojaId) => versoes.get(lojaId) ?? 0;
  const mexeu = (lojaId) => versoes.set(lojaId, versao(lojaId) + 1);

  // ---------- acessos por estabelecimento (cozinha, atendente, impressora): só o hash fica guardado ----------
  const acessos = () => (banco.d.acessos ??= []);
  function acessoDoToken(req, papeis) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? "");
    const ac = m && acessos().find((x) => x.tokenHash === hash(m[1]) && !x.revogadoEm && papeis.includes(x.papel));
    const loja = ac && banco.loja(ac.lojaId);
    if (!ac || !loja || loja.suspensa) return null;
    vistos.set(ac.id, agora());
    return { ac, loja, papel: ac.papel };
  }
  // KDS: o tablet usa o link da cozinha (token); o dono, logado no painel, também abre a tela.
  function exigirKds(req, res, next) {
    const t = acessoDoToken(req, ["cozinha", "atendente"]);
    if (t) { Object.assign(req, { loja: t.loja, papel: t.papel, quem: t.ac.nome }); return next(); }
    exigirLoja(req, res, () => (ehFood(req.loja) ? (Object.assign(req, { papel: "dono", quem: "dono" }), next()) : erro(res, 403, "Só para restaurantes.")));
  }
  const exigirRest = (req, res, next) => exigirLoja(req, res, () => (ehFood(req.loja) ? next() : erro(res, 403, "Esta área é dos restaurantes do CITshop Food.")));
  function exigirImpressora(req, res, next) {
    const t = acessoDoToken(req, ["impressora"]);
    if (!t) return erro(res, 401, "Dispositivo não vinculado ou revogado. Vincule de novo pelo painel.");
    Object.assign(req, { loja: t.loja, acesso: t.ac });
    next();
  }
  const acessoPublico = (x) => ({
    id: x.id, papel: x.papel, nome: x.nome, criadoEm: x.criadoEm, revogadoEm: x.revogadoEm ?? null, vinculado: Boolean(x.tokenHash),
    codigoAte: x.codigoHash ? x.codigoAte : null, dispositivo: x.dispositivo ?? null, vistoEm: vistos.has(x.id) ? new Date(vistos.get(x.id)).toISOString() : null,
  });

  // ---------- fila de impressão: uma chave por pedido + tipo + versão da comanda (impressão automática uma vez só) ----------
  const impressoes = () => (banco.d.impressoes ??= []);
  const impressoraAtiva = (lojaId) => acessos().some((x) => x.lojaId === lojaId && x.papel === "impressora" && x.tokenHash && !x.revogadoEm);
  function enfileirar(loja, pedido, tipo = "completa", { manual = false, por = null } = {}) {
    if (!impressoraAtiva(loja.id)) return null;
    const base = `${pedido.id}:${tipo}:v${pedido.versaoComanda ?? 1}`;
    if (!manual && impressoes().some((j) => j.chave === base)) return null; // reenvio de evento, reconexão, webhook repetido
    const id = randomUUID();
    const job = { id, chave: manual ? `${base}:manual:${id}` : base, lojaId: loja.id, pedidoId: pedido.id, tipo, manual, solicitadoPor: por, comanda: comandaDe(pedido, loja, tipo), status: "pendente", tentativas: 0, erro: null, criadoEm: iso() };
    impressoes().push(job);
    if (impressoes().length > 5000) impressoes().splice(0, impressoes().length - 5000);
    return job;
  }

  // ---------- avisos (WhatsApp; cada aviso uma vez por pedido) ----------
  function avisar(pedido, chave, chatId, texto) {
    pedido.avisos ??= [];
    if (!chatId || pedido.avisos.includes(chave)) return;
    pedido.avisos.push(chave);
    conectorWaha.enviarTexto({ chatId, texto }).catch((e) => log.warn?.(`[food] aviso ${chave} falhou: ${e.message}`));
  }
  const MSG_CLIENTE = { aceito: "foi aceito e já vai para o preparo", pronto: "está pronto", saiu: "saiu para entrega", cancelado: "foi cancelado. Fale com o restaurante se tiver dúvida" };
  function entrouNaCozinha(loja, pedido) {
    enfileirar(loja, pedido, "completa");
    mexeu(loja.id);
    avisar(pedido, "loja:novo", loja.whatsapp, `🍽️ *Novo pedido #${pedido.numero}* no CITshop Food\n${pedido.itens.map((i) => `${i.quantidade}x ${i.nome}`).join("\n")}\nTotal ${pedido.valorTotal.toFixed(2).replace(".", ",")}\n${urlPublica}/cozinha`);
  }
  function mudarSituacao(loja, pedido, para, quem) {
    const de = pedido.situacao;
    if (de === para) return null;
    if (["concluido", "cancelado"].includes(de)) return "Este pedido já foi encerrado.";
    pedido.situacao = para;
    (pedido.historico ??= []).push({ em: iso(), campo: "situacao", de, para, por: quem });
    if (MSG_CLIENTE[para] && !(para === "pronto" && pedido.receber === "entrega")) {
      avisar(pedido, `cliente:${para}`, pedido.comprador?.whatsapp, `${loja.nome}: seu pedido #${pedido.numero} ${MSG_CLIENTE[para]}.\n${urlPublica}/alimentacao/${loja.slug}?pedido=${pedido.id}&t=${tokenAcompanhar(pedido.id)}`);
    }
    mexeu(loja.id);
    return null;
  }
  ctx.food = { aoAprovar: (loja, pedido) => { if (pedido.origem === "food") entrouNaCozinha(loja, pedido); } };

  // ---------- público: praça de alimentação ----------
  const taxaMinima = (l) => (freteAtivo(l) ? Math.min(...l.frete.faixas.map((f) => f.valor)) : l.food?.taxaEntrega ?? null);
  const restaurantePublico = (l) => {
    const f = l.food ?? {}, s = situacaoLoja(f, agora());
    return {
      slug: l.slug, nome: l.nome, logo: l.logo ?? null, cor: l.cor ?? null, cidade: l.cidade, tipo: f.tipo ?? l.categoria ?? "Restaurante", sobre: l.sobre ?? "",
      aberto: s.aberto, situacao: s.motivo, horarios: f.horarios ?? [], preparoMin: f.preparoMin ?? 40, pedidoMinimo: f.pedidoMinimo ?? 0,
      entrega: f.entrega !== false, retirada: f.retirada !== false, taxaEntregaDesde: taxaMinima(l), entregaPorKm: freteAtivo(l),
      pagamentoOnline: Boolean(l.mpConta) && mp.configurado, avaliacao: notaDaLoja(l.id), localEndereco: l.local?.publico ? l.local.endereco ?? "" : "",
    };
  };
  const restaurantesVisiveis = () => banco.lojas.filter((l) => ehFood(l) && lojaVisivel(l, agora()));
  app.get("/api/food/restaurantes", (req, res) => res.set("Cache-Control", "no-cache").json(restaurantesVisiveis().map(restaurantePublico)
    .sort((x, y) => Number(y.aberto) - Number(x.aberto) || x.nome.localeCompare(y.nome, "pt-BR"))));
  app.get("/api/food/restaurantes/:slug", (req, res) => {
    const l = restaurantesVisiveis().find((x) => x.slug === req.params.slug);
    if (!l) return erro(res, 404, "Restaurante não encontrado.");
    const itens = cardapioDa(l.id).filter((i) => i.ativo).map(({ lojaId, criadoEm, atualizadoEm, ...i }) => ({ ...i, grupos: i.grupos.map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => o.ativo !== false) })) }));
    res.set("Cache-Control", "no-cache").json({ restaurante: restaurantePublico(l), itens });
  });

  const limitePedido = new S.Limitador({ maximo: 15, janelaMs: 10 * MIN });
  const PAGAMENTOS = { dinheiro: "Dinheiro na entrega", cartao_entrega: "Cartão na entrega", pix_entrega: "Pix na entrega", online: "Pago online (Mercado Pago)" };
  app.post("/api/food/pedidos", a(async (req, res) => {
    if (!limitePedido.registrar(`food|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitos pedidos seguidos. Espere um pouco.");
    const b = req.body ?? {};
    const loja = restaurantesVisiveis().find((x) => x.slug === String(b.loja ?? ""));
    if (!loja) return erro(res, 404, "Restaurante não encontrado.");
    const f = loja.food ?? {}, s = situacaoLoja(f, agora());
    if (!s.aberto) return erro(res, 409, `${loja.nome} não está recebendo pedidos agora (${s.motivo.toLowerCase()}).`);
    if (f.maxSimultaneos && pedidosFood(loja.id).filter((p) => naCozinha(p) && ATIVAS.has(p.situacao)).length >= f.maxSimultaneos) return erro(res, 409, "O restaurante está com muitos pedidos agora. Tente em alguns minutos.");
    const montado = montarItens(cardapioDa(loja.id), b.itens);
    if (montado.erro) return erro(res, 400, montado.erro);
    const comprador = { nome: txt(b.comprador?.nome, 80), whatsapp: whatsapp(b.comprador?.whatsapp), observacao: txt(b.comprador?.observacao, 300), endereco: txt(b.comprador?.endereco, 200) };
    if (comprador.nome.length < 2) return erro(res, 400, "Informe seu nome.");
    if (!comprador.whatsapp) return erro(res, 400, "Informe seu WhatsApp com DDD.");
    if ((f.pedidoMinimo ?? 0) > montado.subtotal) return erro(res, 400, `O pedido mínimo é R$ ${f.pedidoMinimo.toFixed(2).replace(".", ",")}.`);
    const receber = b.receber === "entrega" ? "entrega" : "retirada";
    let entrega = null;
    if (receber === "entrega") {
      if (f.entrega === false) return erro(res, 400, "Este restaurante não faz entrega: escolha retirar.");
      if (comprador.endereco.length < 8) return erro(res, 400, "Informe o endereço de entrega.");
      if (freteAtivo(loja)) {
        const lat = Number(b.ponto?.lat), lng = Number(b.ponto?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return erro(res, 400, "Marque o local da entrega no mapa.");
        const fr = freteDe(loja, { lat, lng }, montado.subtotal);
        if (fr.fora) return erro(res, 400, `Fora da área de entrega (${String(fr.km).replace(".", ",")} km).`);
        entrega = { km: fr.km, valor: fr.valor, lat, lng };
      } else entrega = { km: null, valor: reais(f.taxaEntrega ?? 0) };
    } else if (f.retirada === false) return erro(res, 400, "Este restaurante só faz entrega.");
    const pagamentoForma = PAGAMENTOS[b.pagamento] ? b.pagamento : "dinheiro";
    const online = pagamentoForma === "online";
    if (online && !(loja.mpConta && mp.configurado)) return erro(res, 400, "Este restaurante ainda não recebe pagamento online. Escolha pagar na entrega.");
    f.ultimoNumero = (f.ultimoNumero ?? 0) + 1;
    loja.food = f;
    const total = reais(montado.subtotal + (entrega?.valor ?? 0));
    const pedido = {
      id: `food-${randomUUID()}`, origem: "food", lojaId: loja.id, numero: f.ultimoNumero, itens: montado.itens, subtotal: montado.subtotal, entrega, valorTotal: total, receber, comprador,
      pagamentoForma, troco: pagamentoForma === "dinheiro" ? reais(Number(b.troco) || 0) || null : null,
      status: online ? "criado" : "na_entrega", situacao: "aguardando", historico: [], versaoComanda: 1, criadoEm: iso(),
      financeiro: { modelo: "food_pro", comissaoTotal: 0, unidades: montado.itens.reduce((s2, i) => s2 + i.quantidade, 0), valorTotal: total }, // FOOD PRO: nenhuma comissão
    };
    const acompanhar = `${urlPublica}/alimentacao/${loja.slug}?pedido=${pedido.id}&t=${tokenAcompanhar(pedido.id)}`;
    banco.d.pedidos ??= [];
    if (online) {
      const pref = await mp.criarPreferenciaSplit({
        tokenVendedor: await tokenDaLoja(loja), titulo: `Pedido #${pedido.numero} · ${loja.nome}`, valor: total, referencia: pedido.id, taxaMarketplace: 0,
        webhookUrl: `${urlPublica}/webhook/mercadopago?loja=${encodeURIComponent(loja.id)}`,
        itens: [...pedido.itens.map((i) => ({ titulo: [i.nome, ...i.opcoes.map((o) => o.nome)].join(" · ").slice(0, 120), quantidade: i.quantidade, preco: i.unitario })),
          ...(entrega?.valor ? [{ titulo: "Entrega", quantidade: 1, preco: entrega.valor }] : [])],
        retornos: { success: acompanhar, pending: acompanhar, failure: acompanhar },
      });
      banco.d.pedidos.push(pedido);
      banco.salvar();
      return res.json({ pedido: pedido.id, numero: pedido.numero, total, initPoint: pref.initPoint, acompanhar });
    }
    banco.d.pedidos.push(pedido);
    entrouNaCozinha(loja, pedido);
    banco.salvar();
    res.status(201).json({ pedido: pedido.id, numero: pedido.numero, total, acompanhar });
  }));
  app.get("/api/food/acompanhar/:id", (req, res) => {
    const p = (banco.d.pedidos ?? []).find((x) => x.id === req.params.id && x.origem === "food");
    if (!p || String(req.query.t ?? "") !== tokenAcompanhar(p.id)) return erro(res, 404, "Pedido não encontrado.");
    res.set("Cache-Control", "no-store").json({ numero: p.numero, situacao: p.situacao, rotulo: ROTULO_SITUACAO[p.situacao], pagamento: p.status, total: p.valorTotal, receber: p.receber, itens: p.itens.map((i) => `${i.quantidade}x ${i.nome}`), criadoEm: p.criadoEm });
  });

  // ---------- painel do restaurante ----------
  const painelFood = (loja) => {
    const vivos = acessos().filter((x) => x.lojaId === loja.id);
    const impressora = vivos.find((x) => x.papel === "impressora" && x.tokenHash && !x.revogadoEm);
    const visto = impressora && vistos.get(impressora.id);
    return {
      food: loja.food ?? {}, situacao: situacaoLoja(loja.food ?? {}, agora()), slug: loja.slug,
      itens: cardapioDa(loja.id), pedidos: pedidosFood(loja.id).filter((p) => p.status !== "criado").slice(-150).reverse(),
      acessos: vivos.filter((x) => !x.revogadoEm).map(acessoPublico),
      impressao: { configurada: Boolean(impressora), online: Boolean(visto && agora() - visto < 2 * MIN), vistoEm: visto ? new Date(visto).toISOString() : null,
        pendentes: impressoes().filter((j) => j.lojaId === loja.id && ["pendente", "erro"].includes(j.status)).length },
      impressoes: impressoes().filter((j) => j.lojaId === loja.id).slice(-40).reverse().map(({ comanda, ...j }) => ({ ...j, numero: comanda.numero })),
    };
  };
  app.get("/api/food/painel", exigirRest, (req, res) => res.json(painelFood(req.loja)));
  app.put("/api/food/painel/config", exigirRest, (req, res) => {
    const b = req.body ?? {}, f = (req.loja.food ??= {});
    const num = (v, max) => (v === "" || v == null ? null : Math.min(max, Math.max(0, reais(String(v).replace(",", ".")) || 0)));
    Object.assign(f, {
      tipo: txt(b.tipo, 40) || f.tipo || "Restaurante", horarios: lerHorarios(b.horarios),
      feriados: (Array.isArray(b.feriados) ? b.feriados : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 40),
      preparoMin: Math.round(num(b.preparoMin, 300) ?? 40), pedidoMinimo: num(b.pedidoMinimo, 10000) ?? 0, taxaEntrega: num(b.taxaEntrega, 1000),
      entrega: b.entrega !== false, retirada: b.retirada !== false, maxSimultaneos: b.maxSimultaneos ? Math.round(num(b.maxSimultaneos, 500)) || null : null,
    });
    if (!f.entrega && !f.retirada) return erro(res, 400, "Deixe pelo menos entrega ou retirada.");
    banco.salvar();
    res.json(painelFood(req.loja));
  });
  // Pausa temporária (minutos; 0 retoma) e fechamento manual: não apagam a configuração de horários.
  app.post("/api/food/painel/pausa", exigirRest, (req, res) => {
    const f = (req.loja.food ??= {}), min = Math.min(240, Math.max(0, Math.round(Number(req.body?.minutos) || 0)));
    f.pausadoAte = min ? new Date(agora() + min * MIN).toISOString() : null;
    if (req.body?.fechado !== undefined) f.fechadoManual = Boolean(req.body.fechado);
    banco.salvar();
    res.json(painelFood(req.loja));
  });
  app.post("/api/food/painel/itens", exigirRest, (req, res) => {
    const r = lerItem(req.body);
    if (r.erro) return erro(res, 400, r.erro);
    if (cardapioDa(req.loja.id).length >= 500) return erro(res, 400, "Limite de 500 itens no cardápio.");
    banco.d.cardapio.push({ id: randomBytes(6).toString("hex"), lojaId: req.loja.id, ...r.item, foto: null, criadoEm: iso() });
    banco.salvar();
    res.status(201).json(painelFood(req.loja));
  });
  const itemDaLoja = (req) => cardapioDa(req.loja.id).find((i) => i.id === req.params.id);
  app.put("/api/food/painel/itens/:id", exigirRest, (req, res) => {
    const item = itemDaLoja(req);
    if (!item) return erro(res, 404, "Item não encontrado.");
    const r = lerItem(req.body);
    if (r.erro) return erro(res, 400, r.erro);
    Object.assign(item, r.item, { atualizadoEm: iso() });
    banco.salvar();
    res.json(painelFood(req.loja));
  });
  app.delete("/api/food/painel/itens/:id", exigirRest, (req, res) => {
    const item = itemDaLoja(req);
    if (!item) return erro(res, 404, "Item não encontrado.");
    banco.d.cardapio.splice(banco.d.cardapio.indexOf(item), 1); // pedidos antigos guardam o retrato, nada se perde
    banco.salvar();
    res.json(painelFood(req.loja));
  });
  app.post("/api/food/painel/itens/:id/foto", exigirRest, receberFotos, a(async (req, res) => {
    const item = itemDaLoja(req);
    if (!item) return erro(res, 404, "Item não encontrado.");
    if (!req.files?.length) return erro(res, 400, "Escolha uma foto.");
    item.foto = await salvarFoto(req.files[0].buffer, uploadsDir);
    banco.salvar();
    res.json(painelFood(req.loja));
  }));
  const pedidoDaLoja = (req) => pedidosFood(req.loja.id).find((p) => p.id === req.params.id);
  app.patch("/api/food/painel/pedidos/:id", exigirRest, (req, res) => mudarPelaTela(req, res));
  app.post("/api/food/painel/pedidos/:id/imprimir", exigirRest, (req, res) => {
    const p = pedidoDaLoja(req);
    if (!p) return erro(res, 404, "Pedido não encontrado.");
    if (!impressoraAtiva(req.loja.id)) return erro(res, 409, "Nenhuma impressora vinculada. Instale o CITshop Print e vincule pelo painel.");
    enfileirar(req.loja, p, TIPOS_COMANDA.includes(req.body?.tipo) ? req.body.tipo : "completa", { manual: true, por: "dono" });
    banco.salvar();
    res.json(painelFood(req.loja));
  });
  app.delete("/api/food/painel/impressoes/:id", exigirRest, (req, res) => {
    const j = impressoes().find((x) => x.id === req.params.id && x.lojaId === req.loja.id);
    if (!j) return erro(res, 404, "Impressão não encontrada.");
    if (!["pendente", "erro"].includes(j.status)) return erro(res, 409, "Esta impressão já foi enviada.");
    Object.assign(j, { status: "cancelado", atualizadoEm: iso() });
    banco.salvar();
    res.json(painelFood(req.loja));
  });
  // Novo acesso: cozinha/atendente recebem um link (token mostrado uma vez); impressora recebe um código de 15 min.
  app.post("/api/food/painel/acessos", exigirRest, (req, res) => {
    const papel = ["cozinha", "atendente", "impressora"].includes(req.body?.papel) ? req.body.papel : null;
    if (!papel) return erro(res, 400, "Escolha cozinha, atendente ou impressora.");
    if (acessos().filter((x) => x.lojaId === req.loja.id && !x.revogadoEm).length >= 20) return erro(res, 400, "Limite de 20 acessos. Revogue algum.");
    const ac = { id: randomUUID(), lojaId: req.loja.id, papel, nome: txt(req.body?.nome, 40) || (papel === "impressora" ? "Computador do caixa" : papel === "cozinha" ? "Cozinha" : "Atendimento"), criadoEm: iso() };
    let resposta;
    if (papel === "impressora") {
      const codigo = Array.from(randomBytes(8), (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32]).join("");
      Object.assign(ac, { codigoHash: hash(codigo), codigoAte: new Date(agora() + 15 * MIN).toISOString() });
      resposta = { codigo };
    } else {
      const token = randomBytes(24).toString("base64url");
      ac.tokenHash = hash(token);
      resposta = { link: `${urlPublica}/cozinha#${token}` };
    }
    acessos().push(ac);
    banco.salvar();
    res.status(201).json({ ...resposta, acesso: acessoPublico(ac), painel: painelFood(req.loja) });
  });
  app.delete("/api/food/painel/acessos/:id", exigirRest, (req, res) => {
    const ac = acessos().find((x) => x.id === req.params.id && x.lojaId === req.loja.id && !x.revogadoEm);
    if (!ac) return erro(res, 404, "Acesso não encontrado.");
    ac.revogadoEm = iso();
    banco.salvar();
    res.json(painelFood(req.loja));
  });

  // ---------- cozinha (KDS) ----------
  function mudarPelaTela(req, res) {
    const p = pedidoDaLoja(req);
    if (!p || !naCozinha(p)) return erro(res, 404, "Pedido não encontrado.");
    const para = String(req.body?.situacao ?? "");
    if (!podeMudar(req.papel ?? "dono", para)) return erro(res, 403, req.papel === "cozinha" ? "A cozinha só aceita, prepara e marca como pronto." : "Situação inválida.");
    const falha = mudarSituacao(req.loja, p, para, req.quem ?? "dono");
    if (falha) return erro(res, 409, falha);
    banco.salvar();
    res.json({ ok: true, versao: versao(req.loja.id) });
  }
  app.get("/api/food/kds", exigirKds, (req, res) => {
    const v = versao(req.loja.id);
    if (String(req.query.v ?? "") === String(v)) return res.status(204).end();
    const limite = agora() - 3 * 60 * MIN;
    const pedidos = pedidosFood(req.loja.id).filter((p) => naCozinha(p) && (ATIVAS.has(p.situacao) || Date.parse(p.criadoEm) > limite))
      .map(({ avisos, historico, ...p }) => ({ ...p, comprador: { nome: p.comprador?.nome, observacao: p.comprador?.observacao } }));
    const impressora = acessos().find((x) => x.lojaId === req.loja.id && x.papel === "impressora" && x.tokenHash && !x.revogadoEm);
    res.set("Cache-Control", "no-store").json({ versao: v, papel: req.papel, restaurante: req.loja.nome, preparoMin: req.loja.food?.preparoMin ?? 40, pedidos,
      impressao: impressora ? { online: agora() - (vistos.get(impressora.id) ?? 0) < 2 * MIN } : null });
  });
  app.patch("/api/food/kds/pedidos/:id", exigirKds, (req, res) => mudarPelaTela(req, res));

  // ---------- CITshop Print (dispositivo) ----------
  const limiteVinculo = new S.Limitador({ maximo: 10, janelaMs: 10 * MIN });
  app.post("/api/print/vincular", (req, res) => {
    if (!limiteVinculo.registrar(`pv|${S.ipDe(req)}`).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    const codigo = String(req.body?.codigo ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const ac = acessos().find((x) => x.codigoHash === hash(codigo) && !x.revogadoEm && Date.parse(x.codigoAte) > agora());
    if (!ac) return erro(res, 400, "Código inválido ou vencido. Gere outro no painel do restaurante.");
    const token = randomBytes(32).toString("base64url");
    Object.assign(ac, { tokenHash: hash(token), codigoHash: null, codigoAte: null, vinculadoEm: iso(), dispositivo: { nome: txt(req.body?.dispositivo, 60) || "Computador" } });
    banco.salvar();
    const loja = banco.loja(ac.lojaId);
    res.json({ token, restaurante: loja?.nome ?? "", acessoId: ac.id });
  });
  // Rotação: o app troca o token de tempos em tempos; o antigo deixa de valer na hora.
  app.post("/api/print/renovar", exigirImpressora, (req, res) => {
    const token = randomBytes(32).toString("base64url");
    req.acesso.tokenHash = hash(token);
    banco.salvar();
    res.json({ token });
  });
  app.post("/api/print/batimento", exigirImpressora, (req, res) => {
    const d = req.acesso.dispositivo ?? {}, b = req.body ?? {};
    const novo = { nome: d.nome, impressora: txt(b.impressora, 80), largura: [58, 80].includes(Number(b.largura)) ? Number(b.largura) : d.largura ?? 80, versaoApp: txt(b.versaoApp, 20), estado: txt(b.estado, 120) };
    if (JSON.stringify(novo) !== JSON.stringify(d)) { req.acesso.dispositivo = novo; banco.salvar(); }
    res.json({ ok: true, restaurante: req.loja.nome });
  });
  // Trabalhos pendentes (ou com erro, até 20 tentativas) das últimas 12 h; mais velhos expiram sem imprimir.
  app.get("/api/print/trabalhos", exigirImpressora, (req, res) => {
    const limite = agora() - 12 * 60 * MIN;
    let mudou = false;
    const lista = impressoes().filter((j) => j.lojaId === req.loja.id && ["pendente", "erro"].includes(j.status)).filter((j) => {
      if (Date.parse(j.criadoEm) >= limite && j.tentativas < 20) return true;
      Object.assign(j, { status: "expirado", atualizadoEm: iso() }); mudou = true; return false;
    });
    if (mudou) banco.salvar();
    res.set("Cache-Control", "no-store").json(lista.map(({ id, chave, tipo, manual, comanda, tentativas, criadoEm }) => ({ id, chave, tipo, manual, comanda, tentativas, criadoEm })));
  });
  // Resultado: "enviado" = entregue à impressora (não é prova física de papel impresso); "erro" mantém na fila.
  app.post("/api/print/trabalhos/:id", exigirImpressora, (req, res) => {
    const j = impressoes().find((x) => x.id === req.params.id && x.lojaId === req.loja.id);
    if (!j) return erro(res, 404, "Trabalho não encontrado.");
    if (["enviado", "cancelado", "expirado"].includes(j.status)) return res.json({ ok: true, status: j.status }); // repetido: sem efeito
    if (req.body?.status === "enviado") Object.assign(j, { status: "enviado", enviadoEm: iso(), erro: null });
    else Object.assign(j, { status: "erro", erro: txt(req.body?.erro, 200) || "Falha na impressora", tentativas: j.tentativas + 1 });
    j.atualizadoEm = iso();
    banco.salvar();
    res.json({ ok: true, status: j.status });
  });

  // ---------- admin ----------
  app.get("/api/admin/food", exigirAdmin, (req, res) => res.json({
    restaurantes: banco.lojas.filter(ehFood).map((l) => ({ id: l.id, nome: l.nome, slug: l.slug, situacao: situacaoLoja(l.food ?? {}, agora()).motivo, itens: cardapioDa(l.id).length, pedidos: pedidosFood(l.id).length, suspensa: Boolean(l.suspensa) })),
    acessos: acessos().filter((x) => !x.revogadoEm).map((x) => ({ ...acessoPublico(x), lojaNome: banco.loja(x.lojaId)?.nome ?? "" })),
    falhasImpressao: impressoes().filter((j) => j.status === "erro").slice(-50).map(({ comanda, ...j }) => j),
  }));
  app.delete("/api/admin/food/acessos/:id", exigirAdmin, (req, res) => {
    const ac = acessos().find((x) => x.id === req.params.id && !x.revogadoEm);
    if (!ac) return erro(res, 404, "Acesso não encontrado.");
    ac.revogadoEm = iso();
    auditar("food_acesso_revogado", { acessoId: ac.id, lojaId: ac.lojaId, papel: ac.papel });
    banco.salvar();
    res.json({ ok: true });
  });
}
