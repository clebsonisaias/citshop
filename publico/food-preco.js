// CITshop Food · motor universal de personalização (o mesmo arquivo roda no servidor e no navegador).
// O restaurante define as regras; aqui só se aplicam. Valores em CENTAVOS inteiros (sem erro de ponto flutuante).
//
// Item:     { id, nome, preco (R$), ativo, estoque|null, datas: ["AAAA-MM-DD"], horario: {de, ate}|null,
//             variacoes: [Variacao], grupos: [Grupo] }
// Variacao: { id, nome, preco (R$), ativo, grupos: { [grupoId]: { ativo, min, max, precos: { [opcaoId]: R$ } } } }
//           (sobrescreve só o que mudar; o resto vem do grupo)
// Grupo:    { id, nome, descricao, tipo: "escolha"|"remover", min, max, regra: "soma"|"maior"|"media",
//             incluidas (unidades sem custo), estacao, ativo, opcoes: [Opcao] }
// Opcao:    { id, nome, preco (R$), ativo, maxQtd (padrão 1), estoque|null, datas: ["AAAA-MM-DD"] }
// Seleção:  { variacaoId, escolhas: { [grupoId]: { [opcaoId]: qtd } } }  (lista de ids também vale: qtd 1)

export const centavos = (r) => Math.round(Number(r || 0) * 100);
export const reais = (c) => c / 100;
const minutosDe = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Vale na data/hora? `datas` vazia = todo dia; horário opcional (pode passar da meia-noite). quando = { data, minutos }. */
export function disponivelEm(x, quando) {
  if (!x || x.ativo === false) return false;
  if (Array.isArray(x.datas) && x.datas.length && quando?.data && !x.datas.includes(quando.data)) return false;
  if (x.horario && quando?.minutos != null) {
    const de = minutosDe(x.horario.de), ate = minutosDe(x.horario.ate), m = quando.minutos;
    if (de != null && ate != null && !(de < ate ? m >= de && m < ate : m >= de || m < ate)) return false;
  }
  return true;
}

/** Grupos que valem para a variação escolhida, com limites e preços já sobrescritos. */
export function gruposEfetivos(item, variacao, quando) {
  return (item.grupos ?? []).filter((g) => g.ativo !== false).map((g) => {
    const v = variacao?.grupos?.[g.id] ?? {};
    if (v.ativo === false) return null;
    const opcoes = g.opcoes.map((o) => ({ ...o, preco: v.precos?.[o.id] ?? o.preco, disponivel: disponivelEm(o, quando) && (o.estoque == null || o.estoque > 0) }));
    return { ...g, min: v.min ?? g.min ?? 0, max: v.max ?? g.max ?? 1, opcoes };
  }).filter(Boolean);
}

const normalizar = (sel) => {
  if (Array.isArray(sel)) return Object.fromEntries(sel.map((id) => [String(id), 1]));
  if (sel && typeof sel === "object") return Object.fromEntries(Object.entries(sel).map(([k, q]) => [k, Math.floor(Number(q) || 0)]).filter(([, q]) => q > 0));
  return {};
};

/** Preço do grupo em centavos conforme a regra que o restaurante escolheu. unidades = lista de preços (centavos). */
export function precoGrupo(g, unidades) {
  if (!unidades.length) return 0;
  if (g.regra === "maior") return Math.max(...unidades); // ex.: pizza de 2 sabores pelo mais caro
  if (g.regra === "media") return Math.round(unidades.reduce((s, c) => s + c, 0) / unidades.length);
  const ordenadas = [...unidades].sort((a, b) => b - a); // "soma": as N incluídas saem de graça (as mais caras)
  return ordenadas.slice(Math.max(0, g.incluidas ?? 0)).reduce((s, c) => s + c, 0);
}

