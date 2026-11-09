// Vitrine: lê /api/vitrine (lojas locais já vêm na frente dos afiliados) e monta a loja.
(() => {
  const { DEPTS, D, ICON, esc, brl, svg } = window.CIT;
  const STORE = { ml: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', local: 'Lojas da região' };
  const BF = 'https://www.amazon.com.br/blackfriday?&linkCode=ll2&tag=citshop-20&linkId=19fc97704e392c8b7ad573364830ea50&ref_=as_li_ss_tl';
  const $ = (id) => document.getElementById(id);
  const num = new Intl.NumberFormat('pt-BR');
  let P = [], LOJAS = [];

  const off = (x) => (x.precoAntigo > x.preco ? Math.round((1 - x.preco / x.precoAntigo) * 100) : 0);
  const label = (x) => (x.loja === 'local' ? x.lojaNome : STORE[x.loja]);
  const hue = (x) => (D[x.dept] ?? D.casa).h;
  // Mesma regra do servidor: lojas locais primeiro, ordem preservada dentro de cada grupo.
  const ordenar = (l) => [...l.filter((x) => x.loja === 'local'), ...l.filter((x) => x.loja !== 'local')];
  const iniciais = (n) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const LISTS = {
    local: { t: 'Lojas da região', f: () => P.filter((x) => x.loja === 'local') },
    ofertas: { t: 'Maiores descontos', f: () => ordenar([...P].filter((x) => off(x) > 0).sort((a, b) => off(b) - off(a))) },
    ate100: { t: 'Tudo até R$ 100', f: () => ordenar(P.filter((x) => x.preco <= 100).sort((a, b) => a.preco - b.preco)) },
    casa: { t: 'Casa, cozinha e eletro', f: () => P.filter((x) => ['casa', 'cozinha', 'eletro', 'cama'].includes(x.dept)) },
    tech: { t: 'Tecnologia', f: () => P.filter((x) => ['tec', 'cel', 'info'].includes(x.dept)) },
    moda: { t: 'Moda e beleza', f: () => P.filter((x) => ['moda', 'calc', 'beleza'].includes(x.dept)) },
  };

  function shot(x, foto = x.fotos?.[0]) {
    const tag = off(x) ? `<span class="tag">-${off(x)}%</span>` : '';
    return foto
      ? `<div class="shot foto"><img src="${esc(foto)}" alt="" loading="lazy">${tag}`
      : `<div class="shot" style="--hue:${hue(x)}">${svg(x.dept)}${tag}`;
  }
  function card(x) {
    const nota = x.nota ? `<div class="rate"><b>★ ${x.nota.toFixed(1).replace('.', ',')}</b>${x.vendidos ? ` · ${num.format(x.vendidos)} vendidos` : ''}</div>` : '';
    const ship = x.loja === 'local' ? `<div class="ship">Entrega ou retirada em ${esc(x.cidade)}</div>` : x.queda ? `<div class="ship">↓ caiu ${brl.format(x.queda)}</div>` : '';
    const direto = x.loja !== 'local' && x.link;
    const abre = direto ? `<a class="card" href="${esc(x.link)}" target="_blank" rel="sponsored nofollow noopener" style="text-decoration:none">` : `<button class="card" data-p="${esc(x.id)}">`;
    return `${abre}${shot(x)}<span class="store" data-m="${esc(x.loja)}">${esc(label(x))}</span></div>
      <div class="body"><h3>${esc(x.nome)}</h3>${nota}${off(x) ? `<div class="old">${brl.format(x.precoAntigo)}</div>` : ''}
      <div class="price">${brl.format(x.preco)}</div>${ship}${direto ? `<div class="ship">Comprar na ${STORE[x.loja]} ↗</div>` : ''}</div>${direto ? '</a>' : '</button>'}`;
  }
  function rail(id, list) {
    const el = $(id);
    el.closest('section').hidden = !list.length;
    el.innerHTML = list.slice(0, 16).map(card).join('');
    const r = el.parentElement;
    if (r.querySelector('.nav-btn')) return;
    r.insertAdjacentHTML('beforeend', '<button class="nav-btn l" aria-label="Anteriores">‹</button><button class="nav-btn r" aria-label="Próximos">›</button>');
    r.querySelector('.l').onclick = () => el.scrollBy({ left: -el.clientWidth * 0.8, behavior: 'smooth' });
    r.querySelector('.r').onclick = () => el.scrollBy({ left: el.clientWidth * 0.8, behavior: 'smooth' });
  }

  // Carrossel
  const SLIDES = [
    { k: 'Black Friday', h: 'Black Friday Amazon', p: 'Descontos em todas as categorias, direto no carrinho.', c: 'Ver ofertas ↗', a: 'bag', href: BF, ext: true },
    { k: 'Compre perto', h: 'As lojas da sua cidade estão aqui', p: 'Escolha, chame a loja no WhatsApp e receba rápido.', c: 'Ver lojas →', a: 'shop', show: 'local' },
    { k: 'Venda na CITshop', h: 'Sua loja na frente das gigantes', p: '30 dias grátis pra testar. Depois, R$ 49,90 por mês.', c: 'Cadastrar minha loja →', a: 'shop', href: '/painel' },
  ];
  let cur = 0, timer;
  function renderSlides() {
    $('slides').innerHTML = SLIDES.map((s, i) => `<div class="slide" ${i ? 'hidden' : ''} aria-label="${i + 1} de ${SLIDES.length}">
      <div><span class="kicker">${s.k}</span><h2>${s.h}</h2><p>${s.p}</p>
      ${s.href ? `<a class="cta" href="${s.href}" ${s.ext ? 'target="_blank" rel="sponsored nofollow noopener"' : ''}>${s.c}</a>` : `<button class="cta" data-show="${s.show}">${s.c}</button>`}</div>
      <div class="art">${svg(s.a)}</div></div>`).join('') +
      `<div class="dots">${SLIDES.map((_, i) => `<button aria-label="Banner ${i + 1}" aria-current="${!i}"></button>`).join('')}</div>
       <button class="arr prev" aria-label="Banner anterior">‹</button><button class="arr next" aria-label="Próximo banner">›</button>`;
    $('slides').querySelectorAll('.dots button').forEach((b, i) => (b.onclick = () => go(i, true)));
    $('slides').querySelector('.prev').onclick = () => go(cur - 1, true);
    $('slides').querySelector('.next').onclick = () => go(cur + 1, true);
  }
  function go(i, user) {
    cur = (i + SLIDES.length) % SLIDES.length;
    $('slides').querySelectorAll('.slide').forEach((s, j) => (s.hidden = j !== cur));
    $('slides').querySelectorAll('.dots button').forEach((b, j) => b.setAttribute('aria-current', j === cur));
    if (user) start();
  }
  function start() {
    clearInterval(timer);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => go(cur + 1), 6000);
  }

  // Resultados (departamento, lista, loja, busca)
  const view = { list: [], store: '' };
  function showResults(title, list, head = '') {
    Object.assign(view, { list, store: '' });
    $('rtitle').textContent = title;
    $('rhead').innerHTML = head;
    $('homeview').hidden = true;
    $('resultsview').hidden = false;
    fecharMega();
    renderResults();
    scrollTo({ top: 0 });
  }
  function renderResults() {
    const chave = (x) => (x.loja === 'local' ? `local:${x.lojaSlug}` : x.loja);
    const nomes = new Map(view.list.map((x) => [chave(x), label(x)]));
    $('storechips').innerHTML = nomes.size > 1 ? [['', 'Todas as lojas'], ...nomes]
      .map(([k, n]) => `<button class="chip" data-chip="${esc(k)}" aria-pressed="${view.store === k}">${esc(n)}</button>`).join('') : '';
    const list = view.list.filter((x) => !view.store || chave(x) === view.store);
    $('rgrid').innerHTML = list.length ? list.map(card).join('') : '<p class="empty">Nenhum produto por aqui ainda. Tente outro departamento ou outra busca.</p>';
  }
  function goHome() {
    document.title = 'CITshop · ofertas e lojas da sua cidade';
    $('resultsview').hidden = true;
    $('homeview').hidden = false;
    $('q').value = '';
    if (location.pathname !== '/') history.pushState(null, '', '/');
    scrollTo({ top: 0 });
  }
  const byDept = (k) => showResults(D[k].n, ordenar(P.filter((x) => x.dept === k)));
  function bySeller(slug) {
    const l = LOJAS.find((x) => x.slug === slug);
    if (!l) return showResults('Loja não encontrada', []);
    const zap = `https://wa.me/${l.whatsapp}?text=${encodeURIComponent('Olá! Vi sua loja na CITshop.')}`;
    showResults('Produtos da loja', P.filter((x) => x.lojaSlug === slug),
      window.CIT.cabecalhoLoja(l, `<a class="btn" href="${zap}" target="_blank" rel="noopener">Falar no WhatsApp</a>`));
    document.title = `${l.nome} · CITshop`;
    if (location.pathname !== `/loja/${slug}`) history.pushState(null, '', `/loja/${slug}`);
  }

  // Janela do produto
  function openProduct(x) {
    const local = x.loja === 'local';
    const fotos = x.fotos?.length ? x.fotos : [null];
    const mostrar = (i) => {
      $('mshot').outerHTML = `${shot(x, fotos[i])}</div>`.replace('class="shot', 'id="mshot" class="shot');
      $('mthumbs').querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-current', i === j));
    };
    $('mthumbs').innerHTML = fotos.length > 1 ? fotos.map((f, i) => `<button aria-label="Foto ${i + 1}"><img src="${esc(f)}" alt=""></button>`).join('') : '';
    $('mthumbs').querySelectorAll('button').forEach((b, i) => (b.onclick = () => mostrar(i)));
    mostrar(0);
    $('mstore').dataset.m = x.loja;
    $('mstore').textContent = label(x);
    $('mt').textContent = x.nome;
    $('mrate').textContent = [x.nota ? `★ ${x.nota.toFixed(1).replace('.', ',')}` : '', x.vendidos ? `${num.format(x.vendidos)} vendidos` : '', D[x.dept]?.n, local ? x.cidade : ''].filter(Boolean).join(' · ');
    $('mold').textContent = off(x) ? `de ${brl.format(x.precoAntigo)}` : '';
    $('mprice').textContent = brl.format(x.preco);
    $('msave').textContent = off(x) ? `Economia de ${brl.format(x.precoAntigo - x.preco)} (${off(x)}% off)` : '';
    $('mdesc').textContent = x.descricao ?? '';
    const link = `${location.origin}/#p-${x.id}`;
    if (local) {
      $('mbuy').href = `https://wa.me/${x.whatsapp}?text=${encodeURIComponent(`Olá! Vi na CITshop e tenho interesse: ${x.nome} por ${brl.format(x.preco)}. ${link}`)}`;
      $('mbuy').rel = 'noopener';
      $('mbuy').textContent = 'Pedir pelo WhatsApp da loja ↗';
      $('mnote').textContent = `Vendido e entregue por ${x.lojaNome}, ${x.cidade}. Combine pagamento e entrega direto com a loja.`;
    } else {
      $('mbuy').href = x.link;
      $('mbuy').rel = 'sponsored nofollow noopener';
      $('mbuy').textContent = `Comprar na ${STORE[x.loja]} ↗`;
      // Preço vindo de API com hora da consulta (hoje só a Amazon): mostra quando foi visto.
      const quando = x.atualizadoEm ? ` Preço consultado em ${new Date(x.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} e pode mudar.` : '';
      $('mnote').textContent = `Você finaliza a compra no site da loja. Preço e frete confirmados lá.${quando}`;
    }
    $('mzap').href = `https://wa.me/?text=${encodeURIComponent(`Olha esse achado na CITshop: ${x.nome} por ${brl.format(x.preco)} ${link}`)}`;
    $('modal').hidden = false;
    $('mx').focus();
    if (location.hash !== `#p-${x.id}`) history.replaceState(null, '', `#p-${x.id}`);
  }
  function closeProduct() {
    $('modal').hidden = true;
    if (location.hash.startsWith('#p-')) history.replaceState(null, '', location.pathname);
  }
  function fecharMega() { $('mega').hidden = true; $('allbtn').setAttribute('aria-expanded', 'false'); }

  function montarHome() {
    $('sellers').innerHTML = LOJAS.slice(0, 12).map((l) => `<a class="seller" href="/loja/${esc(l.slug)}" data-seller="${esc(l.slug)}" style="border-top:4px solid ${esc(l.cor || '#036271')}">
        <div class="top"><span class="avatar" style="background:${esc(l.cor || '#036271')};color:${window.CIT.textoSobre(l.cor || '#036271')}">${l.logo ? `<img src="${esc(l.logo)}" alt="">` : esc(iniciais(l.nome))}</span><span><b>${esc(l.nome)}</b><small>${esc(l.categoria || 'Loja local')}</small></span></div>
        <div class="meta"><span>${P.filter((x) => x.lojaSlug === l.slug).length} produtos</span><span>${esc(l.cidade)}</span></div></a>`).join('') +
      `<a class="seller cta" href="/painel"><div class="top"><span class="avatar">+</span><span><b>Sua loja aqui</b><small>30 dias grátis pra testar</small></span></div></a>`;
    for (const k of Object.keys(LISTS)) rail(`r-${k}`, LISTS[k].f());
  }

  function rota() {
    const m = location.pathname.match(/^\/loja\/([a-z0-9-]+)/);
    if (m) bySeller(m[1]);
    const h = location.hash.match(/^#p-(.+)$/);
    const x = h && P.find((p) => p.id === decodeURIComponent(h[1]));
    if (x) openProduct(x);
  }

  // Montagem estática
  $('megalist').innerHTML = DEPTS.map(([k, n]) => `<button data-dept="${k}">${svg(k)}${n}</button>`).join('');
  $('depts').innerHTML = DEPTS.map(([k, n, h]) => `<button class="dept" data-dept="${k}" style="--hue:${h}"><span class="c">${svg(k)}</span>${n}</button>`).join('');
  $('sdept').insertAdjacentHTML('beforeend', DEPTS.map(([k, n]) => `<option value="${k}">${n}</option>`).join(''));
  $('navlinks').insertAdjacentHTML('beforeend', DEPTS.slice(0, 10).map(([k, n]) => `<button data-dept="${k}">${n}</button>`).join(''));
  $('fdepts').innerHTML = DEPTS.slice(0, 8).map(([k, n]) => `<li><a href="#" data-dept="${k}">${n}</a></li>`).join('');
  document.querySelectorAll('.promo').forEach((b) => (b.querySelector('svg').innerHTML = ICON[b.dataset.dept]));
  renderSlides();
  start();

  document.addEventListener('click', (e) => {
    const t = e.target;
    const p = t.closest('[data-p]'); if (p) return openProduct(P.find((x) => x.id === p.dataset.p));
    const sl = t.closest('[data-seller]'); if (sl) { e.preventDefault(); return bySeller(sl.dataset.seller); }
    const d = t.closest('[data-dept]'); if (d) { e.preventDefault(); return byDept(d.dataset.dept); }
    const s = t.closest('[data-show]'); if (s) return showResults(LISTS[s.dataset.show].t, LISTS[s.dataset.show].f());
    const st = t.closest('[data-store]'); if (st) return showResults(`Ofertas ${STORE[st.dataset.store]}`, P.filter((x) => x.loja === st.dataset.store));
    const c = t.closest('[data-chip]'); if (c) { view.store = c.dataset.chip; return renderResults(); }
    if (t.closest('[data-open-mega]') || t.closest('#allbtn')) {
      const abrir = $('mega').hidden;
      $('mega').hidden = !abrir;
      $('allbtn').setAttribute('aria-expanded', abrir);
      return;
    }
    if (t.closest('#back')) return goHome();
    if (!t.closest('.mega') && !$('mega').hidden) fecharMega();
  });
  $('mx').onclick = closeProduct;
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeProduct(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeProduct(); fecharMega(); } });
  addEventListener('popstate', () => (location.pathname === '/' ? goHome() : rota()));
  $('sf').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim().toLowerCase(), dep = $('sdept').value;
    const list = P.filter((x) => (!dep || x.dept === dep) && (!q || x.nome.toLowerCase().includes(q) || (x.lojaNome ?? '').toLowerCase().includes(q)));
    showResults(q ? `Resultados para "${$('q').value.trim()}"` : dep ? D[dep].n : 'Todos os produtos', ordenar(list));
  });

  fetch('/api/vitrine')
    .then((r) => r.json())
    .then((d) => { P = d.produtos; LOJAS = d.lojas; montarHome(); rota(); })
    .catch(() => { $('sellers').innerHTML = '<p class="empty">Não foi possível carregar as ofertas. Recarregue a página.</p>'; });
})();
