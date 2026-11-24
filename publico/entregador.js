// App do entregador (motoboy do próprio restaurante): entra pelo link gerado no painel (token no #), vê as entregas
// do restaurante e marca "Saí para entrega" e "Entregue". O token fica no aparelho; o link some da barra de endereço.
(() => {
  const $ = (id) => document.getElementById(id);
  const { esc } = window.CIT;
  const brl = (n) => window.CIT.brl.format(Number(n) || 0);
  const CHAVE = 'cit-entregador';
  if (location.hash.length > 20) { try { localStorage.setItem(CHAVE, location.hash.slice(1)); } catch { /* modo privado */ } history.replaceState(null, '', '/entregador'); }
  const token = (() => { try { return localStorage.getItem(CHAVE) || ''; } catch { return ''; } })();
  const api = (caminho, metodo = 'GET', corpo) => fetch(`/api/food/${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const FORMA = { dinheiro: 'Dinheiro', cartao_entrega: 'Cartão (leve a maquininha)', pix_entrega: 'Pix na entrega' };
  const mapa = (e) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.ponto ? `${e.ponto.lat},${e.ponto.lng}` : e.cliente.endereco || '')}`;

  function cartao(e) {
    const c = e.cobrar;
    const cobrar = c ? `<p class="entr-cobrar"><b>Cobrar ${brl(c.valor)}</b> · ${esc(FORMA[c.forma] ?? c.forma)}${c.troco ? ` · troco para ${brl(c.troco)}` : ''}</p>` : '<p class="entr-pago">Já pago online: não cobrar</p>';
    const acao = e.situacao === 'saiu' ? `<button class="btn" data-mudar="${esc(e.id)}" data-para="entregue">Entregue</button>`
      : e.situacao === 'entregue' ? '' : `<button class="btn" data-mudar="${esc(e.id)}" data-para="saiu">Saí para entrega</button>`;
    return `<article class="entr-card${e.situacao === 'entregue' ? ' feito' : ''}">
      <header><b>Pedido #${e.numero}</b><span>${esc(e.rotulo)}</span></header>
      <p><b>${esc(e.cliente.nome || '')}</b><br>${esc(e.cliente.endereco || 'Sem endereço')}</p>
      ${e.cliente.observacao ? `<p class="note">Obs.: ${esc(e.cliente.observacao)}</p>` : ''}
      <p class="note">${esc(e.itens.join(', '))}</p>
      ${cobrar}
      <p class="entr-acoes"><a class="btn sec" href="${mapa(e)}" target="_blank" rel="noopener">Abrir no mapa</a>
        ${e.cliente.whatsapp ? `<a class="btn sec" href="https://wa.me/${esc(e.cliente.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${acao}</p>
    </article>`;
  }
  async function carregar() {
    const r = await api('entregas').catch(() => null);
    if (!r?.ok) { $('eAviso').textContent = r?.status === 401 || r?.status === 403 ? 'Abra o link de entregador que o restaurante gerou no painel.' : 'Sem conexão. Tentando de novo…'; $('eLista').innerHTML = ''; return; }
    const d = await r.json();
    $('eRest').textContent = d.restaurante;
    const abertas = d.entregas.filter((e) => e.situacao !== 'entregue');
    $('eAviso').textContent = abertas.length ? `${abertas.length} entrega(s) em aberto. A lista atualiza sozinha.` : 'Nenhuma entrega agora. A lista atualiza sozinha.';
    // Primeiro o que já saiu, depois o que está pronto, depois em preparo; entregues por último.
    const ordem = { saiu: 0, aguardando_saida: 1, pronto: 1, preparo: 2, aceito: 3, entregue: 9 };
    $('eLista').innerHTML = d.entregas.sort((a, b) => (ordem[a.situacao] ?? 5) - (ordem[b.situacao] ?? 5) || a.numero - b.numero).map(cartao).join('');
  }
  $('eLista').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-mudar]'); if (!b) return;
    if (b.dataset.para === 'entregue' && !confirm('Confirmar que o pedido foi entregue ao cliente?')) return;
    b.disabled = true;
    const r = await api(`entregas/pedidos/${encodeURIComponent(b.dataset.mudar)}`, 'PATCH', { situacao: b.dataset.para }).catch(() => null);
    if (!r?.ok) alert((await r?.json().catch(() => ({})))?.erro || 'Não deu para salvar. Tente de novo.');
    carregar();
  });
  carregar();
  setInterval(carregar, 15000);
})();
