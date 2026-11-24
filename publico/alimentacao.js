// Praça de alimentação (CITshop Food): lista de restaurantes, cardápio com opções, sacola com vários restaurantes
// (cada restaurante fecha o seu pedido, com a sua entrega e o seu pagamento), pedido e acompanhamento. O preço mostrado aqui é só prévia: o servidor recalcula tudo.
(() => {
  const $ = (id) => document.getElementById(id);
  const { esc } = window.CIT;
  const brl = (n) => window.CIT.brl.format(Number(n) || 0);
  // Sacolas por restaurante: { slug: { loja, nome, itens } }. A chave antiga (uma sacola só) vira a primeira.
  const CHAVE = 'cit-food-sacolas';
  const ler = () => {
    try {
      const v = JSON.parse(localStorage.getItem(CHAVE)); if (v) return v;
      const velha = JSON.parse(localStorage.getItem('cit-food-sacola')); return velha?.itens?.length ? { [velha.loja]: velha } : {};
    } catch { return {}; }
  };
  const gravar = () => {
    for (const k of Object.keys(sacolas)) if (!sacolas[k].itens.length) delete sacolas[k];
    try { localStorage.setItem(CHAVE, JSON.stringify(sacolas)); localStorage.removeItem('cit-food-sacola'); } catch { /* modo privado */ }
  };
  // `loja` e `sacola`: o restaurante cujo pedido está sendo fechado agora (pode não ser o da página aberta).
  let restaurantes = [], tipo = '', atual = null, itens = [], sacolas = ler(), loja = null, sacola = null, escolhendo = null, qtd = 1, ponto = null, frete = null;

  // ---------- lista ----------
  function cartaoRest(r) {
    const entrega = r.entrega ? (r.taxaEntregaDesde == null ? 'Entrega' : r.taxaEntregaDesde === 0 ? 'Entrega grátis' : `Entrega ${r.entregaPorKm ? 'a partir de ' : ''}${brl(r.taxaEntregaDesde)}`) : 'Só retirada';
    return `<a class="food-rest${r.aberto ? '' : ' fechado'}" href="/alimentacao/${esc(r.slug)}" data-rest="${esc(r.slug)}">
      <span class="avatar" style="background:${esc(r.cor || '#036271')};color:${window.CIT.textoSobre(r.cor || '#036271')}">${r.logo ? `<img src="${esc(r.logo)}" alt="">` : esc(window.CIT.iniciais(r.nome))}</span>
      <span><b>${esc(r.nome)}</b><small>${esc(r.tipo)} · ${esc(r.cidade)}${r.avaliacao ? ` · ★ ${String(r.avaliacao.media).replace('.', ',')}` : ''}</small>
      <small class="${r.aberto ? 'ok' : 'off'}">${esc(r.situacao)}</small>
      <small>${r.preparoMin} min · ${entrega}${r.pedidoMinimo ? ` · mínimo ${brl(r.pedidoMinimo)}` : ''}</small></span></a>`;
  }
  function renderLista() {
    const q = $('fBusca').value.trim().toLowerCase(), so = $('fAbertos').checked;
    const tipos = [...new Set(restaurantes.map((r) => r.tipo))].sort();
    $('fTipos').innerHTML = tipos.length > 1 ? [['', 'Todos'], ...tipos.map((t) => [t, t])].map(([k, n]) => `<button class="chip" data-tipo="${esc(k)}" aria-pressed="${tipo === k}">${esc(n)}</button>`).join('') : '';
    const lista = restaurantes.filter((r) => (!so || r.aberto) && (!tipo || r.tipo === tipo) && (!q || `${r.nome} ${r.tipo} ${r.cidade}`.toLowerCase().includes(q)));
    $('fRestaurantes').innerHTML = lista.length ? lista.map(cartaoRest).join('') : '<p class="empty">Nenhum restaurante encontrado. Tente outra busca.</p>';
  }

  // ---------- restaurante e cardápio ----------
  async function abrirRest(slug) {
    const r = await fetch(`/api/food/restaurantes/${encodeURIComponent(slug)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    $('fLista').hidden = true; $('fRest').hidden = false;
    if (!r) { $('fCab').innerHTML = '<p class="empty">Restaurante não encontrado.</p>'; $('fCardapio').innerHTML = ''; return; }
    atual = r.restaurante; itens = r.itens;
    document.title = `${atual.nome} · CITshop Food`;
    $('fCab').innerHTML = `<div class="food-cab"><h1>${esc(atual.nome)}</h1><p class="note">${esc(atual.tipo)} · ${esc(atual.cidade)}${atual.localEndereco ? ` · ${esc(atual.localEndereco)}` : ''}</p>
      <p><b class="${atual.aberto ? 'ok' : 'off'}">${esc(atual.situacao)}</b> · preparo ~${atual.preparoMin} min${atual.pedidoMinimo ? ` · pedido mínimo ${brl(atual.pedidoMinimo)}` : ''}${atual.retirada ? ' · retirada no local' : ''}</p>
      ${atual.sobre ? `<p>${esc(atual.sobre)}</p>` : ''}</div>`;
    const cats = [...new Set(itens.map((i) => i.categoria))];
    $('fCats').innerHTML = cats.length > 1 ? cats.map((c, n) => `<a class="chip" href="#cat-${n}">${esc(c)}</a>`).join('') : '';
    $('fCardapio').innerHTML = itens.length ? cats.map((c, n) => `<h2 class="food-cat" id="cat-${n}">${esc(c)}</h2><div class="food-itens">${itens.filter((i) => i.categoria === c).map((i) => `
      <button type="button" class="food-item" data-item="${esc(i.id)}" ${atual.aberto && !i.esgotado && !i.foraDoHorario ? '' : 'aria-disabled="true"'}>
        <span><b>${esc(i.nome)}</b>${i.descricao ? `<small>${esc(i.descricao)}</small>` : ''}<strong>${(i.variacoes ?? []).length || i.grupos.some((g) => g.min > 0) ? 'a partir de ' : ''}${brl(i.aPartirDe ?? i.preco)}</strong>${i.esgotado ? '<small class="off">Esgotado</small>' : i.foraDoHorario ? '<small class="off">Fora do horário</small>' : ''}</span>
        ${i.foto ? `<img src="${esc(i.foto)}" alt="" loading="lazy" width="96" height="96">` : ''}</button>`).join('')}</div>`).join('') : '<p class="empty">Cardápio ainda vazio.</p>';
    pintarSacola();
  }

  // ---------- item com opções (motor universal: o mesmo cálculo do servidor, em /food-preco.js) ----------
  let motor = null, motorMod = null, variacaoId = null, sel = {};
  const carregarMotor = () => (motor ??= import('/food-preco.js'));
  const rotuloGrupo = (g) => (g.min ? (g.min === g.max ? `escolha ${g.min}` : `escolha de ${g.min} a ${g.max}`) : `opcional, até ${g.max}`) + (g.incluidas ? ` · ${g.incluidas} sem custo` : '');
  const unidadesDoGrupo = (gid) => Object.values(sel[gid] ?? {}).reduce((s, q) => s + q, 0);
  function gruposAgora() { return motorMod ? motorMod.gruposEfetivos(escolhendo, (escolhendo.variacoes ?? []).find((v) => v.id === variacaoId), {}) : escolhendo.grupos; }
  async function abrirItem(id) {
    if (!atual.aberto) return alert(`${atual.nome} não está recebendo pedidos agora.`);
    escolhendo = itens.find((i) => i.id === id);
    if (escolhendo.esgotado || escolhendo.foraDoHorario) return alert(escolhendo.esgotado ? `${escolhendo.nome} esgotou.` : `${escolhendo.nome} não está disponível neste horário.`);
    motorMod = await carregarMotor();
    qtd = 1; sel = {}; variacaoId = (escolhendo.variacoes ?? []).length === 1 ? escolhendo.variacoes[0].id : null;
    $('fItemNome').textContent = escolhendo.nome;
    $('fItemForm').obs.value = ''; $('fItemErro').textContent = '';
    desenharItem();
    $('fItem').showModal();
  }
  function desenharItem() {
    const vs = escolhendo.variacoes ?? [];
    const grupos = gruposAgora();
    // Ao trocar de tamanho, tira o que não vale mais (grupo desligado ou acima do novo máximo).
    for (const gid of Object.keys(sel)) { const g = grupos.find((x) => x.id === gid); if (!g || unidadesDoGrupo(gid) > g.max) delete sel[gid]; }
    $('fItemCorpo').innerHTML = `${escolhendo.descricao ? `<p>${esc(escolhendo.descricao)}</p>` : ''}
      ${vs.length ? `<fieldset class="food-grupo"><legend>Tamanho <small>obrigatório</small></legend>${vs.map((v) => `<label><input type="radio" name="variacao" value="${esc(v.id)}" ${v.id === variacaoId ? 'checked' : ''}> ${esc(v.nome)} <small>${brl(v.preco)}</small></label>`).join('')}</fieldset>` : ''}
      ${grupos.map((g) => `<fieldset class="food-grupo" data-g="${esc(g.id)}"><legend>${esc(g.nome)} <small>${rotuloGrupo(g)}</small></legend>${g.descricao ? `<p class="note">${esc(g.descricao)}</p>` : ''}
        ${g.opcoes.map((o) => {
          const q = sel[g.id]?.[o.id] ?? 0, preco = o.preco ? ` <small>+ ${brl(o.preco)}</small>` : '', fora = o.esgotado ? ' <small class="off">esgotado</small>' : '';
          if ((o.maxQtd ?? 1) > 1) return `<div class="food-opq${o.esgotado ? ' esgotado' : ''}"><span>${esc(o.nome)}${preco}${fora}</span><span class="food-qtd"><button type="button" data-op="${esc(o.id)}" data-gp="${esc(g.id)}" data-d="-1" aria-label="Menos ${esc(o.nome)}" ${q ? '' : 'disabled'}>−</button><output>${q}</output><button type="button" data-op="${esc(o.id)}" data-gp="${esc(g.id)}" data-d="1" aria-label="Mais ${esc(o.nome)}" ${o.esgotado ? 'disabled' : ''}>+</button></span></div>`;
          return `<label${o.esgotado ? ' class="esgotado"' : ''}><input type="${g.max === 1 ? 'radio' : 'checkbox'}" name="g-${esc(g.id)}" value="${esc(o.id)}" data-grupo="${esc(g.id)}" ${q ? 'checked' : ''} ${o.esgotado ? 'disabled' : ''}> ${g.tipo === 'remover' ? 'Sem ' : ''}${esc(o.nome)}${preco}${fora}</label>`;
        }).join('')}</fieldset>`).join('')}`;
    atualizarItem();
  }
  function calculo() { return motorMod.calcularItem(escolhendo, { variacaoId, escolhas: sel }, {}); }
  function atualizarItem() {
    $('fQtd').textContent = qtd;
    const r = calculo();
    // Antes de completar as escolhas, mostra o menor preço possível ("a partir de"); depois, o valor exato.
    $('fAdd').textContent = r.erro ? `Adicionar · a partir de ${brl(escolhendo.aPartirDe ?? escolhendo.preco)}` : `Adicionar · ${brl((r.unitarioC * qtd) / 100)}`;
  }
  $('fItemCorpo').addEventListener('change', (e) => {
    if (e.target.name === 'variacao') { variacaoId = e.target.value; return desenharItem(); }
    const gid = e.target.dataset.grupo;
    if (!gid) return;
    const g = gruposAgora().find((x) => x.id === gid);
    if (e.target.type === 'radio') sel[gid] = { [e.target.value]: 1 };
    else if (e.target.checked) {
      if (unidadesDoGrupo(gid) + 1 > g.max) { e.target.checked = false; $('fItemErro').textContent = `No máximo ${g.max} em ${g.nome}.`; return; }
      (sel[gid] ??= {})[e.target.value] = 1;
    } else delete sel[gid]?.[e.target.value];
    $('fItemErro').textContent = '';
    atualizarItem();
  });
  $('fItemCorpo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const gid = b.dataset.gp, g = gruposAgora().find((x) => x.id === gid), o = g.opcoes.find((x) => x.id === b.dataset.op);
    const atualQ = sel[gid]?.[o.id] ?? 0, d = Number(b.dataset.d);
    if (d > 0 && (atualQ + 1 > (o.maxQtd ?? 1) || unidadesDoGrupo(gid) + 1 > g.max)) { $('fItemErro').textContent = atualQ + 1 > (o.maxQtd ?? 1) ? `No máximo ${o.maxQtd} de ${o.nome}.` : `No máximo ${g.max} em ${g.nome}.`; return; }
    const novo = Math.max(0, atualQ + d);
    if (novo) (sel[gid] ??= {})[o.id] = novo; else delete sel[gid]?.[o.id];
    $('fItemErro').textContent = '';
    desenharItem();
  });
  $('fItemForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const r = calculo();
    if (r.erro) { $('fItemErro').textContent = r.erro; return; }
    const daLoja = (sacolas[atual.slug] ??= { loja: atual.slug, nome: atual.nome, itens: [] });
    const nomes = [...(r.variacao ? [r.variacao.nome] : []), ...r.opcoes.map((o) => `${o.tipo === 'remover' ? 'sem ' : ''}${o.qtd > 1 ? `${o.qtd}x ` : ''}${o.nome}`)];
    daLoja.itens.push({ itemId: escolhendo.id, nome: escolhendo.nome, variacaoId, escolhas: JSON.parse(JSON.stringify(sel)), opcoes: nomes, quantidade: qtd, observacao: $('fItemForm').obs.value.trim(), unitario: r.unitarioC / 100 });
    gravar(); $('fItem').close(); pintarSacola();
  });

  // ---------- sacola e pedido ----------
  const somaDe = (s) => (s?.itens ?? []).reduce((t, i) => t + i.unitario * i.quantidade, 0);
  const subtotal = () => somaDe(sacola);
  const linhaItem = (i, attr) => `<li><span><b>${i.quantidade}x ${esc(i.nome)}</b>${i.opcoes.length ? `<small>${esc(i.opcoes.join(', '))}</small>` : ''}${i.observacao ? `<small>Obs.: ${esc(i.observacao)}</small>` : ''}</span><span>${brl(i.unitario * i.quantidade)} <button type="button" class="food-x" ${attr} aria-label="Remover ${esc(i.nome)}">×</button></span></li>`;
  function pintarSacola() {
    const lista = Object.values(sacolas), n = lista.reduce((t, s) => t + s.itens.reduce((u, i) => u + i.quantidade, 0), 0);
    $('fSacola').hidden = !n;
    $('fSacola').textContent = `Ver sacola · ${n} ${n === 1 ? 'item' : 'itens'}${lista.length > 1 ? ` de ${lista.length} restaurantes` : ''} · ${brl(lista.reduce((t, s) => t + somaDe(s), 0))}`;
  }
  // Sacola com todos os restaurantes: cada um tem o seu botão de fechar pedido.
  function renderSacolas() {
    const lista = Object.values(sacolas);
    if (!lista.length) { $('fSacolas').close(); return pintarSacola(); }
    $('fSacLista').innerHTML = lista.map((s) => `<section class="food-sac"><h3>${esc(s.nome)}</h3>
      <ul class="food-car">${s.itens.map((i, n) => linhaItem(i, `data-tirar="${esc(s.loja)}" data-n="${n}"`)).join('')}</ul>
      <p class="food-total">Itens ${brl(somaDe(s))}</p>
      <button type="button" class="btn" data-finalizar="${esc(s.loja)}">Fechar pedido de ${esc(s.nome)}</button></section>`).join('');
  }
  function abrirSacolas() {
    const lista = Object.keys(sacolas);
    if (lista.length === 1) return finalizar(lista[0]); // um restaurante só: direto para o pedido
    renderSacolas(); $('fSacolas').showModal();
  }
  async function finalizar(slug) {
    loja = atual?.slug === slug ? atual : (await fetch(`/api/food/restaurantes/${encodeURIComponent(slug)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null))?.restaurante ?? null;
    if (!loja) return alert('Não deu para abrir este restaurante agora. Tente de novo.');
    sacola = sacolas[slug];
    if ($('fSacolas').open) $('fSacolas').close();
    abrirCarrinho();
  }
  function renderCarrinho() {
    $('fCarItens').innerHTML = sacola.itens.map((i, n) => linhaItem(i, `data-remover="${n}"`)).join('');
    const entrega = $('fPedido').receber.value === 'entrega';
    $('fEntrega').hidden = !entrega;
    $('fTrocoL').hidden = $('fPag').value !== 'dinheiro';
    const taxa = entrega ? (frete?.valor ?? null) : 0;
    $('fTotal').textContent = `Itens ${brl(subtotal())}${entrega ? ` · entrega ${taxa == null ? 'a calcular' : brl(taxa)}` : ''} · total ${brl(subtotal() + (taxa ?? 0))}`;
  }
  function abrirCarrinho() {
    const f = $('fPedido');
    $('fCarTitulo').textContent = `Pedido · ${loja.nome}`;
    f.querySelector('[value="entrega"]').disabled = !loja.entrega; f.querySelector('[value="retirada"]').disabled = !loja.retirada;
    f.receber.value = loja.entrega ? 'entrega' : 'retirada';
    $('fPag').querySelector('[value="online"]')?.remove(); // cada restaurante decide se aceita pagar online
    if (loja.pagamentoOnline) $('fPag').insertAdjacentHTML('afterbegin', '<option value="online">Pagar agora (Pix ou cartão · Mercado Pago)</option>');
    ponto = null; frete = null; $('fFrete').textContent = loja.entregaPorKm ? 'A taxa depende da distância: use sua localização ou calcule pelo endereço.' : '';
    if (!loja.entregaPorKm) calcularFrete();
    preencherDaConta(f);
    $('fErro').textContent = ''; renderCarrinho(); $('fCarrinho').showModal();
  }
  // Conta aberta (Minha conta): nome, WhatsApp e endereço já vêm preenchidos; o pedido fica no histórico da conta.
  let conta;
  async function preencherDaConta(f) {
    conta ??= await fetch('/api/conta/eu').then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!conta) return;
    if (!f.nome.value) f.nome.value = conta.nome;
    if (!f.whatsapp.value) f.whatsapp.value = conta.whatsapp.replace(/^55/, '');
    if (!f.endereco.value && conta.enderecos[0]) f.endereco.value = conta.enderecos[0].texto;
  }
  async function calcularFrete(extra = {}) {
    const r = await fetch('/api/food/frete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loja: loja.slug, subtotal: subtotal(), ...extra }) }).then((x) => x.json()).catch(() => ({}));
    if (r.naoEncontrado) { $('fFrete').textContent = 'Endereço não encontrado. Confira ou use sua localização.'; return; }
    if (r.fora) { frete = null; $('fFrete').textContent = `Fora da área de entrega (${String(r.km).replace('.', ',')} km).`; return renderCarrinho(); }
    frete = { valor: r.valor ?? 0 };
    if (r.porKm) { ponto = { lat: r.lat, lng: r.lng }; $('fFrete').textContent = `Entrega: ${String(r.km).replace('.', ',')} km · ${r.valor ? brl(r.valor) : 'grátis'}${r.encontrado ? ` (${r.encontrado})` : ''}`; }
    renderCarrinho();
  }
  $('fGps').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(
    (p) => calcularFrete({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => { $('fFrete').textContent = 'Não foi possível pegar sua localização. Digite o endereço e toque em Calcular.'; }, { enableHighAccuracy: true, timeout: 10000 }));
  $('fCalc').addEventListener('click', () => calcularFrete({ endereco: $('fPedido').endereco.value }));
  $('fPedido').addEventListener('change', renderCarrinho);
  $('fPedido').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = $('fPedido'), bt = $('fEnviar');
    bt.disabled = true; $('fErro').textContent = '';
    const corpo = {
      loja: loja.slug, receber: f.receber.value, pagamento: f.pagamento.value, troco: f.troco.value.replace(/[^\d,.]/g, '').replace(',', '.'), ponto,
      itens: sacola.itens.map(({ itemId, variacaoId, quantidade, escolhas, observacao }) => ({ itemId, variacaoId, quantidade, escolhas, observacao })),
      comprador: { nome: f.nome.value, whatsapp: f.whatsapp.value, endereco: f.endereco.value, observacao: f.observacao.value },
    };
    const r = await fetch('/api/food/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null);
    const d = await r?.json().catch(() => ({})) ?? {};
    bt.disabled = false;
    if (!r?.ok) { $('fErro').textContent = d.erro || 'Não deu para enviar. Tente de novo.'; return; }
    delete sacolas[loja.slug]; sacola = null; gravar(); // os outros restaurantes continuam na sacola
    if (d.initPoint) { location.href = d.initPoint; return; }
    location.href = d.acompanhar;
  });

  // ---------- acompanhamento ----------
  async function acompanhar(id, t) {
    $('fLista').hidden = true; $('fRest').hidden = true; $('fAcomp').hidden = false;
    pintarSacola(); // outros restaurantes que ainda estão na sacola continuam à vista
    const d = await fetch(`/api/food/acompanhar/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!d) { $('fAcomp').innerHTML = '<p class="empty">Pedido não encontrado.</p>'; return; }
    const pago = d.pagamento === 'approved' ? 'Pagamento aprovado' : d.pagamento === 'na_entrega' ? 'Pagamento na entrega' : 'Aguardando o pagamento';
    $('fAcomp').innerHTML = `<h1>Pedido #${d.numero}</h1><p class="food-status">${esc(d.rotulo)}</p><p class="note">${esc(pago)} · total ${brl(d.total)} · ${d.receber === 'entrega' ? 'entrega' : 'retirada'}</p>
      <ul>${d.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul><p class="note">Esta página atualiza sozinha. Você também recebe os avisos no WhatsApp.</p>`;
    if (!['entregue', 'concluido', 'cancelado'].includes(d.situacao)) setTimeout(() => acompanhar(id, t), 15000);
  }

  // ---------- rotas e eventos ----------
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-rest]'); if (r) { e.preventDefault(); history.pushState(null, '', r.getAttribute('href')); return abrirRest(r.dataset.rest); }
    const i = e.target.closest('[data-item]'); if (i) return abrirItem(i.dataset.item);
    const tp = e.target.closest('[data-tipo]'); if (tp) { tipo = tp.dataset.tipo; return renderLista(); }
    const q = e.target.closest('[data-qtd]'); if (q) { qtd = Math.min(50, Math.max(1, qtd + Number(q.dataset.qtd))); return atualizarItem(); }
    const rm = e.target.closest('[data-remover]'); if (rm) { sacola.itens.splice(Number(rm.dataset.remover), 1); gravar(); if (!sacola.itens.length) { sacola = null; $('fCarrinho').close(); } else renderCarrinho(); return pintarSacola(); }
    const ti = e.target.closest('[data-tirar]'); if (ti) { sacolas[ti.dataset.tirar].itens.splice(Number(ti.dataset.n), 1); gravar(); renderSacolas(); return pintarSacola(); }
    const fi = e.target.closest('[data-finalizar]'); if (fi) return finalizar(fi.dataset.finalizar);
    if (e.target.closest('[data-fechar]')) e.target.closest('dialog').close();
  });
  $('fSacola').addEventListener('click', abrirSacolas);
  $('fBusca').addEventListener('input', renderLista);
  $('fAbertos').addEventListener('change', renderLista);
  async function rota() {
    const q = new URLSearchParams(location.search);
    if (q.get('pedido')) return acompanhar(q.get('pedido'), q.get('t') || '');
    const m = location.pathname.match(/^\/alimentacao\/([a-z0-9-]+)/);
    if (m) return abrirRest(m[1]);
    $('fRest').hidden = true; $('fAcomp').hidden = true; $('fLista').hidden = false; pintarSacola();
    document.title = 'Alimentação · CITshop Food';
    restaurantes = await fetch('/api/food/restaurantes').then((x) => x.json()).catch(() => []);
    renderLista();
  }
  addEventListener('popstate', rota);
  rota();
})();
