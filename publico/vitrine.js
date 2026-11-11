import { filtrarCatalogo } from './catalogo.js';

// Vitrine: lê /api/vitrine (lojas locais já vêm na frente dos afiliados) e monta a loja.
(() => {
  const { DEPTS, D, ICON, esc, brl, svg } = window.CIT;
  const STORE = { ml: 'Mercado Livre', 'mercado-livre': 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', shein: 'SHEIN', local: 'Lojas da região' };
  const DISPONIBILIDADE = { disponivel: 'Disponível, informado pela loja', 'sob-encomenda': 'Sob encomenda', consulte: 'Consulte disponibilidade' };
  const $ = (id) => document.getElementById(id);
  const num = new Intl.NumberFormat('pt-BR');
  let P = [], LOJAS = [];

  const off = (x) => (x.precoAntigo > x.preco ? Math.round((1 - x.preco / x.precoAntigo) * 100) : 0);
  // Quanto (em %) caiu desde o maior preço que a CITshop viu nos últimos dias.
  const caiu = (x) => (x.queda > 0 ? Math.round((x.queda / (x.preco + x.queda)) * 100) : 0);
  const label = (x) => (x.loja === 'local' ? x.lojaNome : STORE[x.loja]);
  const hue = (x) => (D[x.dept] ?? D.casa).h;
  // Mesma regra do servidor: lojas locais primeiro, ordem preservada dentro de cada grupo.
  const ordenar = (l) => [...l.filter((x) => x.loja === 'local'), ...l.filter((x) => x.loja !== 'local')];
  const iniciais = (n) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const LISTS = {
    alexa: { t: 'Casa inteligente', f: () => P.filter((x) => x.destaque) },
    quedas: { t: 'Baixou de preço', f: () => [...P].filter((x) => caiu(x) > 0 || x.menor30).sort((a, b) => caiu(b) - caiu(a)) },
    local: { t: 'Lojas da região', f: () => P.filter((x) => x.loja === 'local') },
    ofertas: { t: 'Maiores descontos', f: () => ordenar([...P].filter((x) => off(x) > 0).sort((a, b) => off(b) - off(a))) },
    ate100: { t: 'Tudo até R$ 100', f: () => ordenar(P.filter((x) => x.preco <= 100).sort((a, b) => a.preco - b.preco)) },
    casa: { t: 'Casa, cozinha e eletro', f: () => P.filter((x) => ['casa', 'cozinha', 'eletro', 'cama'].includes(x.dept)) },
    tech: { t: 'Tecnologia e games', f: () => P.filter((x) => ['tec', 'cel', 'info', 'games'].includes(x.dept)) },
    moda: { t: 'Moda e beleza', f: () => P.filter((x) => ['moda', 'calc', 'beleza'].includes(x.dept)) },
    // Os fixos do manual.json (ex.: livro de autor da região) vêm primeiro.
    livros: { t: 'Livros e eBooks', f: () => P.filter((x) => x.dept === 'livros').sort((a, b) => b.fixo - a.fixo) },
    mercado: { t: 'Mercado, saúde e bebê', f: () => P.filter((x) => ['mercado', 'saude', 'bebe'].includes(x.dept)) },
    camping: { t: 'Camping e sobrevivência', f: () => P.filter((x) => x.dept === 'camping') },
  };

  // O desconto aparece ao lado do preço ("33% OFF"), como no Mercado Livre, e não em cima da foto.
  function shot(x, foto = x.fotos?.[0]) {
    return foto
      ? `<div class="shot foto"><img src="${esc(foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="shot" style="--hue:${hue(x)}">${svg(x.dept)}`;
  }
  const preco = (x) => `${brl.format(x.preco)}${off(x) ? ` <span class="pct">${off(x)}% OFF</span>` : ''}`;
  function card(x) {
    const nota = x.nota ? `<div class="rate"><b>★ ${x.nota.toFixed(1).replace('.', ',')}</b>${x.vendidos ? ` · ${num.format(x.vendidos)} vendidos` : ''}</div>` : '';
    const ship = x.loja === 'local' ? `<div class="ship">${esc(window.CIT.textoEntrega(x.entrega))} em ${esc(x.cidade)}</div>` : x.queda ? `<div class="ship">↓ caiu ${brl.format(x.queda)}</div>` : '';
    const stock = x.loja === 'local' ? `<div class="availability-tag">${esc(DISPONIBILIDADE[x.disponibilidade] ?? DISPONIBILIDADE.consulte)}</div>` : '';
    const selo = x.selo === '11.11' || x.superOferta ? '<div class="ship" style="color:#e63946;font-weight:700">🔥 Super Oferta 11.11</div>' : (x.menor30 && x.loja !== 'local' ? '<div class="ship"><b>Menor preço em 30 dias</b></div>' : '');
    // Loja comum: a marca de quem vende só aparece discreta no produto ("Vendido por X"), igual para todas as lojas.
    // Todo card abre o detalhe aqui no site; a ida para a loja fica no botão "Comprar" do detalhe.
    return `<button class="card" data-p="${esc(x.id)}">${shot(x)}</div>
      <div class="body"><h3>${esc(x.nome)}</h3>${nota}${off(x) ? `<div class="old">${brl.format(x.precoAntigo)}</div>` : ''}
      <div class="price">${preco(x)}</div>${ship}${stock}${selo}<div class="vendido">Vendido por ${esc(label(x))}</div></div></button>`;
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
    { k: 'Black Friday', h: 'Black Friday CITshop', p: 'Contagem regressiva e os produtos que mais baixaram de preço.', c: 'Ver ofertas →', a: 'bag', href: '/black-friday' },
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
  const view = { list: [], ordem: 'relevancia', cidade: '', sub: '', origem: '', precoMin: '', precoMax: '', q: '', dept: '' };
  const TITULO = 'CITshop · ofertas e lojas da sua cidade';
  let voltar = '/'; // endereço (com a query, ex.: utm) para onde a janela do produto devolve ao fechar
  let empurrou = false; // abrir o produto criou uma entrada no histórico: o Voltar só fecha a janela
  let tituloAntes = TITULO;
  function showResults(title, list, head = '', filtros = {}) {
    Object.assign(view, { list, ordem: 'relevancia', cidade: '', sub: '', origem: '', precoMin: '', precoMax: '', q: '', dept: '' }, filtros);
    $('rsort').value = view.ordem;
    $('rcidade').value = '';
    $('rorigem').value = '';
    $('rmin').value = '';
    $('rmax').value = '';
    $('rtitle').textContent = title;
    $('rhead').innerHTML = head;
    $('homeview').hidden = true;
    $('resultsview').hidden = false;
    fecharMega();
    renderResults();
    scrollTo({ top: 0 });
  }
  function renderResults() {
    // Sem filtro por loja: a CITshop é uma loja só; quem vende aparece em cada produto.
    const base = view.list.filter((x) => !view.cidade || (x.loja === 'local' && x.cidade === view.cidade));
    const cidades = [...new Set(view.list.filter((x) => x.loja === 'local').map((x) => x.cidade))].sort();
    $('rcidadeL').hidden = cidades.length < 2;
    $('rcidade').innerHTML = ['<option value="">Todas</option>', ...cidades.map((c) => `<option ${view.cidade === c ? 'selected' : ''}>${esc(c)}</option>`)].join('');
    // Subcategorias (Geladeiras, Air fryer, Barracas...): chips quando a lista tem mais de uma.
    const subs = [...new Set(base.map((x) => x.sub).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('subchips').innerHTML = subs.length > 1 ? [['', 'Tudo'], ...subs.map((s) => [s, s])]
      .map(([k, n]) => `<button class="chip" data-sub="${esc(k)}" aria-pressed="${view.sub === k}">${esc(n)}</button>`).join('') : '';
    const list = filtrarCatalogo(base, {
      ...view, ordem: view.ordem, cidade: '', sub: view.sub,
    });
    $('rcount').textContent = `${list.length} ${list.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
    $('rgrid').innerHTML = list.length ? list.map(card).join('') : '<p class="empty">Nenhum produto por aqui ainda. Tente outro departamento ou outra busca.</p>';
  }
  function goHome() {
    document.title = TITULO;
    $('resultsview').hidden = true;
    $('homeview').hidden = false;
    $('q').value = '';
    if (location.pathname !== '/') history.pushState(null, '', '/');
    scrollTo({ top: 0 });
  }
  const byDept = (k) => showResults(D[k].n, P.filter((x) => x.dept === k), '', { dept: k });
  function bySeller(slug) {
    const l = LOJAS.find((x) => x.slug === slug);
    if (!l) return showResults('Loja não encontrada', []);
    const zap = `/contato/loja/${encodeURIComponent(l.slug)}`;
    showResults('Produtos da loja', P.filter((x) => x.lojaSlug === slug),
      window.CIT.cabecalhoLoja(l, `<a class="btn" href="${zap}" target="_blank" rel="noopener">Falar no WhatsApp</a>`));
    document.title = `${l.nome} · CITshop`;
    if (location.pathname !== `/loja/${slug}`) history.pushState(null, '', `/loja/${slug}`);
  }

  // Black Friday: página própria (/black-friday) com contagem regressiva e o que tem desconto ou baixou de preço.
  const BF_INICIO = Date.parse('2026-11-27T00:00:00-03:00');
  const BF_FIM = Date.parse('2026-12-01T00:00:00-03:00'); // vai até a Cyber Monday (30/11)
  let bfTimer;
  function contagemBF(agora = Date.now()) {
    if (agora >= BF_FIM) return 'A Black Friday acabou, mas as ofertas continuam por aqui.';
    if (agora >= BF_INICIO) return 'A Black Friday começou! Ofertas até segunda, 30/11.';
    const m = Math.floor((BF_INICIO - agora) / 60_000);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
    return `Faltam ${d ? `${d} dia${d > 1 ? 's' : ''}, ` : ''}${h}h${String(min).padStart(2, '0')} pra Black Friday (27/11)`;
  }
  function blackFriday() {
    const melhor = (x) => Math.max(off(x), caiu(x));
    const lista = ordenar([...P].filter((x) => melhor(x) > 0 || x.menor30).sort((a, b) => melhor(b) - melhor(a)));
    showResults('Black Friday CITshop', lista, `<div class="sellbox" style="margin-bottom:16px"><div><h2 id="bfconta">${contagemBF()}</h2>
      <p>Produtos com desconto e os que baixaram de preço nos últimos dias.</p></div></div>`);
    document.title = 'Black Friday · CITshop';
    if (location.pathname !== '/black-friday') history.pushState(null, '', '/black-friday');
    clearInterval(bfTimer);
    bfTimer = setInterval(() => {
      const el = $('bfconta');
      if (el && !$('resultsview').hidden) el.textContent = contagemBF();
      else clearInterval(bfTimer);
    }, 30_000);
  }

  // Janela do produto
  function openProduct(x) {
    const local = x.loja === 'local';
    const fotos = x.fotos?.length ? x.fotos : [null];
    const mostrar = (i) => {
      $('mshot').outerHTML = `${shot(x, fotos[i])}</div>`.replace('class="shot', 'id="mshot" class="shot');
      $('mthumbs').querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-current', i === j));
    };
    $('mthumbs').innerHTML = fotos.length > 1 ? fotos.map((f, i) => `<button aria-label="Foto ${i + 1}"><img src="${esc(f)}" alt="" referrerpolicy="no-referrer"></button>`).join('') : '';
    $('mthumbs').querySelectorAll('button').forEach((b, i) => (b.onclick = () => mostrar(i)));
    mostrar(0);
    $('mstore').textContent = `Vendido por ${label(x)}`;
    $('mt').textContent = x.nome;
    $('mcrumb').textContent = [D[x.dept]?.n, x.sub].filter(Boolean).join(' › ');
    $('mrate').textContent = [x.nota ? `★ ${x.nota.toFixed(1).replace('.', ',')}` : '', x.vendidos ? `${num.format(x.vendidos)} vendidos` : '', local ? x.cidade : ''].filter(Boolean).join(' · ');
    $('mold').textContent = off(x) ? `de ${brl.format(x.precoAntigo)}` : '';
    $('mprice').innerHTML = preco(x);
    // Produtos parecidos: mesma subcategoria primeiro, depois o departamento; lojas da região na frente.
    const outros = P.filter((y) => y.id !== x.id);
    const parecidos = ordenar([...outros.filter((y) => x.sub && y.sub === x.sub), ...outros.filter((y) => y.dept === x.dept && !(x.sub && y.sub === x.sub))]).slice(0, 6);
    $('msimBox').hidden = !parecidos.length;
    $('msim').innerHTML = parecidos.map(card).join('');
    $('modal').querySelector('.sheet').scrollTop = 0;
    $('msave').textContent = off(x) ? `Economia de ${brl.format(x.precoAntigo - x.preco)} (${off(x)}% off)` : x.menor30 ? 'Menor preço em 30 dias' : '';
    $('mdesc').textContent = x.descricao ?? '';
    // Link próprio do produto: o servidor monta a prévia (título, preço e foto) que o WhatsApp mostra.
    const link = `${location.origin}/p/${encodeURIComponent(x.id)}`;
    if (local) {
      const baseContato = `/contato/${encodeURIComponent(x.id)}`;
      $('mbuy').href = baseContato;
      $('mbuy').rel = 'noopener';
      $('mbuy').textContent = 'Pedir pelo WhatsApp da loja ↗';
      const disponibilidade = DISPONIBILIDADE[x.disponibilidade] ?? DISPONIBILIDADE.consulte;
      $('mnote').textContent = `Vendido por ${x.lojaNome}, ${x.cidade}${x.entrega ? ` · ${window.CIT.textoEntrega(x.entrega)}` : ''} · ${disponibilidade}. Combine pagamento e entrega direto com a loja.`;

      const nomeLower = String(x.nome || '').toLowerCase();
      const ehCalcado = x.dept === 'calc' || /tenis|tênis|sapato|sandalia|sandália|chinelo|bota|chuteira/i.test(nomeLower);
      const ehVestuario = x.dept === 'moda' || /camiseta|camisa|blusa|cropped|calca|calça|shorts|bermuda|vestido|jaqueta|casaco|conjunto|saia/i.test(nomeLower);
      const tamanhos = ehCalcado ? ['36', '37', '38', '39', '40', '41', '42', '43', '44'] : (ehVestuario ? ['P', 'M', 'G', 'GG', 'XG'] : ['Padrão / Único']);
      const modelos = ehVestuario ? ['Tradicional', 'Slim', 'Babylook', 'Oversized'] : ['Padrão'];
      const cores = ['Preto', 'Branco', 'Azul', 'Vermelho', 'Cinza', 'Verde', 'Rosa', 'Bege'];

      $('mvariants').hidden = false;
      $('mvariants').innerHTML = `
        <div class="variant-title">Opções para o pedido</div>
        ${modelos.length > 1 ? `
        <div class="variant-group">
          <span>Modelo / Estilo:</span>
          <div class="chips">
            ${modelos.map((m) => `<button type="button" class="chip-opt" data-var="modelo" data-val="${esc(m)}">${esc(m)}</button>`).join('')}
          </div>
        </div>` : ''}
        <div class="variant-group">
          <span>Tamanho:</span>
          <div class="chips">
            ${tamanhos.map((t) => `<button type="button" class="chip-opt" data-var="tamanho" data-val="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>
        </div>
        <div class="variant-group">
          <span>Cor:</span>
          <div class="chips">
            ${cores.map((c) => `<button type="button" class="chip-opt" data-var="cor" data-val="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
        </div>
        <div class="variant-group">
          <span>Observação para a loja (opcional):</span>
          <input type="text" class="variant-obs" id="mvar-obs" placeholder="Ex: detalhes da estampa, número extra...">
        </div>
      `;

      function atualizarLinkModal() {
        const url = new URL(baseContato, location.origin);
        const mod = $('mvariants').querySelector('.chip-opt[data-var="modelo"].active')?.dataset.val || '';
        const tam = $('mvariants').querySelector('.chip-opt[data-var="tamanho"].active')?.dataset.val || '';
        const cor = $('mvariants').querySelector('.chip-opt[data-var="cor"].active')?.dataset.val || '';
        const obs = $('mvar-obs')?.value?.trim() || '';
        if (mod) url.searchParams.set('modelo', mod);
        if (tam) url.searchParams.set('tamanho', tam);
        if (cor) url.searchParams.set('cor', cor);
        if (obs) url.searchParams.set('obs', obs);
        $('mbuy').href = url.pathname + url.search;
      }

      $('mvariants').onclick = (e) => {
        const chip = e.target.closest('.chip-opt');
        if (!chip) return;
        const g = chip.dataset.var;
        if (chip.classList.contains('active')) {
          chip.classList.remove('active');
        } else {
          $('mvariants').querySelectorAll(`.chip-opt[data-var="${g}"]`).forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
        }
        atualizarLinkModal();
      };
      const obsInput = $('mvar-obs');
      if (obsInput) obsInput.oninput = atualizarLinkModal;
    } else {
      $('mvariants').hidden = true;
      $('mvariants').innerHTML = '';
      $('mbuy').href = x.link;
      $('mbuy').rel = 'sponsored nofollow noopener';
      $('mbuy').textContent = `Comprar na ${STORE[x.loja]} ↗`;
      // Preço vindo de API com hora da consulta (hoje só a Amazon): mostra quando foi visto.
      const quando = x.atualizadoEm ? ` Preço consultado em ${new Date(x.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} e pode mudar.` : '';
      $('mnote').textContent = `Você finaliza a compra no site da loja. Preço e frete confirmados lá.${quando}`;
    }
    $('mzap').href = `https://wa.me/?text=${encodeURIComponent(`Olha esse achado na CITshop: ${x.nome} por ${brl.format(x.preco)} ${link}`)}`;
    const jaAberto = !$('modal').hidden;
    $('modal').hidden = false;
    $('mx').focus();
    if (!jaAberto) tituloAntes = location.pathname.startsWith('/p/') ? TITULO : document.title;
    document.title = `${x.nome} · CITshop`;
    const url = `/p/${encodeURIComponent(x.id)}`;
    // Link direto (/p/ ou #p- antigo): só troca o endereço. Aberto pela vitrine: cria entrada, e o Voltar fecha.
    if (location.pathname.startsWith('/p/') || location.hash.startsWith('#p-')) history.replaceState(null, '', url);
    else { voltar = location.pathname + location.search; history.pushState(null, '', url); empurrou = true; }
  }
  function fecharJanela() {
    $('modal').hidden = true;
    empurrou = false;
    document.title = tituloAntes;
  }
  function closeProduct() {
    if ($('modal').hidden) return;
    if (empurrou) return history.back(); // o popstate fecha a janela e devolve o endereço anterior
    fecharJanela();
    if (location.pathname.startsWith('/p/') || location.hash.startsWith('#p-')) history.replaceState(null, '', voltar);
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
    if (location.pathname === '/black-friday') blackFriday();
    // /p/<id> é o link novo; #p-<id> continua valendo para links antigos já compartilhados.
    const h = location.pathname.match(/^\/p\/(.+)$/) ?? location.hash.match(/^#p-(.+)$/);
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
    const sb = t.closest('[data-sub]'); if (sb) { view.sub = sb.dataset.sub; return renderResults(); }
    if (t.closest('[data-open-mega]') || t.closest('#allbtn')) {
      const abrir = $('mega').hidden;
      $('mega').hidden = !abrir;
      $('allbtn').setAttribute('aria-expanded', abrir);
      return;
    }
    if (t.closest('#back')) return goHome();
    if (!t.closest('.mega') && !$('mega').hidden) fecharMega();
  });
  $('rsort').addEventListener('change', (e) => { view.ordem = e.target.value; renderResults(); });
  $('rcidade').addEventListener('change', (e) => { view.cidade = e.target.value; renderResults(); });
  $('rorigem').addEventListener('change', (e) => { view.origem = e.target.value; renderResults(); });
  $('rmin').addEventListener('input', (e) => { view.precoMin = e.target.value; renderResults(); });
  $('rmax').addEventListener('input', (e) => { view.precoMax = e.target.value; renderResults(); });
  $('rreset').addEventListener('click', () => {
    view.ordem = 'relevancia'; view.cidade = ''; view.sub = ''; view.origem = ''; view.precoMin = ''; view.precoMax = '';
    $('rsort').value = view.ordem; $('rcidade').value = ''; $('rorigem').value = ''; $('rmin').value = ''; $('rmax').value = '';
    renderResults();
  });
  $('mx').onclick = closeProduct;
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeProduct(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeProduct(); fecharMega(); } });
  // Voltar (navegador ou celular) com o produto aberto só fecha a janela; a página de baixo fica como estava.
  addEventListener('popstate', () => {
    if (!$('modal').hidden) return fecharJanela();
    location.pathname === '/' ? goHome() : rota();
  });
  $('sf').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim(), dep = $('sdept').value;
    showResults(q ? `Resultados para "${q}"` : dep ? D[dep].n : 'Todos os produtos', P, '', { q, dept: dep });
  });

  fetch('/api/vitrine')
    .then((r) => r.json())
    .then((d) => { P = d.produtos.map((x) => ({ ...x, categoriaNome: D[x.dept]?.n ?? x.dept })); LOJAS = d.lojas; montarHome(); rota(); })
    .catch(() => { $('sellers').innerHTML = '<p class="empty">Não foi possível carregar as ofertas. Recarregue a página.</p>'; });
})();
