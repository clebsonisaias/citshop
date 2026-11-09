const normalizar = (texto) => String(texto ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function distanciaUm(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diferencas = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diferencas > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diferencas + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

const campos = (produto) => [
  [normalizar(produto.nome), 6],
  [normalizar(produto.sub), 4],
  [normalizar(produto.lojaNome ?? produto.loja), 3],
  [normalizar(produto.categoriaNome ?? produto.dept), 2],
  [normalizar(produto.descricao), 1],
  [normalizar(produto.cidade), 1],
];

export function pontuarBusca(produto, consulta) {
  const termos = normalizar(consulta).split(" ").filter(Boolean);
  if (!termos.length) return 1;
  const indexados = campos(produto).map(([texto, peso]) => [texto.split(" "), peso]);
  let total = 0;
  for (const termo of termos) {
    let melhor = 0;
    for (const [palavras, peso] of indexados) {
      if (palavras.some((palavra) => palavra === termo)) melhor = Math.max(melhor, peso);
      else if (palavras.some((palavra) => palavra.includes(termo))) melhor = Math.max(melhor, peso * 0.8);
      else if (termo.length >= 5 && palavras.some((palavra) => palavra.length >= 5 && distanciaUm(palavra, termo))) {
        melhor = Math.max(melhor, peso * 0.55);
      }
    }
    if (!melhor) return 0;
    total += melhor;
  }
  return total / termos.length;
}

export function filtrarCatalogo(produtos, filtros = {}) {
  const valorMin = filtros.precoMin === "" || filtros.precoMin == null ? null : Number(filtros.precoMin);
  const valorMax = filtros.precoMax === "" || filtros.precoMax == null ? null : Number(filtros.precoMax);
  const min = Number.isFinite(valorMin) ? valorMin : null;
  const max = Number.isFinite(valorMax) ? valorMax : null;
  let lista = produtos
    .map((produto, indice) => ({ produto, indice, relevancia: pontuarBusca(produto, filtros.q) }))
    .filter(({ produto, relevancia }) => relevancia > 0
      && (!filtros.dept || produto.dept === filtros.dept)
      && (!filtros.origem || produto.loja === filtros.origem)
      && (!filtros.cidade || (produto.loja === "local" && produto.cidade === filtros.cidade))
      && (min == null || produto.preco >= min)
      && (max == null || produto.preco <= max)
      && (!filtros.sub || produto.sub === filtros.sub));

  const sorters = {
    menor: (a, b) => a.produto.preco - b.produto.preco,
    maior: (a, b) => b.produto.preco - a.produto.preco,
    desconto: (a, b) => desconto(b.produto) - desconto(a.produto),
    relevancia: (a, b) => b.relevancia - a.relevancia,
  };
  const ordenar = sorters[filtros.ordem];
  if (ordenar) lista.sort((a, b) => ordenar(a, b) || a.indice - b.indice);
  const locais = lista.filter(({ produto }) => produto.loja === "local");
  const externos = lista.filter(({ produto }) => produto.loja !== "local");
  return [...locais, ...externos].map(({ produto }) => produto);
}

function desconto(produto) {
  return produto.precoAntigo > produto.preco ? (1 - produto.preco / produto.precoAntigo) : 0;
}
