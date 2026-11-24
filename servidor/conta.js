// Minha conta do cliente: cadastro e entrada com e-mail e senha, dados, endereços, favoritos e pedidos.
// Coleção: d.clientes. Pedido entra no histórico só se foi feito com a conta aberta (pedido.clienteId):
// ligar pelo WhatsApp mostraria pedidos de outra pessoa a quem cadastrasse o número dela.
// Esqueci a senha: código de 6 dígitos no WhatsApp da conta, pelo robô (o sistema não envia e-mail).
import { createHash, randomInt, randomUUID } from "node:crypto";
import { ROTULO_SITUACAO } from "./food-regras.js";

const MIN = 60_000;
const hash = (t) => createHash("sha256").update(String(t)).digest("hex");

export function instalarConta(app, ctx) {
  const { banco, agora, iso, erro, a, S, segredo, conectorWaha, whatsapp, txt, emailOk, log } = ctx;
  const COOKIE = "citshop_cliente";
  const clientes = () => (banco.d.clientes ??= []);
  const porEmail = (email) => clientes().find((c) => c.email === email);
  // A sessão carrega a "versão da senha": trocar a senha derruba os cookies antigos.
  const versao = (c) => hash(c.senhaHash).slice(0, 12);
  const abrir = (req, res, c) => res.setHeader("Set-Cookie", S.cookie({ nome: COOKIE, caminho: "/api", https: S.ehHttps(req), valor: S.criarSessao({ segredo, dados: { t: "cliente", id: c.id, sv: versao(c) }, agora: agora() }) }));
  const fechar = (req, res) => res.setHeader("Set-Cookie", S.cookie({ nome: COOKIE, valor: "", caminho: "/api", https: S.ehHttps(req) }));
  /** Cliente da sessão, ou null. Usado também pelos pedidos (food e lojas) para marcar de quem é o pedido. */
  function clienteDe(req) {
    const s = S.lerSessao(S.lerCookies(req.headers.cookie)[COOKIE], { segredo, agora: agora() });
    const c = s?.t === "cliente" ? clientes().find((x) => x.id === s.id) : null;
    return c && s.sv === versao(c) ? c : null;
  }
  const exigir = (req, res, next) => ((req.cliente = clienteDe(req)) ? next() : erro(res, 401, "Entre na sua conta."));

  const limiteEntrar = new S.Limitador({ maximo: 8, janelaMs: 10 * MIN });
  const limiteCadastro = new S.Limitador({ maximo: 5, janelaMs: 60 * MIN });
  const limiteCodigo = new S.Limitador({ maximo: 3, janelaMs: 60 * MIN });

  const lerEnderecos = (v) => (Array.isArray(v) ? v : []).map((e) => ({ id: txt(e?.id, 40) || randomUUID(), nome: txt(e?.nome, 30) || "Endereço", texto: txt(e?.texto, 200) })).filter((e) => e.texto.length >= 8).slice(0, 5);
  const lerFavoritos = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => txt(x, 80)).filter(Boolean))].slice(0, 300);

  function pedidosDo(c) {
    const lojas = new Map(banco.lojas.map((l) => [l.id, l]));
    return (banco.d.pedidos ?? []).filter((p) => p.clienteId === c.id && p.status !== "falhou").slice(-50).reverse().map((p) => {
      const l = lojas.get(p.lojaId);
      return {
        id: p.id, numero: p.numero ?? null, loja: l?.nome ?? "Loja", food: p.origem === "food", criadoEm: p.criadoEm,
        total: p.valorTotal ?? p.total ?? null, itens: (p.itens ?? []).map((i) => `${i.quantidade}x ${i.nome}`).slice(0, 6),
        situacao: p.origem === "food" ? ROTULO_SITUACAO[p.situacao] ?? p.situacao : p.etapa === "cancelado" ? "Cancelado" : p.etapa === "vendido" ? "Concluído" : "Com a loja",
        acompanhar: p.linkCliente ?? null,
      };
    });
  }
  const dados = (c) => ({ nome: c.nome, email: c.email, whatsapp: c.whatsapp, enderecos: c.enderecos ?? [], favoritos: c.favoritos ?? [], pedidos: pedidosDo(c) });

  app.post("/api/conta/cadastro", (req, res) => {
    if (!limiteCadastro.registrar(S.ipDe(req)).permitido) return erro(res, 429, "Muitos cadastros a partir desta conexão. Tente mais tarde.");
    const b = req.body ?? {};
    const c = { nome: txt(b.nome, 80), email: txt(b.email, 120).toLowerCase(), whatsapp: whatsapp(b.whatsapp) };
    if (c.nome.length < 2) return erro(res, 400, "Informe seu nome.");
    if (!emailOk(c.email)) return erro(res, 400, "Informe um e-mail válido.");
    if (String(b.senha ?? "").length < 8) return erro(res, 400, "A senha precisa ter pelo menos 8 caracteres.");
    if (!c.whatsapp) return erro(res, 400, "Informe o WhatsApp com DDD: é por ele que você recupera a senha.");
    if (b.aceite !== true) return erro(res, 400, "Aceite os termos para continuar.");
    if (porEmail(c.email)) return erro(res, 409, "Já existe uma conta com este e-mail. Entre com sua senha.");
    Object.assign(c, { id: randomUUID(), senhaHash: S.gerarHashSenha(b.senha), criadoEm: iso(), enderecos: [], favoritos: lerFavoritos(b.favoritos) });
    clientes().push(c);
    banco.salvar();
    log.info?.("[conta] cliente cadastrado");
    abrir(req, res, c);
    res.status(201).json(dados(c));
  });

  app.post("/api/conta/entrar", (req, res) => {
    const email = txt(req.body?.email, 120).toLowerCase(), chave = `${S.ipDe(req)}|${email}`;
    if (!limiteEntrar.registrar(chave).permitido) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");
    const c = porEmail(email);
    if (!(S.conferirSenha(req.body?.senha, c?.senhaHash ?? S.HASH_FALSO) && c)) return erro(res, 401, "E-mail ou senha incorretos.");
    limiteEntrar.liberar(chave);
    abrir(req, res, c);
    res.json(dados(c));
  });

  app.post("/api/conta/sair", (req, res) => { fechar(req, res); res.json({ ok: true }); });
  app.get("/api/conta/eu", exigir, (req, res) => res.set("Cache-Control", "no-store").json(dados(req.cliente)));

  app.put("/api/conta/eu", exigir, (req, res) => {
    const b = req.body ?? {}, c = req.cliente;
    if (b.nome !== undefined) { if (txt(b.nome, 80).length < 2) return erro(res, 400, "Informe seu nome."); c.nome = txt(b.nome, 80); }
    if (b.whatsapp !== undefined) { const w = whatsapp(b.whatsapp); if (!w) return erro(res, 400, "Informe o WhatsApp com DDD."); c.whatsapp = w; }
    if (b.enderecos !== undefined) c.enderecos = lerEnderecos(b.enderecos);
    if (b.favoritos !== undefined) c.favoritos = lerFavoritos(b.favoritos);
    banco.salvar();
    res.json(dados(c));
  });

  app.put("/api/conta/senha", exigir, (req, res) => {
    const c = req.cliente;
    if (!S.conferirSenha(req.body?.atual, c.senhaHash)) return erro(res, 400, "A senha atual não confere.");
    if (String(req.body?.nova ?? "").length < 8) return erro(res, 400, "A nova senha precisa ter pelo menos 8 caracteres.");
    c.senhaHash = S.gerarHashSenha(req.body.nova);
    banco.salvar();
    abrir(req, res, c); // as outras sessões caem; esta continua
    res.json({ ok: true });
  });

  // Esqueci a senha: a resposta é sempre a mesma, exista a conta ou não (não revela e-mails cadastrados).
  app.post("/api/conta/esqueci", a(async (req, res) => {
    const email = txt(req.body?.email, 120).toLowerCase();
    if (!limiteCodigo.registrar(`${S.ipDe(req)}|${email}`).permitido) return erro(res, 429, "Muitos pedidos de código. Espere uma hora.");
    const c = porEmail(email);
    if (c && !(c.recuperacao && agora() - c.recuperacao.em < 2 * MIN)) {
      const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
      c.recuperacao = { hash: hash(`${c.id}|${codigo}`), em: agora(), tentativas: 0 };
      banco.salvar();
      await conectorWaha.enviarTexto({ chatId: c.whatsapp, texto: `CIT shop: seu código para criar uma nova senha é *${codigo}*. Vale por 15 minutos. Se não foi você, ignore esta mensagem.` })
        .catch((e) => log.warn?.(`[conta] código de senha não saiu no WhatsApp (${e.message})`));
    }
    res.json({ ok: true, mensagem: "Se este e-mail tiver conta, enviamos um código para o WhatsApp cadastrado." });
  }));

  app.post("/api/conta/redefinir", (req, res) => {
    const c = porEmail(txt(req.body?.email, 120).toLowerCase()), r = c?.recuperacao;
    const invalido = () => erro(res, 400, "Código inválido ou vencido. Peça outro.");
    if (!r || agora() - r.em > 15 * MIN || r.tentativas >= 5) return invalido();
    if (hash(`${c.id}|${txt(req.body?.codigo, 6)}`) !== r.hash) { r.tentativas++; banco.salvar(); return invalido(); }
    if (String(req.body?.senha ?? "").length < 8) return erro(res, 400, "A nova senha precisa ter pelo menos 8 caracteres.");
    c.senhaHash = S.gerarHashSenha(req.body.senha);
    delete c.recuperacao;
    banco.salvar();
    abrir(req, res, c);
    res.json(dados(c));
  });

  return { clienteDe };
}
