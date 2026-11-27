// Regras puras da Black Friday e descontos progressivos no carrinho.
// Módulo compartilhado entre o front-end (vitrine/carrinho) e o servidor (pedidos/checkout).

const BRT_MS = 3 * 60 * 60 * 1000;
const HORA_MS = 3_600_000;

/** Percentual de desconto anunciado (precoAntigo -> preco). */
export const pctOff = (p) => (p?.precoAntigo > p?.preco ? Math.round((1 - p.preco / p.precoAntigo) * 100) : 0);

/** Percentual de queda registrada no histórico recente. */
export const pctQueda = (p) => (p?.queda > 0 ? Math.round((p.queda / (p.preco + p.queda)) * 100) : 0);

/** Maior desconto real comprovado (anunciado ou queda histórica). */
export const melhorDesconto = (p) => Math.max(pctOff(p), pctQueda(p));

/** Produto elegível para a vitrine de Black Friday (tem desconto, queda ou menor preço em 30 dias). */
export const ehOfertaBlack = (p) => !p?.soBusca && (melhorDesconto(p) > 0 || Boolean(p?.menor30));

/** Produto tem selo de frete grátis na vitrine. */
export const temFreteGratis = (p) => Boolean(p?.freteGratis || p?.preco >= 79 || p?.loja === "local" || /frete gr[aá]tis/i.test(p?.nome ?? ""));

/**
 * Calcula tempo restante até `fimMs` em dias, horas, minutos e segundos.
 */
export function tempoRestante(fimMs, agora = Date.now()) {
  const diff = Math.max(0, Math.floor((fimMs - agora) / 1000));
  if (diff <= 0) return { dias: 0, horas: 0, minutos: 0, segundos: 0, encerrado: true };
  const dias = Math.floor(diff / 86400);
  const horas = Math.floor((diff % 86400) / 3600);
  const minutos = Math.floor((diff % 3600) / 60);
  const segundos = diff % 60;
  return { dias, horas, minutos, segundos, encerrado: false };
}

/** Milissegundos até a próxima virada de hora cheia (rodada de Ofertas Relâmpago). */
export function proximaRodadaMs(agora = Date.now()) {
  const resto = agora % HORA_MS;
  return resto === 0 ? HORA_MS : HORA_MS - resto;
}

