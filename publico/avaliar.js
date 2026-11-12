// Avaliação pelo link do pedido (/avaliar?p=<pedido>&t=<assinatura>): só quem comprou, uma por pedido.
(async () => {
  const q = new URLSearchParams(location.search), p = q.get('p') || '', t = q.get('t') || '';
  const $ = (id) => document.getElementById(id), form = $('fAvaliar'), msg = $('aMsg');
  const r = await fetch(`/api/avaliacoes/pedido?p=${encodeURIComponent(p)}&t=${encodeURIComponent(t)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { $('aLoja').textContent = d.erro || 'Link de avaliação inválido.'; return; }
  $('aLoja').textContent = `${d.loja?.nome ?? 'Loja'}: ${d.itens.join(', ')}`;
  if (d.jaAvaliado) { msg.textContent = 'Este pedido já foi avaliado. Obrigado!'; return; }
  if (!d.podeAvaliar) { msg.textContent = 'A avaliação abre quando a loja confirmar a venda.'; return; }
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('button'); b.disabled = true;
    const f = new FormData(form);
    const res = await fetch('/api/avaliacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p, t, nota: Number(f.get('nota')), texto: f.get('texto') }) });
    const x = await res.json().catch(() => ({}));
    if (!res.ok) { msg.textContent = x.erro || 'Não deu para enviar. Tente de novo.'; b.disabled = false; return; }
    form.hidden = true;
    msg.innerHTML = '';
    msg.append('Obrigado! Sua avaliação foi publicada. ');
    if (d.loja?.slug) { const a = document.createElement('a'); a.href = `/${d.loja.slug}`; a.textContent = 'Ver a loja'; msg.append(a); }
  });
})();
