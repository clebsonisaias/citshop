/**
 * Deduplicador de produtos para impedir ofertas duplicadas na vitrine.
 */

function simplificarTexto(txt) {
  return String(txt || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 50);
}

export function deduplicarProdutos(produtos = []) {
  const vistosId = new Set();
  const vistosChave = new Set();
  const vistosTitulos = new Set();
  const unicos = [];
  const duplicados = [];

  for (const p of produtos) {
    if (!p || !p.id) continue;

    // 1. Chave exata de ID
    if (vistosId.has(p.id)) {
      duplicados.push({ produto: p, motivo: "ID duplicado" });
      continue;
    }

    // 2. Chave de marketplace + externalId
    const chaveExterna = `${p.marketplace || p.loja}:${p.externalId || p.asin || p.id}`;
    if (vistosChave.has(chaveExterna)) {
      duplicados.push({ produto: p, motivo: "Identificador externo duplicado" });
      continue;
    }

    // 3. Similaridade forte de título dentro da mesma loja
    const chaveTitulo = `${p.marketplace || p.loja}:${simplificarTexto(p.nome)}`;
    if (vistosTitulos.has(chaveTitulo)) {
      duplicados.push({ produto: p, motivo: "Título equivalente na mesma loja" });
      continue;
    }

    vistosId.add(p.id);
    vistosChave.add(chaveExterna);
    vistosTitulos.add(chaveTitulo);
    unicos.push(p);
  }

  return {
    produtos: unicos,
    duplicados,
    totalRemovidos: duplicados.length,
  };
}
