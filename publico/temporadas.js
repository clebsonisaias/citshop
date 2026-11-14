// Datas comemorativas com faixa em destaque na home (e cota própria no ranking de ofertas).
// Cada uma vale de `de` (padrão 1/11) até `ate`, dias inclusive, horário de Brasília. Usado no site e no servidor.
export const TEMPORADAS = [
  {
    id: 'natal', titulo: 'Decoração de Natal', ate: [12, 24],
    nome: /\bnatal(in[oa]s?)?\b|papai noel|pisca.?pisca|guirlanda|pres[eé]pio/i,
    buscas: ['decoracao de natal', 'arvore de natal', 'pisca pisca natal', 'enfeite natal', 'guirlanda natal', 'papai noel decoracao', 'toalha de mesa natal',
      'bola de natal', 'cascata de luz natal', 'presepio', 'meia de natal', 'lembrancinha de natal'],
  },
  {
    // Mesa posta para as ceias: louça, taças, sousplat, guardanapos e decoração de mesa.
    id: 'mesa', titulo: 'Mesa posta de fim de ano', ate: [1, 1], categoria: 'cozinha',
    nome: /sousplat|jogo americano|guardanapo|argolas? (de|para) guardanapo|aparelho de jantar|jogo de pratos|pratos? (raso|fundo|de sobremesa|de porcelana|de cer[aâ]mica)|\bta[cç]as?\b|jogo de copos|copos? de cristal|centro de mesa|toalha de mesa|casti[cç]al|velas? (decorativ|arom)|arranjo|faqueiro|jogo de talheres/i,
    buscas: ['sousplat', 'jogo americano', 'guardanapo de tecido', 'argola guardanapo', 'aparelho de jantar', 'jogo de tacas', 'centro de mesa', 'castical', 'faqueiro'],
  },
  {
    // Formaturas, Natal, confraternizações e réveillon: roupa branca, vermelha e amarela.
    id: 'looks', titulo: 'Looks de fim de ano', ate: [1, 1], categoria: 'moda',
    nome: /\b(vestidos?|blusas?|camisas?|camisetas?|conjuntos?|saias?|macac[aã]o|macaquinho|cropped|body|shorts?|cal[cç]as?|blazer|terno|bermudas?|regatas?)\b.*\b(branc|vermelh|amarel|off.?white)|formatura|confraterniza/i,
    // SHEIN é loja de roupa: toda peça dela entra nos looks, mesmo sem a cor no nome.
    porLoja: { shein: /\b(vestidos?|blusas?|conjuntos?|saias?|macac[aã]o|macaquinho|cropped|body|camisas?|shorts?|cal[cç]as?|blazer)\b/i },
    buscas: ['vestido branco reveillon', 'vestido vermelho festa', 'vestido amarelo', 'conjunto branco feminino', 'camisa branca masculina', 'vestido formatura', 'camisa social vermelha', 'saia amarela',
      'vestido vermelho natal', 'conjunto branco reveillon', 'vestido amarelo reveillon', 'blusa vermelha natal'],
  },
  {
    id: 'anonovo', titulo: 'Réveillon e Ano Novo', ate: [1, 1],
    nome: /ano novo|r[eé]veillon|ta[cç]as? (de )?(champanhe|espumante|cristal)|champanheira|balde de gelo|fogos de artif|confete/i,
    buscas: ['decoracao reveillon', 'taca champanhe', 'balde de gelo', 'kit reveillon', 'confete festa'],
  },
  {
    // A partir de 1/1 o foco vira a volta às aulas (mochila, estojo, caderno, kit escolar, organização).
    id: 'aulas', titulo: 'Volta às aulas', de: [1, 1], ate: [2, 28], categoria: 'papel',
    nome: /mochila|estojo|caderno|agenda (escolar|\d{4})|kit escolar|material escolar|lancheira|lápis de cor|lapis de cor|canetinha|marca.?texto|apontador|borracha escolar|fich[aá]rio|organizador de mesa|porta.?l[aá]pis|garrafinha escolar/i,
    buscas: ['mochila escolar', 'estojo escolar', 'caderno universitario', 'agenda 2027', 'kit material escolar', 'lancheira termica', 'organizador de mesa escritorio', 'marca texto pastel'],
  },
];

/** Temporadas em vigor no momento t (ms). Datas como mês*100+dia; se o início é depois do fim, atravessa a virada do ano. */
export function temporadasAtivas(t = Date.now()) {
  const b = new Date(t - 3 * 3600_000), hoje = (b.getUTCMonth() + 1) * 100 + b.getUTCDate();
  return TEMPORADAS.filter(({ de = [11, 1], ate }) => {
    const ini = de[0] * 100 + de[1], fim = ate[0] * 100 + ate[1];
    return ini <= fim ? hoje >= ini && hoje <= fim : hoje >= ini || hoje <= fim;
  });
}

/** O produto entra na temporada `s`? Pelo nome, ou pela regra própria da loja (ex.: roupa da SHEIN nos looks). */
export const combina = (s, p) => s.nome.test(p.nome ?? '') || Boolean(s.porLoja?.[p.loja]?.test(p.nome ?? ''));
/** Id da temporada ativa a que o produto pertence, ou null. */
export const temporadaDo = (p, ativas) => ativas.find((s) => combina(s, p))?.id ?? null;
/** Lojas em foco nas temporadas: vêm primeiro nas faixas e no post diário. */
export const FOCO_TEMPORADA = ['shopee', 'shein'];
