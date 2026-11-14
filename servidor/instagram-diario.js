// Instagram @citshopping: postagem diária programada e conexão com token que não vence.
// - Horários do dia (Brasília) definidos no admin; em cada um sai 1 post no Feed (e, se ligado, 1 Story).
// - Escolha automática: alterna produto de loja da cidade e a melhor oferta de afiliado; não repete produto em 14 dias.
// - Token: o que o admin cola é trocado por um token de Página derivado de token longo (não vence), quando possível.

import { pontuarBusca } from "../publico/catalogo.js";

const DIA = 24 * 60 * 60 * 1000;
export const HORARIOS_PADRAO = ["11:00", "19:00"];
const minutosDe = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Data e minuto em Brasília (UTC-3, sem horário de verão). */
export const brasilia = (t) => { const d = new Date(t - 3 * 3600_000); return { data: d.toISOString().slice(0, 10), minutos: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
export const lerHorarios = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).filter((h) => minutosDe(h) != null))].sort().slice(0, 6);

/** Qual horário do dia está na vez (passou do horário há no máximo 3 h e ainda não saiu). null se nenhum. */
export function horarioDaVez(horarios, feitos, t) {
  const { data, minutos } = brasilia(t);
  return horarios.map((h) => ({ h, m: minutosDe(h) })).filter(({ h, m }) => minutos >= m && minutos - m <= 180 && !feitos[`${data}|${h}`])
    .map(({ h }) => `${data}|${h}`)[0] ?? null;
}

/** Nota de uma oferta de afiliado para o post: desconto real, queda de preço, menor preço em 30 dias, vendas e nota. */
const notaOferta = (p) => (p.precoAntigo > p.preco ? (1 - p.preco / p.precoAntigo) * 100 : 0) + (p.queda ? 15 : 0) + (p.menor30 ? 20 : 0) + Math.min(10, Math.log10((p.vendidos || 0) + 1) * 3) + (p.nota || 0);

// Sinônimos simples para quem busca coisa de criança (ex.: "roupinha de menina" também acha os laços infantis).
const SINONIMOS = { menina: ["infantil", "laco", "tiara"], menino: ["infantil"], crianca: ["infantil"], infantil: ["crianca"], bebe: ["infantil", "rn"], roupinha: ["infantil"], celular: ["smartphone"], smartphone: ["celular"] };
// Pontos do produto para a busca: cada palavra (ou um sinônimo dela) que aparece soma. Diferente da busca do site, não
// exige todas as palavras ("roupinha de menina" acha o laço infantil pelo "menina"); mais palavras batendo = mais pontos.
const pontosBusca = (p, palavras) => palavras.reduce((soma, w) => soma + Math.max(pontuarBusca(p, w), ...(SINONIMOS[w] ?? []).map((s) => pontuarBusca(p, s) * 0.8)), 0);

/**
 * Pelo que mais buscaram no site: para o termo mais buscado (2+ buscas) que não virou post nos últimos 3 dias, o
 * produto que melhor responde a ele — loja da cidade primeiro, se tiver; senão a melhor oferta. { produto, termo } ou null.
 */
export function escolherPelaBusca(produtos, historico, buscas, t) {
  const recentes = new Set(historico.filter((h) => h.ok && t - Date.parse(h.em) < 14 * DIA).map((h) => h.produtoId));
  const termosRecentes = new Set(historico.filter((h) => h.ok && h.termo && t - Date.parse(h.em) < 3 * DIA).map((h) => h.termo));
  const ok = produtos.filter((p) => p.fotos?.length && !recentes.has(p.id) && p.preco > 0);
  for (const b of buscas.filter((x) => x.n >= 2 && x.palavras.length && !termosRecentes.has(x.termo))) {
    const com = ok.map((p) => ({ p, s: pontosBusca(p, b.palavras) })).filter((x) => x.s > 0);
    if (!com.length) continue;
    const ordem = (a, c) => c.s - a.s || (c.p.comissao ?? 0) - (a.p.comissao ?? 0) || notaOferta(c.p) - notaOferta(a.p);
    const local = com.filter((x) => x.p.loja === "local").sort(ordem)[0];
    return { produto: (local ?? com.sort(ordem)[0]).p, termo: b.termo };
  }
  return null;
}

/**
 * Escolhe o produto do horário. Pares: loja da cidade (a que postou há mais tempo); ímpares: oferta de afiliado de maior comissão.
 * Se faltar um tipo, usa o outro. Só produto com foto e sem post nos últimos 14 dias.
 */
