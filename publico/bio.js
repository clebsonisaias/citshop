// Página de links do Instagram (/bio): primeiro os produtos postados no Feed, depois os destaques da vitrine.
// Arquivo externo porque a CSP do site (script-src 'self') bloqueia script inline.
(() => {
  const { esc, brl } = window.CIT;
  const LOJA = { shopee: 'Shopee', amazon: 'Amazon', ml: 'Mercado Livre', 'mercado-livre': 'Mercado Livre', shein: 'SHEIN' };
  const MAX = 24;
  const grid = document.getElementById('produtosBio');
  const input = document.getElementById('buscaInput');
  const aviso = (html) => { grid.innerHTML = `<p class="aviso">${html}</p>`; };
  const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  let todos = [];

  const card = (p) => {
    const desconto = p.precoAntigo > p.preco ? Math.round((1 - p.preco / p.precoAntigo) * 100) : 0;
    const loja = p.loja === 'local' ? (p.lojaNome || 'Loja da região') : (LOJA[p.loja] || 'Loja parceira');
    return `<a href="/p/${encodeURIComponent(p.id)}" class="product-card">
        <img src="${esc(p.fotos?.[0] || '/logo.png')}" alt="" loading="lazy">
        <div class="product-info">
          <span class="store">${p.noFeed ? '<b>No Instagram</b> · ' : ''}Vendido por ${esc(loja)}</span>
          <h3>${esc(p.nome)}</h3>
          <div class="product-prices">
            ${desconto ? `<del>${brl.format(p.precoAntigo)}</del>` : ''}
            <strong>${brl.format(p.preco)}</strong>
            ${desconto >= 5 ? `<span class="off">-${desconto}%</span>` : ''}
          </div>
        </div>
      </a>`;
  };

  function renderizar(lista) {
    if (!lista.length) return aviso('Nenhum produto encontrado com esse nome.');
    grid.innerHTML = lista.slice(0, MAX).map(card).join('');
  }

  Promise.all([json('/api/vitrine'), json('/api/instagram/feed').catch(() => ({ ids: [] }))])
    .then(([vitrine, feed]) => {
      if (!Array.isArray(vitrine.produtos)) throw new Error('resposta inválida');
      const ordem = new Map((feed.ids ?? []).map((id, i) => [id, i]));
      const doFeed = vitrine.produtos.filter((p) => ordem.has(p.id)).sort((a, b) => ordem.get(a.id) - ordem.get(b.id));
      todos = [...doFeed.map((p) => ({ ...p, noFeed: true })), ...vitrine.produtos.filter((p) => !ordem.has(p.id))];
      if (!todos.length) return aviso('Ainda não há ofertas por aqui. <a href="/">Abrir a vitrine</a>');
      renderizar(todos);
    })
    .catch(() => aviso('Não foi possível carregar as ofertas agora. <a href="/">Abrir a vitrine</a>'));

  input.addEventListener('input', () => {
    const termo = input.value.toLowerCase().trim();
    if (!todos.length) return;
    renderizar(termo ? todos.filter((p) => p.nome.toLowerCase().includes(termo) || (p.lojaNome ?? '').toLowerCase().includes(termo)) : todos);
  });
})();
