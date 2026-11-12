// Tela da cozinha (KDS) do CITshop Food. Acesso pelo link da cozinha (/cozinha#<token>, guardado neste aparelho)
// ou pela sessão do dono. Pergunta ao servidor a cada 4 s; só baixa a lista quando algo mudou (versão).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CHAVE = 'cit-cozinha-token';
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem storage: só nesta aba */ } };
  const lerGuardado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  if (location.hash.length > 20) { guardar(CHAVE, location.hash.slice(1)); history.replaceState(null, '', '/cozinha'); }
  const token = lerGuardado(CHAVE);
  const cab = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });

  const ROTULO = { aguardando: 'Novo', aceito: 'Aceito', preparo: 'No preparo', pronto: 'Pronto', aguardando_saida: 'Aguardando saída', saiu: 'Saiu p/ entrega', entregue: 'Entregue', concluido: 'Concluído', cancelado: 'Cancelado' };
  const PROXIMO = { aguardando: ['aceito', 'Aceitar'], aceito: ['preparo', 'Iniciar preparo'], preparo: ['pronto', 'Pronto'] };
  const ENCERRADOS = new Set(['entregue', 'concluido', 'cancelado']);
  let dados = null, versao = '', filtro = 'ativos', estacao = '', somLigado = false, conhecidos = null, audio;

  function bip() {
    if (!somLigado) return;
    try {
      audio ??= new AudioContext();
      for (const [i, f] of [[0, 880], [1, 1175], [2, 880]]) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.25, audio.currentTime + i * 0.18); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + i * 0.18 + 0.16);
        o.start(audio.currentTime + i * 0.18); o.stop(audio.currentTime + i * 0.18 + 0.17);
      }
    } catch { /* sem áudio */ }
  }
  const minutos = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 60000);
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function acoes(p) {
    const b = [];
    if (PROXIMO[p.situacao]) b.push(`<button class="kds-acao" data-id="${esc(p.id)}" data-para="${PROXIMO[p.situacao][0]}">${PROXIMO[p.situacao][1]}</button>`);
    if (dados.papel !== 'cozinha') {
      if (p.situacao === 'pronto') b.push(p.receber === 'entrega'
        ? `<button class="kds-acao" data-id="${esc(p.id)}" data-para="saiu">Saiu para entrega</button>`
        : `<button class="kds-acao" data-id="${esc(p.id)}" data-para="entregue">Retirado</button>`);
      if (p.situacao === 'saiu') b.push(`<button class="kds-acao" data-id="${esc(p.id)}" data-para="entregue">Entregue</button>`);
      if (p.situacao === 'entregue') b.push(`<button class="kds-acao sec" data-id="${esc(p.id)}" data-para="concluido">Concluir</button>`);
      if (!ENCERRADOS.has(p.situacao)) b.push(`<button class="kds-acao perigo" data-id="${esc(p.id)}" data-para="cancelado" data-confirmar="1">Cancelar</button>`);
    }
    return b.join('');
  }
  function cartao(p) {
    const min = minutos(p.criadoEm), atrasado = !ENCERRADOS.has(p.situacao) && min > (dados.preparoMin ?? 40);
    const itens = p.itens.filter((i) => !estacao || i.estacao === estacao);
    const pago = p.status === 'approved' ? 'Pago online' : 'Cobrar na entrega';
    return `<article class="kds-card s-${esc(p.situacao)}${atrasado ? ' atrasado' : ''}" aria-label="Pedido ${p.numero}">
      <header><b class="kds-num">#${p.numero}</b><span class="kds-sit">${ROTULO[p.situacao]}</span><span class="kds-tempo">${min} min${atrasado ? ' · atrasado' : ''}</span></header>
      <p class="kds-meta">${esc(p.comprador?.nome)} · ${p.receber === 'entrega' ? 'Entrega' : 'Retirada'} · ${pago} · ${new Date(p.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
      <ul class="kds-itens">${itens.map((i) => `<li><b>${i.quantidade}x</b> ${esc(i.nome)}${i.opcoes.length ? `<small>${i.opcoes.map((o) => esc(`${o.grupo}: ${o.nome}`)).join(' · ')}</small>` : ''}${i.observacao ? `<em class="kds-obs">⚠ ${esc(i.observacao)}</em>` : ''}</li>`).join('')}</ul>
      ${p.comprador?.observacao ? `<p class="kds-obs">⚠ ${esc(p.comprador.observacao)}</p>` : ''}
      ${dados.papel !== 'cozinha' ? `<p class="kds-meta">Total ${brl(p.valorTotal)}</p>` : ''}
      <div class="kds-botoes">${acoes(p)}</div></article>`;
  }
  function render() {
    const todos = dados.pedidos;
    const lista = todos.filter((p) => (filtro === 'ativos' ? !ENCERRADOS.has(p.situacao)
      : filtro === 'encerrados' ? ENCERRADOS.has(p.situacao)
      : filtro === 'preparo' ? ['aceito', 'preparo'].includes(p.situacao)
      : filtro === 'pronto' ? ['pronto', 'aguardando_saida', 'saiu'].includes(p.situacao)
      : p.situacao === filtro) && (!estacao || p.itens.some((i) => i.estacao === estacao)))
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    $('kGrade').innerHTML = lista.length ? lista.map(cartao).join('') : '<p class="kds-vazio-lista">Nenhum pedido aqui agora.</p>';
    const est = [...new Set(todos.flatMap((p) => p.itens.map((i) => i.estacao)).filter(Boolean))];
    $('kEstacao').closest('label').hidden = !est.length;
    $('kEstacao').innerHTML = ['<option value="">Todas</option>', ...est.map((e) => `<option ${e === estacao ? 'selected' : ''}>${esc(e)}</option>`)].join('');
    const novos = todos.filter((p) => p.situacao === 'aguardando').length;
    document.title = `${novos ? `(${novos}) ` : ''}Cozinha · ${dados.restaurante}`;
    $('kRest').textContent = dados.restaurante;
    const imp = dados.impressao;
    $('kEstado').textContent = imp ? (imp.online ? 'Impressora conectada' : 'Impressão automática indisponível') : '';
    $('kEstado').className = `kds-estado${imp && !imp.online ? ' alerta' : ''}`;
  }
  async function atualizar() {
    try {
      const r = await fetch(`/api/food/kds?v=${encodeURIComponent(versao)}`, { headers: cab(), cache: 'no-store' });
      if (r.status === 401 || r.status === 403) { $('kSemAcesso').hidden = false; $('kGrade').hidden = true; if (r.status === 401 && token) guardar(CHAVE, null); return; }
      if (r.status === 204) { if (dados) render(); return; } // atualiza os minutos
      dados = await r.json(); versao = String(dados.versao);
      const ids = new Set(dados.pedidos.filter((p) => p.situacao === 'aguardando').map((p) => p.id));
      if (conhecidos && [...ids].some((id) => !conhecidos.has(id))) bip();
      conhecidos = ids;
      render();
    } catch { $('kEstado').textContent = 'Sem conexão: tentando de novo…'; $('kEstado').className = 'kds-estado alerta'; }
  }
  document.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filtro]');
    if (f) { filtro = f.dataset.filtro; document.querySelectorAll('[data-filtro]').forEach((x) => x.setAttribute('aria-pressed', String(x === f))); return render(); }
    const b = e.target.closest('.kds-acao');
    if (!b) return;
    if (b.dataset.confirmar && !confirm('Cancelar este pedido? O cliente será avisado.')) return;
    b.disabled = true;
    const r = await fetch(`/api/food/kds/pedidos/${encodeURIComponent(b.dataset.id)}`, { method: 'PATCH', headers: cab(), body: JSON.stringify({ situacao: b.dataset.para }) }).catch(() => null);
    if (!r?.ok) { b.disabled = false; alert((await r?.json().catch(() => ({})))?.erro || 'Não deu para mudar. Tente de novo.'); return; }
    versao = ''; atualizar();
  });
  $('kEstacao').addEventListener('change', (e) => { estacao = e.target.value; render(); });
  $('kSom').addEventListener('click', (e) => { somLigado = !somLigado; e.target.setAttribute('aria-pressed', String(somLigado)); e.target.textContent = somLigado ? 'Som ligado' : 'Ativar som'; bip(); });
  $('kTela').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()).catch?.(() => {}));
  atualizar();
  setInterval(atualizar, 4000);
})();
