// Painel da loja: abas (Início, Pedidos, Produtos, Entrega, Loja), cadastro, login, produtos com fotos, dados e assinatura.
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

  // Convite de parceria (/painel?convite=...): confere o link e já preenche o que ele traz.
  const convite = new URLSearchParams(location.search).get('convite');
  let conviteValido = false;
  if (convite) {
    api(`/api/painel/convite/${encodeURIComponent(convite)}`).then((c) => {
      conviteValido = true;
      mostrarMsg($('avisoConvite'), 'Você foi convidada(o) para ser loja parceira: sem mensalidade, só R$ 1,00 por venda feita pelo site, com pagamento direto no Mercado Pago. Este link serve para uma loja só.', 'ok');
      const f = $('fCad');
      if (c.nome) f.nome.value = c.nome;
      if (c.email) { f.email.value = c.email; f.email.readOnly = true; }
      if (c.whatsapp) f.whatsapp.value = c.whatsapp;
    }).catch((err) => mostrarMsg($('avisoConvite'), `${err.message} Você ainda pode criar a sua loja na assinatura.`));
  }
  $('fCad').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try {
        const d = dados(e.target);
        mostrar(await api('/api/painel/cadastro', { metodo: 'POST', json: { ...d, aceite: e.target.aceite.checked, ...(conviteValido && { convite }) } }));
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
    ativa: (s) => `Assinatura ativa${s.plano?.precoContratado ? ` (${brl.format(s.plano.precoContratado)} por mês)` : ''}. Seus produtos aparecem na vitrine, na frente dos afiliados.`,
    vencida: (s) => s.loja.assinatura?.status === 'pausada'
      ? 'A cobrança da assinatura está pausada no Mercado Pago (pagamento em atraso). Regularize para voltar à vitrine; o seu benefício continua valendo.'
      : s.loja.assinatura?.status === 'pendente'
      ? 'Estamos aguardando a confirmação do pagamento no Mercado Pago. Assim que confirmar, seus produtos voltam pra vitrine.'
      : 'Seu teste acabou e seus produtos saíram da vitrine. Assine para voltar a aparecer.',
    suspensa: () => 'Sua loja foi suspensa pela CIT Shopping. Fale com a gente pelo WhatsApp da CITmax.',
  };
  const ROTULO = { parceira: 'Loja Parceira', teste: 'Teste grátis', ativa: 'Assinatura ativa', vencida: 'Fora da vitrine', suspensa: 'Suspensa' };
  const ROTULO_DISPONIBILIDADE = { disponivel: 'Disponível', 'sob-encomenda': 'Sob encomenda', consulte: 'Consultar disponibilidade' };

  // ---------- vendas e pedidos ----------
  const PAGAMENTO = { approved: 'Pago', pending: 'Aguardando pagamento', in_process: 'Pagamento em análise', rejected: 'Pagamento recusado', cancelled: 'Pagamento cancelado', refunded: 'Pagamento devolvido' };
  const ETAPA = { novo: 'Novo', atendimento: 'Em atendimento', vendido: 'Vendido', cancelado: 'Cancelado' };
  // Entrega separada do pagamento e do atendimento: opções conforme o cliente vai receber ou retirar.
  const ENVIO_ENTREGA = { aguardando: 'Aguardando', preparando: 'Preparando', saiu: 'Saiu para entrega', entregue: 'Entregue' };
  const ENVIO_RETIRADA = { aguardando: 'Aguardando', preparando: 'Preparando', pronto: 'Pronto para retirar', retirado: 'Retirado' };
  const ROTULO_ENVIO = { ...ENVIO_ENTREGA, ...ENVIO_RETIRADA };
  function renderPedidos() {
    const origem = $('fOrigem').value, etapa = $('fEtapa').value, busca = $('fBusca').value.trim().toLowerCase();
    const digitos = busca.replace(/\D/g, '');
    const lista = (estado.pedidos ?? []).filter((p) => {
      const c = p.comprador ?? {};
      return (!origem || (p.origem === 'whatsapp' ? 'whatsapp' : 'site') === origem) && (!etapa || (p.etapa ?? 'novo') === etapa)
        && (!busca || (c.nome ?? '').toLowerCase().includes(busca) || p.id.toLowerCase().includes(busca) || (digitos && (c.whatsapp ?? '').includes(digitos)));
    });
    $('pedidos').innerHTML = lista.length ? lista.map((p) => {
      const c = p.comprador ?? {};
      const doSite = p.origem !== 'whatsapp';
      return `<div class="venda">
        <div class="venda-selos"><span class="st">${doSite ? 'Pago no site' : 'Pedido no WhatsApp'}</span>${doSite ? `<span class="st ${esc(p.status)}">${esc(PAGAMENTO[p.status] ?? p.status)}</span>` : ''}<small>${esc(p.id.startsWith('P-') ? p.id : '')}</small></div>
        ${p.itens?.length > 1
          ? `<b>${p.itens.length} produtos · ${brl.format(p.valorTotal)}</b><ul class="venda-itens">${p.itens.map((i) => `<li>${esc(String(i.quantidade))}x ${esc(i.nome)}${i.observacao ? ` <small>(${esc(i.observacao)})</small>` : ''} · ${brl.format(i.preco * i.quantidade)}</li>`).join('')}</ul>`
          : `<b>${esc(String(p.quantidade))}x ${esc(p.produtoNome ?? '')} · ${brl.format(p.valorTotal)}</b>${p.itens?.[0]?.observacao ? `<span>${esc(p.itens[0].observacao)}</span>` : ''}`}
        <span>${esc(c.nome ?? '')}</span>
        <span>${c.receber === 'entrega' ? `Entregar em: ${esc(c.endereco ?? '')}` : 'Vai retirar na loja'}${c.observacao ? ` · ${esc(c.observacao)}` : ''}</span>
        ${p.entrega ? `<span>Entrega ${esc(String(p.entrega.km).replace('.', ','))} km: ${p.entrega.valor ? brl.format(p.entrega.valor) : 'grátis'}</span>` : ''}
        ${c.whatsapp || p.entrega ? `<div class="acoes-pedido">${c.whatsapp ? `<a class="acao-pedido zap" href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">Chamar no WhatsApp</a>` : ''}${p.entrega ? `<a class="acao-pedido" href="https://www.google.com/maps?q=${esc(p.entrega.lat)},${esc(p.entrega.lng)}" target="_blank" rel="noopener">Abrir no mapa</a>` : ''}</div>` : ''}
        <div class="venda-rodape"><small>${new Date(p.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
          <label>Atendimento <select data-pedido="${esc(p.id)}" aria-label="Atendimento do pedido ${esc(p.id)}">${Object.entries(ETAPA).map(([k, n]) => `<option value="${k}"${(p.etapa ?? 'novo') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>${c.receber === 'entrega' ? 'Entrega' : 'Retirada'} <select data-envio="${esc(p.id)}" aria-label="Entrega do pedido ${esc(p.id)}">${Object.entries(c.receber === 'entrega' ? ENVIO_ENTREGA : ENVIO_RETIRADA).map(([k, n]) => `<option value="${k}"${(p.envio ?? 'aguardando') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
        ${p.historico?.length ? `<details class="hist-pedido"><summary>Histórico (${p.historico.length})</summary><ul>${p.historico.map((h) => `<li>${new Date(h.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}: ${h.campo === 'envio' ? 'entrega' : 'atendimento'} → ${esc(ROTULO_ENVIO[h.para] ?? ETAPA[h.para] ?? h.para)}</li>`).join('')}</ul></details>` : ''}
      </div>`;
    }).join('') : `<p class="note" style="font-size:13px;margin:0">${(estado.pedidos ?? []).length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido ainda. Quando um cliente pagar pelo site ou pedir pelo seu WhatsApp, ele aparece aqui.'}</p>`;
  }
  ['fOrigem', 'fEtapa', 'fBusca'].forEach((id) => $(id).addEventListener('input', renderPedidos));
  $('fCupom').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try { mostrar(await api('/api/painel/cupons', { metodo: 'POST', json: dados(e.target) })); e.target.reset(); mostrarMsg($('mCupom'), 'Cupom publicado.', 'ok'); }
      catch (err) { mostrarMsg($('mCupom'), err.message); }
    });
  });
  $('listaCupons').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-apagar-cupom]');
    if (!b || !confirm('Apagar este cupom?')) return;
    try { mostrar(await api(`/api/painel/cupons/${encodeURIComponent(b.dataset.apagarCupom)}`, { metodo: 'DELETE' })); }
    catch (err) { mostrarMsg($('mCupom'), err.message); }
  });
  $('pedidos').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-pedido], select[data-envio]');
    if (!sel) return;
    sel.disabled = true;
    const id = sel.dataset.pedido ?? sel.dataset.envio;
    try { mostrar(await api(`/api/painel/pedidos/${encodeURIComponent(id)}`, { metodo: 'PATCH', json: sel.dataset.pedido ? { etapa: sel.value } : { envio: sel.value } })); }
    catch (err) { mostrarMsg($('mPedidos'), err.message); sel.disabled = false; }
  });

  // ---------- abas (#inicio, #pedidos, #produtos, #loja) ----------
  function irPara() {
    const nome = location.hash.slice(1);
    const aba = document.querySelector(`[data-aba="${nome}"]`) ? nome : 'inicio';
    document.querySelectorAll('[data-aba]').forEach((el) => { el.hidden = el.dataset.aba !== aba; });
    document.querySelectorAll('#abas a').forEach((a) => { a.toggleAttribute('aria-current', a.getAttribute('href') === `#${aba}`); });
    if (aba === 'entrega' && estado) abrirEntrega();
  }
  // Trocou de aba (barra de baixo no celular): começa do topo da seção.
  addEventListener('hashchange', () => { irPara(); window.scrollTo(0, 0); });

  // ---------- entrega por distância: pino da loja no mapa + faixas de km ----------
  const CORES_FAIXA = ['#00C896', '#008B87', '#036271', '#E0A800', '#E07A00', '#C8323A'];
  const num = (v) => Number(String(v).trim().replace(',', '.'));
  let mapa = null, pino = null, circulos = [], aviso = null;
  // O Leaflet só carrega quando a aba Entrega abre (arquivo do próprio site, por causa da CSP).
  function carregarLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((ok, falha) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.append(css);
      const js = document.createElement('script'); js.src = '/vendor/leaflet/leaflet.js'; js.onload = ok; js.onerror = falha; document.head.append(js);
    });
  }
  function linhaFaixa(f = {}) {
    const d = document.createElement('div');
    d.className = 'faixa';
    d.innerHTML = `<label>Até (km)<input data-km inputmode="decimal" placeholder="3" value="${f.ateKm ?? ''}"></label>
      <label>Cobrar (R$)<input data-valor inputmode="decimal" placeholder="5,00" value="${f.valor != null ? String(f.valor).replace('.', ',') : ''}"></label>
      <button type="button" class="faixa-rm" aria-label="Remover faixa">✕</button>`;
    return d;
  }
  const faixasDoForm = () => [...$('eFaixas').querySelectorAll('.faixa')].map((d) => ({ ateKm: num(d.querySelector('[data-km]').value), valor: num(d.querySelector('[data-valor]').value || 0) })).filter((f) => f.ateKm > 0);
  function desenharCirculos() {
    circulos.forEach((c) => c.remove());
    circulos = [];
    if (!mapa || !pino) return;
    const ponto = pino.getLatLng();
    // Maior primeiro: as faixas menores ficam por cima e continuam clicáveis.
    [...faixasDoForm()].sort((x, y) => y.ateKm - x.ateKm).forEach((f) => {
      const i = faixasDoForm().sort((x, y) => x.ateKm - y.ateKm).findIndex((g) => g.ateKm === f.ateKm);
      const cor = CORES_FAIXA[i % CORES_FAIXA.length];
      circulos.push(L.circle(ponto, { radius: f.ateKm * 1000, color: cor, weight: 2, fillColor: cor, fillOpacity: 0.1 }).bindTooltip(`até ${f.ateKm} km: ${brl.format(f.valor)}`).addTo(mapa));
    });
  }
  function marcarLoja(lat, lng, ajustar = true) {
    if (!pino) {
      pino = L.marker([lat, lng], { draggable: true, keyboard: true, title: 'Sua loja', icon: L.divIcon({ className: 'pino-loja', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(mapa);
      pino.on('drag dragend', desenharCirculos);
    } else pino.setLatLng([lat, lng]);
    desenharCirculos();
    // Enquadra a faixa maior para a loja ver todos os círculos; sem faixas, aproxima do pino.
    if (ajustar) circulos.length ? mapa.fitBounds(circulos[0].getBounds(), { padding: [12, 12], animate: false }) : mapa.setView([lat, lng], 14);
  }
  async function abrirEntrega() {
    if (mapa) { setTimeout(() => mapa.invalidateSize(), 50); return; }
    try { await carregarLeaflet(); } catch { return mostrarMsg($('mEntrega'), 'Não foi possível carregar o mapa. Atualize a página e tente de novo.'); }
    const l = estado.loja;
    mapa = L.map('eMapa', { center: [l.local?.lat ?? -14.2, l.local?.lng ?? -51.9], zoom: l.local ? 14 : 4, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(mapa);
    mapa.on('click', (e) => marcarLoja(e.latlng.lat, e.latlng.lng, false));
    $('eFaixas').replaceChildren(...(l.frete?.faixas?.length ? l.frete.faixas : [{ ateKm: 3, valor: 5 }, { ateKm: 6, valor: 8 }]).map(linhaFaixa));
    $('fEntrega').gratisAcima.value = l.frete?.gratisAcima ? String(l.frete.gratisAcima).replace('.', ',') : '';
    $('eBusca').value = l.local?.endereco ?? '';
    $('eMostrar').checked = Boolean(l.local?.publico);
    $('eDesativar').hidden = !l.frete;
    if (l.local) marcarLoja(l.local.lat, l.local.lng);
    else { // sem ponto ainda: tenta começar pela cidade da loja
      try { const g = await api(`/api/painel/geocodificar?q=${encodeURIComponent(`${l.cidade}, Brasil`)}`); mapa.setView([g.lat, g.lng], 13); } catch { /* fica no Brasil inteiro */ }
    }
    setTimeout(() => mapa.invalidateSize(), 50);
  }
  $('eBuscar').addEventListener('click', async () => {
    const q = $('eBusca').value.trim();
    if (q.length < 6) return mostrarMsg($('mEntrega'), 'Digite o endereço completo: rua, número e cidade.');
    try { const g = await api(`/api/painel/geocodificar?q=${encodeURIComponent(q)}`); marcarLoja(g.lat, g.lng); mostrarMsg($('mEntrega'), `Encontramos: ${g.nome}.${g.aproximado ? ' Localizamos só a rua: arraste o pino até o ponto exato da loja.' : ' Confira o pino e ajuste se precisar.'}`, 'ok'); }
    catch (err) { mostrarMsg($('mEntrega'), err.message); }
  });
  $('eGps').addEventListener('click', () => {
    if (!navigator.geolocation) return mostrarMsg($('mEntrega'), 'Este aparelho não informa a localização. Busque pelo endereço.');
    navigator.geolocation.getCurrentPosition((p) => { marcarLoja(p.coords.latitude, p.coords.longitude); mostrarMsg($('mEntrega'), 'Localização marcada. Confira o pino.', 'ok'); },
      () => mostrarMsg($('mEntrega'), 'Não conseguimos pegar sua localização. Permita o acesso ou busque pelo endereço.'), { enableHighAccuracy: true, timeout: 10000 });
  });
  $('eAddFaixa').addEventListener('click', () => {
    if ($('eFaixas').children.length >= 6) return mostrarMsg($('mEntrega'), 'No máximo 6 faixas.');
    $('eFaixas').append(linhaFaixa());
  });
  $('eFaixas').addEventListener('click', (e) => { if (e.target.closest('.faixa-rm')) { e.target.closest('.faixa').remove(); desenharCirculos(); } });
  $('eFaixas').addEventListener('input', desenharCirculos);
  $('fEntrega').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pino) return mostrarMsg($('mEntrega'), 'Marque no mapa onde a loja fica.');
    enviando(e.submitter, async () => {
      try {
        const { lat, lng } = pino.getLatLng();
        const s = await api('/api/painel/entrega', { metodo: 'PUT', json: { local: { lat, lng, endereco: $('eBusca').value }, mostrarLocal: $('eMostrar').checked, faixas: faixasDoForm(), gratisAcima: $('fEntrega').gratisAcima.value ? num($('fEntrega').gratisAcima.value) : null } });
        estado.loja = s.loja;
        $('eDesativar').hidden = !s.loja.frete;
        amostra();
        mostrarMsg($('mEntrega'), s.loja.frete ? 'Salvo. Os clientes já veem o valor da entrega antes de pagar.' : 'Localização salva. A entrega por distância está desligada: a entrega fica combinada com a loja.', 'ok');
      } catch (err) { mostrarMsg($('mEntrega'), err.message); }
    });
  });
  $('eDesativar').addEventListener('click', async () => {
    if (!confirm('Desativar a entrega por distância? A entrega volta a ser combinada com o cliente pelo WhatsApp.')) return;
    try { estado.loja = (await api('/api/painel/entrega', { metodo: 'DELETE' })).loja; $('eDesativar').hidden = true; mostrarMsg($('mEntrega'), 'Entrega por distância desativada.', 'ok'); }
    catch (err) { mostrarMsg($('mEntrega'), err.message); }
  });

  // ---------- início: números do dia e próximos passos ----------
  function renderInicio() {
    const r = estado.resumo;
    const cartao = (rotulo, valor, sub, href) => `<${href ? `a href="${href}"` : 'div'} class="cartao${href && r.novos ? ' destaque' : ''}"><span>${rotulo}</span><b>${valor}</b><small>${sub}</small></${href ? 'a' : 'div'}>`;
    const vendas = (v) => `${v.qtd} ${v.qtd === 1 ? 'venda' : 'vendas'}`;
    $('cartoes').innerHTML = [
      cartao('Pedidos novos', r.novos, r.novos ? 'Toque para atender' : 'Nenhum esperando', '#pedidos'),
      cartao('Hoje', brl.format(r.hoje.valor), vendas(r.hoje)),
      cartao('Últimos 7 dias', brl.format(r.semana.valor), vendas(r.semana)),
      cartao('Últimos 30 dias', brl.format(r.mes.valor), vendas(r.mes)),
    ].join('');
    // Loja que vende pelo site e ainda não conectou o Mercado Pago: aviso grande no topo do Início. Depois de conectar, fica só na aba Loja.
    $('avisoMp').hidden = !(estado.loja.modeloCobranca === 'comissao_fixa' && !estado.loja.mpConectado);
    // Financeiro do mês: parceiro vê o que entrou pelo site e a comissão da CIT; assinante vê vendas e a mensalidade.
    const fin = estado.financeiro;
    if (fin) {
      const parceiro = estado.loja.modeloCobranca === 'comissao_fixa';
      const c = (rotulo, valor, sub) => `<div class="cartao"><span>${rotulo}</span><b>${valor}</b><small>${sub}</small></div>`;
      $('cartoesFinanceiro').innerHTML = [
        c('Vendas no mês', brl.format(fin.vendasMes.valor), `${fin.vendasMes.qtd} ${fin.vendasMes.qtd === 1 ? 'venda' : 'vendas'}`),
        ...(parceiro ? [
          c('Recebido pelo site', brl.format(fin.recebidoSiteMes), 'direto na sua conta Mercado Pago'),
          c('Aguardando pagamento', brl.format(fin.aguardandoPagamento), 'Pix ou cartão em análise'),
          c('Reembolsado', brl.format(fin.reembolsadoMes), 'no mês'),
          c('Comissão CIT', brl.format(fin.comissaoMes ?? 0), 'R$ 1 por unidade vendida'),
        ] : [c('Mensalidade', estado.plano?.precoContratado ? brl.format(estado.plano.precoContratado) : brl.format(estado.preco), estado.plano?.beneficio ? `com ${estado.plano.beneficio.codigo}` : 'por mês')]),
      ].join('');
      $('notaFinanceiro').textContent = parceiro
        ? 'Os pagamentos pelo site caem na sua conta do Mercado Pago; a CIT recebe só a comissão por unidade.'
        : 'Lojas de assinatura não pagam comissão sobre as vendas.';
    }
    $('abaNovos').hidden = !r.novos;
    $('abaNovos').textContent = r.novos;
    const rank = (lista, texto) => lista.length ? lista.map((i) => `<li><span>${esc(i.nome)}</span><b>${texto(i)}</b></li>`).join('') : '<li class="vazio">Ainda sem dados.</li>';
    $('rankPedidos').innerHTML = rank(r.maisPedidos, (i) => `${i.quantidade}x`);
    $('rankVistos').innerHTML = rank(r.maisVistos, (i) => i.cliques);
    $('rankVistos').parentElement.hidden = estado.loja.modeloCobranca === 'comissao_fixa';
    const passos = [];
    if (!estado.produtos.length) passos.push(['Cadastre seu primeiro produto: tire as fotos pelo celular.', '#produtos', 'Cadastrar']);
    if (!estado.loja.logo) passos.push(['Coloque o logo da loja para ela aparecer com a sua marca.', '#loja', 'Adicionar logo']);
    const baixos = estado.produtos.filter((p) => p.ativo && !p.bloqueado && (esgotado(p) || (porQuantidade() && p.estoque != null && p.estoque <= 2)));
    $('blocoEstoqueBaixo').hidden = !baixos.length;
    $('listaEstoqueBaixo').innerHTML = baixos.map((p) => `<li><span>${esc(p.nome)}: <b>${esgotado(p) ? 'esgotado' : `restam ${p.estoque}`}</b></span><a class="btn sec" href="#produtos">Atualizar</a></li>`).join('');
    $('proximos').hidden = !passos.length;
    $('listaProximos').innerHTML = passos.map(([t, href, b]) => `<li><span>${t}</span><a class="btn sec" href="${href}">${b}</a></li>`).join('');
  }

  // Atualiza só pedidos e resumo (sem mexer nos formulários que a pessoa pode estar preenchendo).
  async function atualizar() {
    if (document.hidden || $('vPainel').hidden) return;
    try {
      const s = await api('/api/painel/eu');
      estado.pedidos = s.pedidos; estado.resumo = s.resumo;
      if (!document.activeElement?.closest('#lista')) { estado.produtos = s.produtos; renderLista(); }
      renderPedidos(); renderInicio();
    } catch { /* sessão expirada ou sem rede: tenta de novo no próximo ciclo */ }
  }
  setInterval(atualizar, 60_000);
  document.addEventListener('visibilitychange', atualizar);

  // Primeiro acesso com senha provisória: só aparece a troca de senha, até a loja escolher a dela.
  $('fTroca').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = dados(e.target);
    if (d.nova !== d.repita) return mostrarMsg($('eTroca'), 'As duas senhas novas não são iguais.');
    enviando(e.submitter, async () => {
      try {
        await api('/api/painel/senha', { metodo: 'POST', json: { atual: d.atual, nova: d.nova } });
        e.target.reset();
        mostrarMsg($('eTroca'), '');
        mostrar(await api('/api/painel/eu'));
      } catch (err) { mostrarMsg($('eTroca'), err.message); }
    });
  });

  function mostrar(s) {
    estado = s;
    $('vTroca').hidden = !s.loja.trocarSenha;
    if (s.loja.trocarSenha) { $('vAuth').hidden = true; $('vPainel').hidden = true; $('sair').hidden = false; return; }
    $('vAuth').hidden = true;
    $('vPainel').hidden = false;
    $('sair').hidden = false;
    $('pNome').textContent = s.loja.nome;
    $('pLink').innerHTML = `Sua página: <a href="/${esc(s.loja.slug)}" target="_blank">${esc(location.host)}/${esc(s.loja.slug)}</a>`;
    // Loja de comissão vende só pelo site (sem botão de WhatsApp): contar cliques de WhatsApp não faz sentido para ela.
    const soSite = s.loja.modeloCobranca === 'comissao_fixa';
    $('pContatoResumo').textContent = soSite ? '' : `${s.cliquesContatoLoja ?? 0} cliques para o WhatsApp da loja`;
    $('pStatus').className = `pill ${s.status}`;
    $('pStatus').textContent = ROTULO[s.status] || esc(s.status);
    $('pStatusTxt').textContent = (TEXTO[s.status] || TEXTO.teste)(s);
    $('assinar').hidden = s.status === 'ativa' || s.status === 'suspensa' || s.status === 'parceira';
    $('assinar').textContent = `Assinar ${brl.format(s.preco)}/mês`;
    // Plano: cupom de assinatura (ex.: FUNDADOR50) para quem ainda não assinou, e o benefício já aplicado.
    const pl = s.plano ?? {};
    $('fCupomPlano').hidden = !(pl.campanha && !['ativa', 'suspensa', 'parceira'].includes(s.status));
    if (pl.campanha) $('cupomPlanoAjuda').textContent = `${pl.campanha.codigo}: ${pl.campanha.percentual}% na mensalidade (${brl.format(pl.campanha.preco)}/mês) até ${new Date(pl.campanha.fim).toLocaleDateString('pt-BR')}`;
    $('pBeneficio').hidden = !pl.beneficio;
    $('pBeneficio').textContent = pl.beneficio ? `Benefício ${pl.beneficio.codigo}: ${pl.beneficio.percentual}% de desconto na mensalidade, a partir da primeira cobrança e enquanto a assinatura continuar ativa.` : '';
    const f = $('fLoja');
    for (const k of ['nome', 'responsavel', 'whatsapp', 'cidade', 'categoria', 'entrega', 'horario', 'bairrosAtendidos', 'prazoEntrega', 'instagram', 'telefone']) f[k].value = s.loja[k] ?? '';
    $('mpStatus').textContent = s.loja.mpConectado ? 'Conta Mercado Pago conectada: as vendas pelo site caem nela.' : 'Nenhuma conta conectada ainda.';
    $('mpConectar').textContent = s.loja.mpConectado ? 'Conectar outra conta' : 'Conectar Mercado Pago';
    $('mpDesconectar').hidden = !s.loja.mpConectado;
    renderPedidos();
    renderInicio();
    irPara();
    $('listaCupons').innerHTML = (s.cupons ?? []).map((c) => `<div class="venda"><b>${esc(c.codigo)}</b><span>${esc(c.descricao)}</span>
      <div class="venda-rodape"><small>Válido até ${new Date(`${c.validoAte}T12:00:00`).toLocaleDateString('pt-BR')}</small><button class="btn sec" type="button" data-apagar-cupom="${esc(c.id)}">Apagar</button></div></div>`).join('');
    $('vCor').value = s.loja.cor || '#036271';
    $('vSobre').value = s.loja.sobre ?? '';
    $('tirarLogo').hidden = !s.loja.logo;
    amostra();
    aplicarModoEstoque();
    renderLista();
    renderInicio();
  }

  // ---------- aparência ----------
  const amostra = () => {
    const f = $('fLoja');
    $('amostra').outerHTML = window.CIT.cabecalhoLoja({
      ...estado.loja, cor: $('vCor').value, sobre: $('vSobre').value,
      localEndereco: estado.loja.local?.publico ? estado.loja.local.endereco : '', // como o cliente vê (só se a loja escolheu mostrar)
      horario: f.horario.value, bairrosAtendidos: f.bairrosAtendidos.value, prazoEntrega: f.prazoEntrega.value,
      instagram: f.instagram.value.replace(/^@/, ''), telefone: estado.loja.modeloCobranca === 'comissao_fixa' ? '' : f.telefone.value, // como o cliente vê
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

  // ---------- estoque: simples (tem / esgotado) ou por quantidade (o site desconta a cada venda) ----------
  const porQuantidade = () => estado.loja.modoEstoque === 'quantidade';
  const esgotado = (p) => (porQuantidade() ? p.estoque != null && p.estoque <= 0 : Boolean(p.esgotado));
  function linhaEstoque(p) {
    const pill = esgotado(p) ? '<span class="pill vencida">Esgotado</span>' : '<span class="pill ativa">Tem estoque</span>';
    return porQuantidade()
      ? `<div class="est-linha">${pill}<label>Estoque <input class="est-input" type="number" min="0" max="99999" inputmode="numeric" placeholder="sem contagem" value="${p.estoque ?? ''}" data-est="${esc(p.id)}"></label></div>`
      : `<div class="est-linha">${pill}<button class="btn sec" data-esg="${esc(p.id)}">${p.esgotado ? 'Voltou ao estoque' : 'Marcar esgotado'}</button></div>`;
  }
  // O estoque de um produto que já existe muda na linha da lista (o formulário pode ficar desatualizado); no formulário só entra o de produto novo.
  function camposEstoqueDoForm() {
    const q = porQuantidade();
    document.querySelector('.est-simples').hidden = Boolean(editando) || q;
    document.querySelector('.est-qtd').hidden = Boolean(editando) || !q;
  }
  function aplicarModoEstoque() {
    const q = porQuantidade();
    $('modoEstoque').value = q ? 'quantidade' : 'simples';
    camposEstoqueDoForm();
    $('modoEstoqueAjuda').textContent = q
      ? 'Digite quantas unidades você tem. A cada venda o site desconta e, quando chegar a zero, o produto some da vitrine e avisamos você no WhatsApp.'
      : 'Quando um produto acabar, toque em "Marcar esgotado". Ele some da vitrine até você tocar em "Voltou ao estoque".';
  }
  $('modoEstoque').addEventListener('change', async () => {
    try {
      const d = await api('/api/painel/estoque', { metodo: 'PUT', json: { modo: $('modoEstoque').value } });
      estado.loja = d.loja; estado.produtos = d.produtos;
    } catch (err) { alert(err.message); }
    aplicarModoEstoque(); renderLista(); renderInicio();
  });

  function renderLista() {
    const ps = estado.produtos;
    $('lista').innerHTML = ps.length ? ps.map((p) => `<div class="item ${p.ativo && !p.bloqueado ? '' : 'off'}">
        <img src="${esc(p.fotos[0])}" alt="">
        <div><b>${esc(p.nome)}</b><br><small class="note">${brl.format(p.preco)} · ${esc(D[p.dept]?.n ?? '')} · ${esc(ROTULO_DISPONIBILIDADE[p.disponibilidade] ?? ROTULO_DISPONIBILIDADE.consulte)}${p.bloqueado ? ' · ocultado pela CIT Shopping' : p.ativo ? '' : ' · pausado'}${p.marca ? ` · ${esc(p.marca)}` : ''}${p.sku ? ` · SKU ${esc(p.sku)}` : ''}${p.variacoes?.length ? ` · ${esc(p.variacoes.map((g) => g.nome).join(' e '))}` : ''}</small>
          ${linhaEstoque(p)}</div>
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
    camposEstoqueDoForm();
    if (p) for (const k of ['nome', 'dept', 'descricao', 'disponibilidade']) f[k].value = p[k] ?? 'consulte';
    f.esgotado.value = p?.esgotado ? 'true' : 'false';
    f.estoque.value = p?.estoque ?? '';
    f.marca.value = p?.marca ?? '';
    f.sku.value = p?.sku ?? '';
    f.variacoes.value = (p?.variacoes ?? []).map((g) => `${g.nome}: ${g.opcoes.join(', ')}`).join('\n');
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
    const p = estado.produtos.find((x) => x.id === (b.dataset.ed ?? b.dataset.at ?? b.dataset.del ?? b.dataset.esg));
    if (!p) return;
    try {
      if (b.dataset.ed) return abrirForm(p);
      if (b.dataset.at) await api(`/api/painel/produtos/${p.id}`, { metodo: 'PATCH', json: { ativo: !p.ativo } });
      if (b.dataset.esg) await api(`/api/painel/produtos/${p.id}`, { metodo: 'PATCH', json: { esgotado: !p.esgotado } });
      if (b.dataset.del) {
        if (!confirm(`Excluir "${p.nome}"? Isso não pode ser desfeito.`)) return;
        await api(`/api/painel/produtos/${p.id}`, { metodo: 'DELETE' });
      }
      mostrar(await api('/api/painel/eu'));
    } catch (err) { alert(err.message); }
  });

  // Quantidade digitada direto na linha do produto: salva ao sair do campo.
  $('lista').addEventListener('change', async (e) => {
    const campo = e.target.closest('input[data-est]');
    if (!campo) return;
    const p = estado.produtos.find((x) => x.id === campo.dataset.est);
    try { Object.assign(p, await api(`/api/painel/produtos/${p.id}`, { metodo: 'PATCH', json: { estoque: campo.value } })); }
    catch (err) { alert(err.message); }
    renderLista(); renderInicio();
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
  $('fCupomPlano').addEventListener('submit', (e) => {
    e.preventDefault();
    enviando(e.submitter, async () => {
      try { mostrar(await api('/api/painel/cupom-assinatura', { metodo: 'POST', json: dados(e.target) })); e.target.reset(); }
      catch (err) { mostrarMsg($('mCupomPlano'), err.message); }
    });
  });
  // Preço e campanha vêm do servidor (o preço não fica escrito no HTML).
  api('/api/planos').then((p) => {
    $('precoPlano').textContent = brl.format(p.precoMensal);
    if (p.campanha) mostrarMsg($('campanhaCadastro'), `Lojas fundadoras: com o cupom ${p.campanha.codigo} a mensalidade fica em ${brl.format(p.campanha.preco)} enquanto a assinatura continuar ativa. Vale para cadastros até ${new Date(p.campanha.fim).toLocaleDateString('pt-BR')}.`, 'ok');
  }).catch(() => {});
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