/**
 * Valida a seleção e calcula UMA unidade do item. Tudo que vem do aparelho é conferido aqui:
 * variação do item, grupo da configuração, opção do grupo, mínimo/máximo, limite por opção, disponibilidade.
 * Devolve { erro } ou { variacao, baseC, adicionaisC, unitarioC, opcoes: [retrato], consumo: {opcaoId: qtd} }.
 */
export function calcularItem(item, selecao = {}, quando = {}) {
  if (!disponivelEm(item, quando)) return { erro: `${item.nome} não está disponível agora.` };
  if (item.estoque != null && item.estoque <= 0) return { erro: `${item.nome} esgotou.` };
  const variacoes = (item.variacoes ?? []).filter((v) => v.ativo !== false);
  let variacao = null;
  if ((item.variacoes ?? []).length) {
    variacao = variacoes.find((v) => v.id === String(selecao.variacaoId ?? ""));
    if (!variacao) return { erro: `Escolha o tamanho/opção de ${item.nome}.` };
  } else if (selecao.variacaoId) return { erro: `Uma opção de ${item.nome} não está mais disponível. Escolha de novo.` };
  const grupos = gruposEfetivos(item, variacao, quando);
  const escolhas = selecao.escolhas ?? {};
  if (Object.keys(escolhas).some((k) => !grupos.some((g) => g.id === k))) return { erro: `Uma opção de ${item.nome} não está mais disponível. Escolha de novo.` };
  const baseC = centavos(variacao ? variacao.preco : item.preco);
  let adicionaisC = 0;
  const opcoes = [], consumo = {};
  for (const g of grupos) {
    const sel = normalizar(escolhas[g.id]);
    let unidades = [], total = 0;
    for (const [idOp, qtd] of Object.entries(sel)) {
      const o = g.opcoes.find((x) => x.id === idOp);
      if (!o || !o.disponivel) return { erro: `${o ? o.nome : "Uma opção"} de ${item.nome} não está disponível agora. Escolha de novo.` };
      if (qtd > Math.max(1, o.maxQtd ?? 1)) return { erro: `No máximo ${Math.max(1, o.maxQtd ?? 1)} de ${o.nome}.` };
      total += qtd;
      unidades = unidades.concat(Array(qtd).fill(centavos(o.preco)));
      opcoes.push({ grupoId: g.id, grupo: g.nome, tipo: g.tipo ?? "escolha", estacao: g.estacao ?? null, id: o.id, nome: o.nome, qtd, preco: o.preco });
      if (o.estoque != null) consumo[o.id] = (consumo[o.id] ?? 0) + qtd;
    }
    if (total < g.min) return { erro: g.min === 1 ? `Escolha ${g.nome.toLowerCase()} de ${item.nome}.` : `Escolha pelo menos ${g.min} em ${g.nome} de ${item.nome}.` };
    if (total > g.max) return { erro: `Escolha no máximo ${g.max} em ${g.nome} de ${item.nome}.` };
    const cobrado = precoGrupo(g, unidades);
    adicionaisC += cobrado;
    for (const o of opcoes.filter((x) => x.grupoId === g.id)) o.cobradoGrupoC = cobrado;
  }
  return { variacao: variacao ? { id: variacao.id, nome: variacao.nome } : null, baseC, adicionaisC, unitarioC: baseC + adicionaisC, opcoes, consumo };
}

/** "A partir de": menor preço possível (variação mais barata + mínimos obrigatórios mais baratos), para a vitrine. */
export function precoMinimo(item, quando) {
  const variacoes = (item.variacoes ?? []).filter((v) => v.ativo !== false);
  const candidatos = variacoes.length ? variacoes : [null];
  return Math.min(...candidatos.map((v) => centavos(v ? v.preco : item.preco) + gruposEfetivos(item, v, quando).reduce((s, g) => {
    if (!g.min) return s;
    const precos = g.opcoes.filter((o) => o.disponivel).map((o) => centavos(o.preco)).sort((a, b) => a - b);
    return s + precoGrupo(g, precos.slice(0, g.min));
  }, 0)));
}
