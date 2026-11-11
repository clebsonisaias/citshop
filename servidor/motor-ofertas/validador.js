/**
 * Validador estrito de qualidade para publicação automática de ofertas.
 * Rejeita ou desativa produtos que não atendam aos critérios de integridade e afiliação.
 */

export function validarLinkAfiliado(link, marketplace) {
  if (!link || typeof link !== "string") return false;
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;

    // Nunca aceita URLs do painel interno de afiliados
    if (u.hostname === "affiliate.shopee.com.br" && u.pathname.includes("/offer/")) return false;

    if (marketplace === "amazon") {
      // Deve ser amazon.com.br com o parâmetro tag presente
      return u.hostname.endsWith("amazon.com.br") && Boolean(u.searchParams.get("tag") || u.searchParams.get("AssociateTag"));
    }

    if (marketplace === "shopee") {
      const dominiosValidos = ["s.shopee.com.br", "shope.ee", "shopee.com.br"];
      const hostValido = dominiosValidos.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
      if (!hostValido) return false;
      if (u.hostname.endsWith("shopee.com.br") && !u.hostname.startsWith("s.")) {
        return Boolean(u.searchParams.get("utm_source")?.startsWith("an_") || u.searchParams.get("smtt"));
      }
      return true;
    }

    if (marketplace === "mercado-livre") {
      const dominiosValidos = ["mercadolivre.com.br", "mercadolibre.com", "mercadolivre.com", "meli.la"];
      const hostValido = dominiosValidos.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
      if (!hostValido) return false;
      if (u.pathname.startsWith("/sec/")) return true;
      return Boolean(u.searchParams.get("matt_tool") || u.searchParams.get("matt_word") || u.searchParams.get("afiliado"));
    }

    // Para outros (ex: manuais com tag ou link parametrizado)
    return true;
  } catch {
    return false;
  }
}

export function validarProduto(produto) {
  const motivos = [];

  if (!produto || typeof produto !== "object") {
    return { valido: false, motivos: ["Objeto de produto inválido"] };
  }

  // 1. Identificador externo
  if (!produto.id || !produto.externalId) {
    motivos.push("Falta identificador externo ou ID");
  }

  // 2. Preço válido (> 0)
  if (!(Number(produto.preco) > 0) || !Number.isFinite(produto.preco)) {
    motivos.push("Preço inválido ou zerado");
  }

  // 3. Imagem válida
  if (!produto.imagem && (!Array.isArray(produto.fotos) || !produto.fotos.length)) {
    motivos.push("Produto sem imagem");
  } else {
    const img = produto.imagem || produto.fotos[0];
    if (typeof img !== "string" || (!img.startsWith("http://") && !img.startsWith("https://") && !img.startsWith("/fotos/"))) {
      motivos.push("URL de imagem inválida");
    }
  }

  // 4. Disponibilidade
  if (produto.disponibilidade === "esgotado" || produto.disponibilidade === "UNAVAILABLE") {
    motivos.push("Produto esgotado ou indisponível");
  }

  // 5. Categoria reconhecida
  if (!produto.categoria && !produto.dept) {
    motivos.push("Categoria não identificada");
  }

  // 6. Atribuição de afiliado confirmada
  if (!validarLinkAfiliado(produto.link, produto.marketplace || produto.loja)) {
    motivos.push("Link sem atribuição de afiliado validada");
  }

  return {
    valido: motivos.length === 0,
    motivos,
  };
}

export function filtrarValidos(produtos = []) {
  const aprovados = [];
  const rejeitados = [];

  for (const p of produtos) {
    const { valido, motivos } = validarProduto(p);
    if (valido) {
      aprovados.push(p);
    } else {
      rejeitados.push({ produto: p, motivos });
    }
  }

  return {
    aprovados,
    rejeitados,
    totalAprovados: aprovados.length,
    totalRejeitados: rejeitados.length,
  };
}
