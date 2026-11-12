// Painel da loja: cadastro, login, produtos com fotos, dados e assinatura.
(() => {
  const { DEPTS, D, esc, brl } = window.CIT;
  const $ = (id) => document.getElementById(id);
  let estado = null, editando = null, manter = [], novas = [];

  async function api(url, { metodo = 'GET', json, form } = {}) {
    const r = await fetch(url, {
      method: metodo,
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : form,
      credentials: 'same-origin',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erro ?? 'Não foi possível concluir. Tente de novo.'), { status: r.status });
    return d;
  }
  const mostrarMsg = (el, texto, tipo = 'erro') => { el.textContent = texto; el.className = `msg ${tipo}`; el.hidden = !texto; };
  const dados = (form) => Object.fromEntries(new FormData(form));
  // `botao` pode vir nulo (envio pelo Enter em alguns navegadores): aí não há o que travar.
  async function enviando(botao, fn) {
    if (botao) botao.disabled = true;
    try { await fn(); } finally { if (botao) botao.disabled = false; }
  }

  // ---------- entrar / cadastrar ----------
  function aba(cad) {
    $('abaCad').setAttribute('aria-pressed', cad); $('abaEnt').setAttribute('aria-pressed', !cad);
    $('fCad').hidden = !cad; $('fEnt').hidden = cad;
  }
  $('abaCad').onclick = () => aba(true);
  $('abaEnt').onclick = () => aba(false);

  $('fCad').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try {
        const d = dados(e.target);
        mostrar(await api('/api/painel/cadastro', { metodo: 'POST', json: { ...d, aceite: e.target.aceite.checked } }));
      } catch (err) { mostrarMsg($('eCad'), err.message); }
    });
  });
  $('fEnt').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try { mostrar(await api('/api/painel/entrar', { metodo: 'POST', json: dados(e.target) })); }
      catch (err) { mostrarMsg($('eEnt'), err.message); }
    });
  });
  $('sair').onclick = async () => { await api('/api/painel/sair', { metodo: 'POST' }).catch(() => {}); location.href = '/painel'; };

  // ---------- painel ----------
  const TEXTO = {
    parceira: () => 'Sua loja é parceira oficial da CIT Shopping! Sem mensalidade fixa, seus produtos estão ativos na vitrine com comissão de apenas R$ 1,00 por venda.',
    teste: (s) => `Teste grátis: faltam ${s.diasTeste} ${s.diasTeste === 1 ? 'dia' : 'dias'}. Seus produtos estão na vitrine. Assine agora e a primeira cobrança só acontece quando o teste acabar.`,
    ativa: () => 'Assinatura ativa. Seus produtos aparecem na vitrine, na frente dos afiliados.',
    vencida: (s) => s.loja.assinatura?.status === 'pendente'
      ? 'Estamos aguardando a confirmação do pagamento no Mercado Pago. Assim que confirmar, seus produtos voltam pra vitrine.'
      : 'Seu teste acabou e seus produtos saíram da vitrine. Assine para voltar a aparecer.',
    suspensa: () => 'Sua loja foi suspensa pela CIT Shopping. Fale com a gente pelo WhatsApp da CITmax.',
  };
  const ROTULO = { parceira: 'Loja Parceira', teste: 'Teste grátis', ativa: 'Assinatura ativa', vencida: 'Fora da vitrine', suspensa: 'Suspensa' };
  const ROTULO_DISPONIBILIDADE = { disponivel: 'Disponível', 'sob-encomenda': 'Sob encomenda', consulte: 'Consultar disponibilidade' };

  function mostrar(s) {
    estado = s;
    $('vAuth').hidden = true;
    $('vPainel').hidden = false;
    $('sair').hidden = false;
    $('pNome').textContent = s.loja.nome;
    $('pLink').innerHTML = `Sua página: <a href="/${esc(s.loja.slug)}" target="_blank">${esc(location.host)}/${esc(s.loja.slug)}</a>`;
    $('pContatoResumo').textContent = `${s.cliquesContatoLoja ?? 0} cliques para o WhatsApp da loja`;
    $('pStatus').className = `pill ${s.status}`;
    $('pStatus').textContent = ROTULO[s.status] || esc(s.status);
    $('pStatusTxt').textContent = (TEXTO[s.status] || TEXTO.teste)(s);
    $('assinar').hidden = s.status === 'ativa' || s.status === 'suspensa' || s.status === 'parceira';
    $('assinar').textContent = `Assinar ${brl.format(s.preco)}/mês`;
    const f = $('fLoja');
    for (const k of ['nome', 'responsavel', 'whatsapp', 'cidade', 'categoria', 'entrega', 'horario', 'bairrosAtendidos', 'prazoEntrega']) f[k].value = s.loja[k] ?? '';
    $('mpStatus').textContent = s.loja.mpConectado ? 'Conta Mercado Pago conectada: as vendas pelo site caem nela.' : 'Nenhuma conta conectada ainda.';
    $('mpConectar').textContent = s.loja.mpConectado ? 'Conectar outra conta' : 'Conectar Mercado Pago';
    $('mpDesconectar').hidden = !s.loja.mpConectado;
    const ST = { approved: 'Pago', pending: 'Aguardando pagamento', in_process: 'Em análise', rejected: 'Recusado', cancelled: 'Cancelado', refunded: 'Devolvido' };
    $('vendas').innerHTML = (s.vendas ?? []).length ? s.vendas.map((v) => {
      const c = v.comprador ?? {};
      return `<div class="venda"><span class="st ${esc(v.status)}">${esc(ST[v.status] ?? v.status)}</span>
        <b>${esc(String(v.quantidade))}x ${esc(v.produtoNome ?? '')} · ${brl.format(v.valorTotal)}</b>
        <span>${esc(c.nome ?? '')}${c.whatsapp ? ` · <a href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp do cliente</a>` : ''}</span>
        <span>${c.receber === 'entrega' ? `Entregar em: ${esc(c.endereco ?? '')}` : 'Vai retirar na loja'}${c.observacao ? ` · ${esc(c.observacao)}` : ''}</span>
        <small>${new Date(v.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></div>`;
    }).join('') : '<p class="note" style="font-size:13px;margin:0">Nenhuma venda pelo site ainda. Quando um cliente pagar, ela aparece aqui e você recebe um aviso no WhatsApp.</p>';
    $('vCor').value = s.loja.cor || '#036271';
    $('vSobre').value = s.loja.sobre ?? '';
    $('tirarLogo').hidden = !s.loja.logo;
    amostra();
    renderLista();
  }

  // ---------- aparência ----------
  const amostra = () => {
    const f = $('fLoja');
    $('amostra').outerHTML = window.CIT.cabecalhoLoja({
      ...estado.loja, cor: $('vCor').value, sobre: $('vSobre').value,
      horario: f.horario.value, bairrosAtendidos: f.bairrosAtendidos.value, prazoEntrega: f.prazoEntrega.value,
    }).replace('class="sellerhead', 'id="amostra" class="sellerhead');
  };
  $('vCor').addEventListener('input', amostra);
  $('vSobre').addEventListener('input', amostra);
  for (const campo of ['horario', 'bairrosAtendidos', 'prazoEntrega']) $('fLoja')[campo].addEventListener('input', amostra);
  $('fVisual').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      const { nome, responsavel, whatsapp, cidade, categoria } = estado.loja;
      try {
        mostrar(await api('/api/painel/loja', { metodo: 'PUT', json: { nome, responsavel, whatsapp, cidade, categoria, cor: $('vCor').value, sobre: $('vSobre').value } }));
        mostrarMsg($('mVisual'), 'Aparência salva.', 'ok');
      } catch (err) { mostrarMsg($('mVisual'), err.message); }
    });
  });
  $('fLogo').addEventListener('change', async (e) => {
    const arq = e.target.files[0];
    e.target.value = '';
    if (!arq) return;
    const fd = new FormData();
    fd.append('logo', arq);
    try { mostrar(await api('/api/painel/logo', { metodo: 'POST', form: fd })); mostrarMsg($('mVisual'), 'Logo atualizado.', 'ok'); }
    catch (err) { mostrarMsg($('mVisual'), err.message); }
  });
  $('tirarLogo').onclick = async () => {
    try { mostrar(await api('/api/painel/logo', { metodo: 'DELETE' })); }
    catch (err) { mostrarMsg($('mVisual'), err.message); }
  };

  function renderLista() {
    const ps = estado.produtos;
    $('lista').innerHTML = ps.length ? ps.map((p) => `<div class="item ${p.ativo && !p.bloqueado ? '' : 'off'}">
        <img src="${esc(p.fotos[0])}" alt="">
        <div><b>${esc(p.nome)}</b><br><small class="note">${brl.format(p.preco)} · ${esc(D[p.dept]?.n ?? '')} · ${esc(ROTULO_DISPONIBILIDADE[p.disponibilidade] ?? ROTULO_DISPONIBILIDADE.consulte)}${p.bloqueado ? ' · ocultado pela CIT Shopping' : p.ativo ? '' : ' · pausado'} · ${p.cliquesContato ?? 0} cliques no WhatsApp</small></div>
        <div class="acoes">
          <button class="btn sec" data-ed="${p.id}">Editar</button>
          <button class="btn sec" data-at="${p.id}">${p.ativo ? 'Pausar' : 'Ativar'}</button>
          <button class="btn perigo" data-del="${p.id}">Excluir</button>
        </div></div>`).join('')
      : '<p class="note" style="font-size:14px">Você ainda não publicou nenhum produto. Clique em <b>+ Novo produto</b> e tire as fotos pelo celular.</p>';
  }

  // ---------- formulário de produto ----------
  $('pDept').innerHTML = '<option value="">Escolha…</option>' + DEPTS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  function renderFotos() {
    $('fotos').innerHTML = [
      ...manter.map((u, i) => `<figure><img src="${esc(u)}" alt=""><button type="button" data-rm-m="${i}" aria-label="Remover foto">✕</button></figure>`),
      ...novas.map((f, i) => `<figure><img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-rm-n="${i}" aria-label="Remover foto">✕</button></figure>`),
    ].join('');
  }
  function abrirForm(p) {
    editando = p;
    const f = $('fProd');
    f.reset();
    $('fProdTit').textContent = p ? 'Editar produto' : 'Novo produto';
    if (p) for (const k of ['nome', 'dept', 'descricao', 'disponibilidade']) f[k].value = p[k] ?? 'consulte';
    if (p) { f.preco.value = String(p.preco).replace('.', ','); f.precoAntigo.value = p.precoAntigo ? String(p.precoAntigo).replace('.', ',') : ''; }
    manter = p ? [...p.fotos] : [];
    novas = [];
    renderFotos();
    mostrarMsg($('eProd'), '');
    f.hidden = false;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('novo').onclick = () => abrirForm(null);
  $('cancProd').onclick = () => { $('fProd').hidden = true; };
  $('fArq').addEventListener('change', (e) => {
    novas.push(...e.target.files);
    if (manter.length + novas.length > 4) { novas = novas.slice(0, 4 - manter.length); mostrarMsg($('eProd'), 'Use no máximo 4 fotos.'); }
    e.target.value = '';
    renderFotos();
  });
  $('fotos').addEventListener('click', (e) => {
    const m = e.target.dataset.rmM, n = e.target.dataset.rmN;
    if (m !== undefined) manter.splice(Number(m), 1);
    if (n !== undefined) novas.splice(Number(n), 1);
    renderFotos();
  });
  $('fProd').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!manter.length && !novas.length) return mostrarMsg($('eProd'), 'Adicione pelo menos uma foto.');
    enviando($('salvarProd'), async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(dados(e.target))) fd.append(k, v);
      fd.append('manter', JSON.stringify(manter));
      for (const f of novas) fd.append('fotos', f);
      try {
        await api(editando ? `/api/painel/produtos/${editando.id}` : '/api/painel/produtos', { metodo: editando ? 'PUT' : 'POST', form: fd });
        $('fProd').hidden = true;
        mostrar(await api('/api/painel/eu'));
      } catch (err) { mostrarMsg($('eProd'), err.message); }
    });
  });

  $('lista').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const p = estado.produtos.find((x) => x.id === (b.dataset.ed ?? b.dataset.at ?? b.dataset.del));
    if (!p) return;
    try {
      if (b.dataset.ed) return abrirForm(p);
      if (b.dataset.at) await api(`/api/painel/produtos/${p.id}`, { metodo: 'PATCH', json: { ativo: !p.ativo } });
      if (b.dataset.del) {
        if (!confirm(`Excluir "${p.nome}"? Isso não pode ser desfeito.`)) return;
        await api(`/api/painel/produtos/${p.id}`, { metodo: 'DELETE' });
      }
      mostrar(await api('/api/painel/eu'));
    } catch (err) { alert(err.message); }
  });

  $('fLoja').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try { mostrar(await api('/api/painel/loja', { metodo: 'PUT', json: dados(e.target) })); mostrarMsg($('mLoja'), 'Dados salvos.', 'ok'); }
      catch (err) { mostrarMsg($('mLoja'), err.message); }
    });
  });
  $('mpDesconectar').addEventListener('click', (e) => {
    enviando(e.currentTarget, async () => {
      try { mostrar(await api('/api/painel/mercadopago/desconectar', { metodo: 'POST' })); mostrarMsg($('mPagamento'), 'Conta desconectada.', 'ok'); }
      catch (err) { mostrarMsg($('mPagamento'), err.message); }
    });
  });
  // Volta da autorização no Mercado Pago (/mercadopago/retorno redireciona com ?mp=conectado|erro).
  const voltaMp = new URLSearchParams(location.search).get('mp');
  if (voltaMp) {
    mostrarMsg($('mPagamento'), voltaMp === 'conectado' ? 'Conta Mercado Pago conectada.' : 'Não foi possível conectar a conta. Tente de novo.', voltaMp === 'conectado' ? 'ok' : undefined);
    history.replaceState(null, '', location.pathname);
  }
  $('fSenha').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try { await api('/api/painel/senha', { metodo: 'POST', json: dados(e.target) }); e.target.reset(); mostrarMsg($('mSenha'), 'Senha trocada.', 'ok'); }
      catch (err) { mostrarMsg($('mSenha'), err.message); }
    });
  });
  $('assinar').onclick = () => enviando($('assinar'), async () => {
    try { location.href = (await api('/api/painel/assinar', { metodo: 'POST' })).url; }
    catch (err) { alert(err.message); }
  });

  // ---------- início ----------
  const retorno = new URLSearchParams(location.search).has('assinatura');
  api(`/api/painel/eu${retorno ? '?atualizar=1' : ''}`)
    .then((s) => { mostrar(s); if (retorno) history.replaceState(null, '', '/painel'); })
    .catch(() => { $('vAuth').hidden = false; });
})();
