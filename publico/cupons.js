// Página /cupons: lista os cupons válidos (admin cadastra os das lojas parceiras, lojas locais os delas).
(() => {
  const { esc } = window.CIT;
  const lista = document.getElementById('cupons');
  const data = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR');
  fetch('/api/cupons')
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then((cupons) => {
      if (!cupons.length) { lista.innerHTML = '<p class="note">Nenhum cupom válido agora. Volte mais tarde: quando uma loja publicar um cupom, ele aparece aqui.</p>'; return; }
      lista.innerHTML = cupons.map((c) => `<article class="cupom">
        <span class="cupom-loja">${esc(c.lojaNome)}</span>
        <p class="cupom-desc">${esc(c.descricao)}</p>
        <div class="cupom-codigo"><code>${esc(c.codigo)}</code><button type="button" data-copiar="${esc(c.codigo)}">Copiar código</button></div>
        <div class="cupom-rodape"><small>Válido até ${esc(data(c.validoAte))}</small>${c.link ? `<a href="${esc(c.link)}"${c.loja === 'local' ? '' : ' target="_blank" rel="sponsored nofollow noopener"'}>${c.loja === 'local' ? 'Ver produtos da loja' : 'Ir para a loja ↗'}</a>` : ''}</div>
      </article>`).join('');
    })
    .catch(() => { lista.innerHTML = '<p class="note">Não foi possível carregar os cupons agora. <a href="/">Voltar às ofertas</a></p>'; });
  lista.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copiar]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = 'Copiado!'; }
    catch { b.textContent = 'Segure no código para copiar'; }
    setTimeout(() => { b.textContent = 'Copiar código'; }, 2000);
  });
})();