export function escolherProduto(produtos, historico, indiceSlot, t) {
  const recentes = new Set(historico.filter((h) => h.ok && t - Date.parse(h.em) < 14 * DIA).map((h) => h.produtoId));
  const ok = produtos.filter((p) => p.fotos?.length && !recentes.has(p.id) && p.preco > 0);
  const locais = ok.filter((p) => p.loja === "local"), afiliados = ok.filter((p) => p.loja !== "local");
  const ultimaVezLoja = (slug) => Math.max(0, ...historico.filter((h) => h.ok && h.lojaSlug === slug).map((h) => Date.parse(h.em)));
  const melhorLocal = () => [...locais].sort((a, b) => ultimaVezLoja(a.lojaSlug) - ultimaVezLoja(b.lojaSlug) || (b.precoAntigo > b.preco) - (a.precoAntigo > a.preco))[0];
  // Oferta de afiliado: na temporada, produto de fim de ano da Shopee/SHEIN (p.foco) primeiro, alternando a loja
  // que postou há mais tempo; depois a que paga mais comissão por venda (p.comissao, R$); empate, a melhor oferta.
  const ultimaVezDaLoja = (loja) => Math.max(0, ...historico.filter((h) => h.ok && String(h.produtoId ?? "").startsWith(`${loja}-`)).map((h) => Date.parse(h.em)));
  const melhorAfiliado = () => [...afiliados].sort((a, b) => (b.foco === true) - (a.foco === true)
    || (a.foco ? ultimaVezDaLoja(a.loja) - ultimaVezDaLoja(b.loja) : 0)
    || (b.comissao ?? 0) - (a.comissao ?? 0) || notaOferta(b) - notaOferta(a))[0];
  const escolhido = indiceSlot % 2 === 0 ? melhorLocal() ?? melhorAfiliado() : melhorAfiliado() ?? melhorLocal();
  if (escolhido) return escolhido;
  // Todo dia tem post: se tudo já saiu nos últimos 14 dias, repete o que foi postado há mais tempo.
  const ultimaVez = (id) => Math.max(0, ...historico.filter((h) => h.ok && h.produtoId === id).map((h) => Date.parse(h.em)));
  return produtos.filter((p) => p.fotos?.length && p.preco > 0).sort((a, b) => ultimaVez(a.id) - ultimaVez(b.id))[0] ?? null;
}

/**
 * Prepara o token colado no admin: confere na Meta e, se for token de usuário que vence, troca por um longo
 * (precisa do App Secret) e pega o token da Página ligada à conta do Instagram, que não vence.
 * Devolve { token, expiraEm (ISO ou null = não vence), tipo } ou lança erro com a mensagem da Meta.
 */
export async function prepararToken({ token, accountId, appSecret, fetchImpl = fetch, graph = "https://graph.facebook.com/v21.0" }) {
  const get = async (url) => {
    const r = await fetchImpl(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error?.message || `Meta respondeu ${r.status}`);
    return d;
  };
  const info = async (t) => (await get(`${graph}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`)).data ?? {};
  const i = await info(token);
  if (i.is_valid === false) throw new Error("Este token não é válido (vencido ou revogado). Gere outro na Meta.");
  const expira = (x) => (x.expires_at ? new Date(x.expires_at * 1000).toISOString() : null);
  if (i.type === "PAGE" || !i.expires_at) return { token, expiraEm: expira(i), tipo: i.type ?? "desconhecido" };
  // Com o App Secret, troca por token longo (60 dias). Sem ele, segue com o token colado (o "Estender" do depurador da
  // Meta já dá um de 60 dias). Em seguida pega o token da Página: vindo de um token longo, ele não vence.
  const longo = appSecret && i.app_id
    ? (await get(`${graph}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(i.app_id)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`)).access_token
    : token;
  if (!longo) throw new Error("A Meta não devolveu o token longo.");
  try {
    const paginas = (await get(`${graph}/me/accounts?fields=access_token,instagram_business_account&access_token=${encodeURIComponent(longo)}`)).data ?? [];
    const pagina = paginas.find((p) => p.instagram_business_account?.id === String(accountId));
    if (pagina?.access_token) return { token: pagina.access_token, expiraEm: expira(await info(pagina.access_token)), tipo: "PAGE" };
  } catch { /* sem permissão de páginas: fica com o token longo de usuário (60 dias) */ }
  return { token: longo, expiraEm: expira(await info(longo)), tipo: "USER" };
}

/** Tira segredos de uma configuração antes de mandar para o navegador. */
export function semSegredos(cfg) {
  const c = JSON.parse(JSON.stringify(cfg ?? {}));
  const tapar = (o, k) => { if (o?.[k]) o[k] = `••••${String(o[k]).slice(-4)}`; };
  for (const k of ["accessToken", "userAccessToken", "pageAccessToken"]) tapar(c.instagram, k);
  tapar(c.telegram, "botToken");
  return c;
}
export const pareceTapado = (v) => typeof v === "string" && v.startsWith("••••");
