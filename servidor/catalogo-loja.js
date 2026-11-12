/**
 * Catálogo de loja parceira versionado no repositório (servidor/catalogos/<slug>.json, fotos em publico/<pasta>/).
 * Aplicado uma vez por versão ao subir o servidor: troca só os produtos da loja que vieram do catálogo
 * (fotos estáticas do site, "/..." fora de /uploads). O que a loja cadastrar pelo painel fica intacto.
 */
export function aplicarCatalogo(banco, catalogo, criadoEm) {
  const loja = banco.lojaPorSlug(catalogo.loja);
  banco.d.catalogos ??= {};
  if (!loja || banco.d.catalogos[catalogo.loja] === catalogo.versao) return false;
  const doCatalogo = (p) => p.lojaId === loja.id && p.fotos?.length && p.fotos.every((f) => f.startsWith("/") && !f.startsWith("/uploads/"));
  const base = Date.parse(criadoEm);
  // criadoEm decrescente: a vitrine ordena do mais novo ao mais antigo, então fica a ordem do catálogo.
  const novos = catalogo.produtos.map((p, i) => ({
    ...p, lojaId: loja.id, ativo: true, bloqueado: false, criadoEm: new Date(base - i * 1000).toISOString(),
  }));
  banco.d.produtos = [...banco.produtos.filter((p) => !doCatalogo(p)), ...novos];
  banco.d.catalogos[catalogo.loja] = catalogo.versao;
  banco.salvar();
  return true;
}
