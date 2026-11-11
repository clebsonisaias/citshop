/**
 * Motor de ranking de ofertas: calcula pontuação de relevância comercial e qualidade.
 * Classifica e limita produtos por categoria para garantir uma vitrine atrativa.
 */

export function calcularScore(produto) {
  let score = 0;

  // 0. Curadoria editorial / Destaque manual ou Super Oferta 11.11
  if (produto.destaque || produto.fixo) score += 30;
  if (produto.selo === "11.11" || produto.superOferta) score += 20;

  // 1. Desconto real comprovado (até 40 pontos)
  if (produto.precoAntigo && produto.precoAntigo > produto.preco) {
    const descPct = Math.min(70, Math.round(((produto.precoAntigo - produto.preco) / produto.precoAntigo) * 100));
    score += descPct * 0.5; // ex: 50% de desconto dá 25 pontos
  }

  // 2. Selos históricos de queda e menor preço em 30 dias (até 25 pontos)
  if (produto.menor30) score += 15;
  if (produto.queda && produto.queda > 0) score += 10;

  // 3. Rentabilidade de comissão (até 20 pontos)
  if (produto.comissaoPct) {
    score += Math.min(15, produto.comissaoPct * 0.5);
  }
  if (produto.comissaoEstimada && produto.comissaoEstimada > 10) {
    score += Math.min(5, Math.round(produto.comissaoEstimada / 5));
  }

  // 4. Volume de vendas e avaliação (até 15 pontos)
  if (produto.nota >= 4.5) score += 8;
  else if (produto.nota >= 4.0) score += 4;

  if (produto.vendidos >= 1000) score += 7;
  else if (produto.vendidos >= 100) score += 3;

  return Math.round(score * 10) / 10;
}

/**
 * Ordena e aplica limites de ofertas por categoria e total geral com representatividade justa.
 */
export function ranquearOfertas(produtos = [], { limitePorCategoria = 25, limiteTotal = 400 } = {}) {
  const comScore = produtos.map((p) => ({
    ...p,
    score: calcularScore(p),
  }));

  // Ordena decrescente por score
  comScore.sort((a, b) => b.score - a.score || a.preco - b.preco);

  // Garantir representatividade justa para cada marketplace ativo (Shopee, Mercado Livre, SHEIN)
  const selecionados = [];
  const selecionadosIds = new Set();
  const contagemPorCat = new Map();
  const marketplaces = ["shopee", "mercado-livre", "shein"];
  const cotaPorMp = { shopee: 350, "mercado-livre": 30, shein: 30 };

  for (const mp of marketplaces) {
    let countMp = 0;
    const maxMp = cotaPorMp[mp] || 25;
    for (const p of comScore) {
      if ((p.marketplace || p.loja) !== mp) continue;
      if (selecionadosIds.has(p.id)) continue;
      const cat = p.categoria || p.dept || "casa";
      const qtdCat = contagemPorCat.get(cat) || 0;
      if (qtdCat < limitePorCategoria && countMp < maxMp) {
        selecionados.push(p);
        selecionadosIds.add(p.id);
        contagemPorCat.set(cat, qtdCat + 1);
        countMp++;
      }
    }
  }

  // Preenche as vagas restantes até limiteTotal respeitando limitePorCategoria
  for (const p of comScore) {
    if (selecionadosIds.has(p.id)) continue;
    const cat = p.categoria || p.dept || "casa";
    const qtdCat = contagemPorCat.get(cat) || 0;
    if (qtdCat < limitePorCategoria) {
      selecionados.push(p);
      selecionadosIds.add(p.id);
      contagemPorCat.set(cat, qtdCat + 1);
    }
    if (selecionados.length >= limiteTotal) break;
  }

  return selecionados;
}