/** Hash determinístico simples (FNV-1a 32-bit) para rotacionar Ofertas Relâmpago por hora sem aleatoriedade instável. */
function hashHora(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Seleciona até `limite` Ofertas Relâmpago determinísticas para a hora atual (Brasília).
 * Mistura até 2 produtos de lojas locais com desconto + os melhores descontos/quedas dos marketplaces,
 * garantindo variedade de departamentos e rotação real a cada virada de hora.
 */
export function selecionarRelampago(produtos = [], agora = Date.now(), limite = 8) {
  const b = new Date(agora - BRT_MS);
  const chaveHora = `${b.getUTCFullYear()}-${b.getUTCMonth() + 1}-${b.getUTCDate()}-${b.getUTCHours()}`;
  const validos = produtos.filter(ehOfertaBlack);
  if (!validos.length) return [];

  const locais = validos.filter((p) => p.loja === "local");
  const fortes = validos.filter((p) => p.loja !== "local" && (melhorDesconto(p) >= 25 || p.menor30 || p.queda > 0));
  const pool = fortes.length >= limite ? fortes : validos.filter((p) => p.loja !== "local");

  const ordenarPorHora = (lista) => [...lista].sort((a, bItem) => {
    const scoreA = melhorDesconto(a) + (a.menor30 ? 12 : 0) + (a.queda > 0 ? 8 : 0);
    const scoreB = melhorDesconto(bItem) + (bItem.menor30 ? 12 : 0) + (bItem.queda > 0 ? 8 : 0);
    // Agrupa em faixas de 15 pontos de desconto para manter qualidade alta e rotacionar dentro da faixa a cada hora
    const faixaA = Math.floor(scoreA / 15), faixaB = Math.floor(scoreB / 15);
    if (faixaB !== faixaA) return faixaB - faixaA;
    return hashHora(`${chaveHora}:${a.id}`) - hashHora(`${chaveHora}:${bItem.id}`);
  });

  const escolhidos = [];
  const usados = new Set();
  const porDept = new Map();
  const adicionar = (p, maxDept = 2) => {
    if (!p || usados.has(p.id)) return false;
    const dept = p.dept || "casa";
    if ((porDept.get(dept) ?? 0) >= maxDept) return false;
    escolhidos.push(p);
    usados.add(p.id);
    porDept.set(dept, (porDept.get(dept) ?? 0) + 1);
    return true;
  };

  // Até 2 destaques de lojas locais em oferta (rotacionados por hora)
  const locaisOrd = [...locais].sort((a, bItem) => hashHora(`${chaveHora}:${a.id}`) - hashHora(`${chaveHora}:${bItem.id}`));
  for (const p of locaisOrd) {
    if (escolhidos.length >= Math.min(2, limite)) break;
    adicionar(p, 2);
  }

  // Completa com os melhores descontos dos marketplaces respeitando diversidade de departamentos
  const poolOrd = ordenarPorHora(pool);
  for (const p of poolOrd) {
    if (escolhidos.length >= limite) break;
    adicionar(p, 2);
  }
  // Se ainda faltar vaga (catálogo pequeno), relaxa o limite por departamento
  if (escolhidos.length < limite) {
    for (const p of [...poolOrd, ...locaisOrd]) {
      if (escolhidos.length >= limite) break;
      adicionar(p, limite);
    }
  }
  return escolhidos;
}

/** Estatísticas reais calculadas diretamente do catálogo para o cabeçalho da Black Friday. */
export function resumoBlackFriday(produtos = []) {
  const ofertas = produtos.filter(ehOfertaBlack);
  let com40Off = 0, menor30 = 0, locais = 0, maiorOff = 0;
  for (const p of ofertas) {
    const m = melhorDesconto(p);
    if (m > maiorOff) maiorOff = m;
    if (m >= 40) com40Off++;
    if (p.menor30) menor30++;
    if (p.loja === "local") locais++;
  }
  return { total: ofertas.length, com40Off, menor30, locais, maiorOff };
}

/** Filtros rápidos e kits temáticos da página /black-friday. */
export const FILTROS_BF = [
  { id: "todas", rotulo: "Todas da Black", testar: () => true },
  { id: "relampago", rotulo: "Relâmpago da hora", testar: (p, ctx) => Boolean(ctx?.relampagoIds?.has(p.id)) },
  { id: "off40", rotulo: "40% OFF ou mais", testar: (p) => melhorDesconto(p) >= 40 },
  { id: "menor30", rotulo: "Menor preço em 30 dias", testar: (p) => Boolean(p.menor30) },
  { id: "local", rotulo: "Lojas da cidade", testar: (p) => p.loja === "local" },
  { id: "frete", rotulo: "Frete grátis", testar: (p) => temFreteGratis(p) },
  { id: "ate50", rotulo: "Até R$ 50", testar: (p) => p.preco <= 50 },
  { id: "ate100", rotulo: "Até R$ 100", testar: (p) => p.preco <= 100 },
  { id: "kit-casa", rotulo: "Kit Casa & Cozinha", testar: (p) => ["casa", "cozinha", "eletro", "cama"].includes(p.dept) },
  { id: "kit-tech", rotulo: "Kit Tech & Games", testar: (p) => ["tec", "cel", "info", "games"].includes(p.dept) },
  { id: "kit-moda", rotulo: "Kit Moda & Beleza", testar: (p) => ["moda", "calc", "beleza"].includes(p.dept) },
  { id: "kit-presentes", rotulo: "Kit Presentes & Natal", testar: (p) => ["brinq", "livros"].includes(p.dept) || /\bnatal|presente|kit\b/i.test(p.nome ?? "") },
];

/**
 * Desconto escalonado (progressivo) no carrinho de lojas locais.
 * `faixas`: [{ acima: 100, pct: 10 }, { acima: 250, pct: 20 }].
 * Devolve a melhor faixa atingida, o valor descontado, o total final e quanto falta para a próxima faixa.
 */
export function descontoProgressivo(subtotal, faixas = []) {
  const sub = Math.max(0, Math.round(Number(subtotal || 0) * 100) / 100);
  const ordenadas = (Array.isArray(faixas) ? faixas : [])
    .filter((f) => Number(f?.acima) > 0 && Number(f?.pct) > 0 && Number(f?.pct) <= 70)
    .map((f) => ({ acima: Math.round(Number(f.acima) * 100) / 100, pct: Math.round(Number(f.pct)) }))
    .sort((a, b) => a.acima - b.acima);

  let aplicada = null;
  for (const f of ordenadas) {
    if (sub >= f.acima) aplicada = f;
  }
  const proxima = ordenadas.find((f) => sub < f.acima) ?? null;
  const pct = aplicada ? aplicada.pct : 0;
  const valor = pct ? Math.round(sub * (pct / 100) * 100) / 100 : 0;
  const totalComDesconto = Math.max(0, Math.round((sub - valor) * 100) / 100);
  const falta = proxima ? Math.max(0, Math.round((proxima.acima - sub) * 100) / 100) : 0;
  return { pct, valor, totalComDesconto, faixaAplicada: aplicada, proximaFaixa: proxima, falta, faixas: ordenadas };
}
