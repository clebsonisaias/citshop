import { filtrarCatalogo } from './catalogo.js';
import { FOCO_TEMPORADA, TEMPORADAS, combina, temporadasAtivas } from './temporadas.js';
import { desenharHistorico } from './historico-preco.js';
import { FILTROS_BF, ehOfertaBlack, melhorDesconto, proximaRodadaMs, resumoBlackFriday, selecionarRelampago, tempoRestante } from './black-friday.js';

// Vitrine: lê /api/vitrine (lojas locais já vêm na frente dos afiliados) e monta a loja.
(() => {
  const { DEPTS, D, ICON, esc, brl, svg } = window.CIT;
  const STORE = { ml: 'Mercado Livre', 'mercado-livre': 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', shein: 'SHEIN', local: 'Lojas da região' };
  const DISPONIBILIDADE = { disponivel: 'Disponível, informado pela loja', 'sob-encomenda': 'Sob encomenda', consulte: 'Consulte disponibilidade' };
  const $ = (id) => document.getElementById(id);
  const num = new Intl.NumberFormat('pt-BR');
  let P = [], LOJAS = [], CAMPANHA = null, PROXIMA = null, BF = null, CUPONS = [], CAMPANHAS_SHOPEE = []; // CAMPANHA: data especial em andamento (ex.: "Black Friday", "12.12"), vem do servidor

  const off = (x) => (x.precoAntigo > x.preco ? Math.round((1 - x.preco / x.precoAntigo) * 100) : 0);
  // Quanto (em %) caiu desde o maior preço que a CIT Shopping viu nos últimos dias.
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
    // Natal, looks de fim de ano e réveillon: só enquanto a data vale (publico/temporadas.js); fora dela a faixa some.
    // Shopee e SHEIN (FOCO_TEMPORADA) vêm primeiro; o resto depois, na mesma ordem da vitrine.
    ...Object.fromEntries(TEMPORADAS.map((s) => [s.id, { t: s.titulo, f: () => {
      if (!temporadasAtivas().some((a) => a.id === s.id)) return [];
      const l = P.filter((x) => combina(s, x));
      return [...l.filter((x) => FOCO_TEMPORADA.includes(x.loja)), ...l.filter((x) => !FOCO_TEMPORADA.includes(x.loja))];
    } }])),
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
    const selo = x.selo === '11.11' || x.superOferta ? `<div class="ship" style="color:#e63946;font-weight:700">🔥 Super Oferta${CAMPANHA ? ` ${esc(CAMPANHA)}` : ''}</div>` : (x.menor30 && x.loja !== 'local' ? '<div class="ship"><b>Menor preço em 30 dias</b></div>' : '');
    const tags = [];
    const temFrete = x.freteGratis || x.preco >= 79 || x.loja === 'local' || /frete gr[aá]tis/i.test(x.nome);
    // Selo de cupom só quando existe cupom válido cadastrado para a loja do produto (página /cupons).
    const mesmaLoja = (a, b) => a === b || (['ml', 'mercado-livre'].includes(a) && ['ml', 'mercado-livre'].includes(b));
    const temCupom = CUPONS.some((c) => mesmaLoja(c.loja, x.loja) && (x.loja !== 'local' || c.lojaSlug === x.lojaSlug));
    if (temFrete) tags.push('<span class="tag-frete">🚚 Frete Grátis</span>');
    if (temCupom) tags.push('<span class="tag-cupom">🎟️ Tem cupom</span>');
    const tagsHtml = tags.length ? `<div class="tags-row">${tags.join('')}</div>` : '';

    // Na página da própria loja o card fica enxuto: quem vende e como entrega já estão no cabeçalho.
    if (document.body.classList.contains('na-loja') && x.loja === 'local') {
      const encomenda = x.disponibilidade === 'sob-encomenda';
      const estoque = x.disponibilidade === 'disponivel' ? 'Pronta entrega' : encomenda ? 'Sob encomenda' : 'Consulte disponibilidade';
      return `<button class="card" data-p="${esc(x.id)}">${shot(x)}</div>
      <div class="body"><h3>${esc(x.nome)}</h3>${nota}${off(x) ? `<div class="old">${brl.format(x.precoAntigo)}</div>` : ''}
      <div class="price">${preco(x)}</div><div class="lv-estoque${encomenda ? ' encomenda' : ''}">${estoque}</div></div></button>`;
    }
    return `<button class="card" data-p="${esc(x.id)}">${shot(x)}</div>
      <div class="body"><h3>${esc(x.nome)}</h3>${nota}${off(x) ? `<div class="old">${brl.format(x.precoAntigo)}</div>` : ''}
      <div class="price">${preco(x)}</div>${tagsHtml}${ship}${stock}${selo}<div class="vendido">Vendido por ${esc(label(x))}</div></div></button>`;
  }
  function rail(id, list) {
    list = list.filter((x) => !x.soBusca); // Amazon de comissão baixa: só na busca
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
  const BANNER_TEMPORADA = {
    natal: { k: 'Natal', h: 'Decoração de Natal', p: 'Árvore, pisca-pisca e enfeites até 24 de dezembro.', c: 'Ver decoração →', a: 'shop' },
    aulas: { k: 'Volta às aulas', h: 'Material escolar para 2027', p: 'Mochilas, estojos, cadernos e kits escolares.', c: 'Ver material escolar →', a: 'bag' },
    mesa: { k: 'Ceia', h: 'Mesa posta de Natal e Ano Novo', p: 'Taças, sousplat, guardanapos e louças para a ceia.', c: 'Montar a mesa →', a: 'bag' },
    looks: { k: 'Fim de ano', h: 'Looks para formatura, Natal e réveillon', p: 'Branco, vermelho e amarelo para as festas.', c: 'Ver looks →', a: 'bag' },
  };
  let SLIDES = [];
  function construirSlides() {
    const res = resumoBlackFriday(P);
    const bfAtiva = Boolean(BF?.ativa);
    const bfTexto = bfAtiva && res.total
      ? `${num.format(res.total)} ofertas conferidas${res.maiorOff ? ` com até ${res.maiorOff}% OFF` : ''} e ofertas relâmpago trocando a cada hora.`
      : 'Contagem regressiva, ofertas relâmpago por hora e os produtos que mais baixaram de preço.';
    const slideBf = {
      k: bfAtiva ? (BF.fase === 'cyber' ? 'Cyber Monday · Último dia' : 'Black Friday ao vivo') : 'Black Friday',
      h: bfAtiva ? 'Black Friday CIT Shopping' : 'Black Friday CIT Shopping',
      p: bfTexto,
      c: bfAtiva ? 'Abrir Central Black Friday →' : 'Ver ofertas →',
      a: 'bag', href: '/black-friday', cls: 'slide-bf',
    };
    const sazonais = temporadasAtivas().filter((s) => BANNER_TEMPORADA[s.id]).map((s) => ({ ...BANNER_TEMPORADA[s.id], show: s.id }));
    const fixos = [
      { k: 'Compre perto', h: 'As lojas da sua cidade estão aqui', p: 'Escolha, chame a loja no WhatsApp e receba rápido.', c: 'Ver lojas →', a: 'shop', show: 'local' },
      { k: 'Venda na CIT Shopping', h: 'Sua loja na frente das gigantes', p: '30 dias grátis pra testar. Depois, R$ 99,90 por mês.', c: 'Cadastrar minha loja →', a: 'shop', href: '/painel' },
    ];
    // Durante a Black Friday, o banner principal abre o carrossel; fora dela, as temporadas sazonais vêm primeiro.
    SLIDES = bfAtiva ? [slideBf, ...sazonais, ...fixos] : [...sazonais, slideBf, ...fixos];
  }
  let cur = 0, timer;
  function renderSlides() {
    construirSlides();
    cur = 0;
    $('slides').innerHTML = SLIDES.map((s, i) => `<div class="slide${s.cls ? ` ${s.cls}` : ''}" ${i ? 'hidden' : ''} aria-label="${i + 1} de ${SLIDES.length}">
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
  const TITULO = 'CIT Shopping · ofertas e lojas da sua cidade';
  let voltar = '/'; // endereço (com a query, ex.: utm) para onde a janela do produto devolve ao fechar
  let empurrou = false; // abrir o produto criou uma entrada no histórico: o Voltar só fecha a janela
  let tituloAntes = TITULO;
  function showResults(title, list, head = '', { naLoja = false, rodape = '', ...filtros } = {}) {
    document.body.classList.toggle('na-loja', naLoja);
    $('rfoot').innerHTML = rodape;
    $('raovivo').hidden = true; $('raovivo').innerHTML = '';
    Object.assign(view, { list, ordem: 'relevancia', cidade: '', sub: '', origem: '', marca: '', precoMin: '', precoMax: '', q: '', dept: '' }, filtros);
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
  const POR_PAGINA = 48; // a lista cresce de 48 em 48 ("Ver mais produtos")
  function renderResults(mais = false) {
    view.mostrar = mais === true ? (view.mostrar ?? POR_PAGINA) + POR_PAGINA : POR_PAGINA;
    // Sem filtro por loja: a CIT Shopping é uma loja só; quem vende aparece em cada produto.
    const base = view.list.filter((x) => (view.q || !x.soBusca) && (!view.cidade || (x.loja === 'local' && x.cidade === view.cidade)));
    const cidades = [...new Set(view.list.filter((x) => x.loja === 'local').map((x) => x.cidade))].sort();
    $('rcidadeL').hidden = cidades.length < 2;
    $('rcidade').innerHTML = ['<option value="">Todas</option>', ...cidades.map((c) => `<option ${view.cidade === c ? 'selected' : ''}>${esc(c)}</option>`)].join('');
    // Subcategorias (Geladeiras, Air fryer, Barracas...): chips quando a lista tem mais de uma.
    const subs = [...new Set(base.map((x) => x.sub).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('subchips').innerHTML = subs.length > 1 ? [['', 'Tudo'], ...subs.map((s) => [s, s])]
      .map(([k, n]) => `<button class="chip" data-sub="${esc(k)}" aria-pressed="${view.sub === k}">${esc(n)}</button>`).join('') : '';
    // Marca: só aparece quando os produtos da lista têm duas marcas ou mais.
    const marcas = [...new Set(base.map((x) => x.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('rmarcaL').hidden = marcas.length < 2;
    $('rmarca').innerHTML = ['<option value="">Todas</option>', ...marcas.map((m) => `<option ${view.marca === m ? 'selected' : ''}>${esc(m)}</option>`)].join('');
    const list = filtrarCatalogo(base, {
      ...view, ordem: view.ordem, cidade: '', sub: view.sub,
    });
    $('rcount').textContent = `${list.length} ${list.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
    $('rgrid').innerHTML = list.length ? list.slice(0, view.mostrar).map(card).join('') : '<p class="empty">Nenhum produto por aqui ainda. Tente outro departamento ou outra busca.</p>';
    $('rmais').hidden = list.length <= view.mostrar;
  }
  function goHome() {
    document.title = TITULO;
    document.body.classList.remove('na-loja');
    $('resultsview').hidden = true;
    $('homeview').hidden = false;
    $('q').value = '';
    if (location.pathname !== '/') history.pushState(null, '', '/');
    scrollTo({ top: 0 });
  }
  const byDept = (k) => showResults(D[k].n, P.filter((x) => x.dept === k), '', { dept: k });
  const ICONE_ZAP = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:2"><path d="M4 20l1.3-4A8 8 0 1 1 8 19z"/></svg>';
  const ICONE_COMPARTILHAR = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style="stroke-width:2"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  // Compartilhar a loja: menu nativo do celular; sem ele, copia o link.
  async function compartilhar(botao) {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) return await navigator.share({ title: document.title, url });
      await navigator.clipboard.writeText(url);
      botao.textContent = 'Copiado';
    } catch { /* compartilhamento cancelado */ }
  }
  function bySeller(slug) {
    const l = LOJAS.find((x) => x.slug === slug);
    if (!l) return showResults('Loja não encontrada', []);
    const zap = `/contato/loja/${encodeURIComponent(l.slug)}`;
    const cor = l.cor || '#036271';
    const botaoZap = (texto) => `<a class="btn lv-zap" href="${zap}" target="_blank" rel="noopener">${ICONE_ZAP}${texto}</a>`;
    const promoPartes = [];
    if (l.descontoProgressivo?.length) {
      promoPartes.push(`<b>Desconto progressivo no carrinho:</b> ${l.descontoProgressivo.map((f) => `${f.pct}% OFF acima de ${brl.format(f.acima)}`).join(' · ')}`);
    }
    if (l.freteGratisAcima > 0) {
      promoPartes.push(`<b>Entrega grátis</b> em compras acima de ${brl.format(l.freteGratisAcima)}`);
    }
    const promoHtml = promoPartes.length ? `<div class="loja-promo-faixa" style="--loja:${esc(cor)}">${promoPartes.map((t) => `<span>${t}</span>`).join('')}</div>` : '';
    showResults(`Produtos de ${l.nome}`, P.filter((x) => x.lojaSlug === slug),
      window.CIT.cabecalhoLoja(l, `${l.soPeloSite ? '' : botaoZap('Chamar no WhatsApp')}<button class="btn sec lv-fav" type="button" data-favorito="loja:${esc(l.slug)}" data-rotulos="Loja favorita|Favoritar loja" aria-pressed="false"><span>Favoritar loja</span></button><button class="btn sec lv-share" type="button" data-compartilhar aria-label="Compartilhar loja" title="Compartilhar loja">${ICONE_COMPARTILHAR}</button>`) + promoHtml, {
        naLoja: true,
        rodape: l.soPeloSite ? '' : `<aside class="lv-encomenda" style="--loja:${esc(cor)};--loja-ink:${window.CIT.textoSobre(cor)}">
          <p><b>Não achou a cor ou o modelo?</b> Peça sob encomenda direto para a loja.</p>${botaoZap('Falar com a loja')}</aside>`,
      });
    // No celular, horário/área/prazo começam recolhidos para os produtos aparecerem mais cedo.
    if (matchMedia('(max-width: 900px)').matches) document.querySelector('#rhead .lv-info')?.removeAttribute('open');
    window.CITFavoritos?.pintar();
    if (l.avaliacao) mostrarAvaliacoes(slug);
    document.title = `${l.nome} · CIT Shopping`;
    const targetUrl = location.pathname === `/${slug}` ? `/${slug}` : `/loja/${slug}`;
    if (location.pathname !== targetUrl) history.pushState(null, '', targetUrl);
  }

  // Avaliações de quem comprou (link do pedido), no fim da página da loja.
  async function mostrarAvaliacoes(slug) {
    const d = await fetch(`/api/lojas/${encodeURIComponent(slug)}/avaliacoes`).then((r) => r.json()).catch(() => null);
    if (!d?.avaliacoes?.length || !location.pathname.endsWith(`/${slug}`)) return;
    const estrelas = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    $('rfoot').insertAdjacentHTML('beforeend', `<section class="lv-avaliacoes" id="avaliacoes"><h2>Avaliações de clientes</h2><ul>${d.avaliacoes.map((a) => `<li>
      <span class="nota" aria-label="${a.nota} de 5 estrelas">${estrelas(a.nota)}</span> <b>${esc(a.nome)}</b> <small>${new Date(a.em).toLocaleDateString('pt-BR')}</small>
      ${a.texto ? `<p>${esc(a.texto)}</p>` : ''}</li>`).join('')}</ul></section>`);
  }

  // Black Friday: Central (/black-friday) com contagem regressiva ao vivo, Ofertas Relâmpago por hora e kits temáticos.
  const BF_INICIO_FALLBACK = Date.parse('2026-11-27T00:00:00-03:00');
  const BF_FIM_FALLBACK = Date.parse('2026-12-01T00:00:00-03:00');
  const pad2 = (n) => String(n).padStart(2, '0');
  const alvoBF = () => {
    const ini = BF?.inicio ?? BF_INICIO_FALLBACK;
    const fim = BF?.fim ?? BF_FIM_FALLBACK;
    const agora = Date.now();
    if (agora < ini) return { modo: 'antes', alvo: ini };
    if (agora < fim) return { modo: BF?.fase === 'cyber' ? 'cyber' : 'ativa', alvo: fim };
    return { modo: 'encerrada', alvo: fim };
  };
  function textoRelampagoTimer(agora = Date.now()) {
    const ms = proximaRodadaMs(agora);
    const totalSeg = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSeg / 60), seg = totalSeg % 60;
    return `Troca em ${pad2(min)}:${pad2(seg)}`;
  }
  function textoContagemCurta(agora = Date.now()) {
    const { modo, alvo } = alvoBF();
    if (modo === 'encerrada') return '';
    const t = tempoRestante(alvo, agora);
    const relogio = `${t.dias ? `${t.dias}d ` : ''}${pad2(t.horas)}h ${pad2(t.minutos)}m ${pad2(t.segundos)}s`;
    if (modo === 'antes') return `Faltam ${relogio} para a Black Friday`;
    return modo === 'cyber' ? `CYBER MONDAY · Acaba em ${relogio}` : `BLACK FRIDAY AO VIVO · Termina em ${relogio}`;
  }
  let bfTimer = null, bfHoraAtual = -1, bfListaBase = [], bfRelampagoIds = new Set(), bfFiltroAtivo = 'todas';
  function montarRelampagoHome() {
    const sec = $('sRelampago');
    if (!sec) return;
    if (!BF?.ativa) { sec.hidden = true; return; }
    const lista = selecionarRelampago(P, Date.now(), 8);
    sec.hidden = !lista.length;
    if (!lista.length) return;
    $('r-relampago').innerHTML = lista.map(card).join('');
    const r = $('r-relampago').parentElement;
    if (!r.querySelector('.nav-btn')) {
      r.insertAdjacentHTML('beforeend', '<button class="nav-btn l" aria-label="Anteriores">‹</button><button class="nav-btn r" aria-label="Próximos">›</button>');
      r.querySelector('.l').onclick = () => $('r-relampago').scrollBy({ left: -$('r-relampago').clientWidth * 0.8, behavior: 'smooth' });
      r.querySelector('.r').onclick = () => $('r-relampago').scrollBy({ left: $('r-relampago').clientWidth * 0.8, behavior: 'smooth' });
    }
    const tEl = $('bfRelampagoTimer');
    if (tEl) tEl.textContent = textoRelampagoTimer();
  }
  function atualizarRelogiosBF() {
    const agora = Date.now();
    const hora = Math.floor(agora / 3_600_000);
    if (bfHoraAtual !== -1 && hora !== bfHoraAtual) {
      bfHoraAtual = hora;
      montarRelampagoHome();
      const trPg = $('r-bf-relampago');
      if (trPg && !$('resultsview').hidden && location.pathname === '/black-friday') {
        const rel = selecionarRelampago(P, agora, 8);
        bfRelampagoIds = new Set(rel.map((x) => x.id));
        trPg.innerHTML = rel.map(card).join('');
      }
    } else if (bfHoraAtual === -1) {
      bfHoraAtual = hora;
    }
    const timerTxt = textoRelampagoTimer(agora);
    const tHome = $('bfRelampagoTimer'); if (tHome) tHome.textContent = timerTxt;
    const tPg = $('bfRelampagoTimerPg'); if (tPg) tPg.textContent = timerTxt;
    const barra = $('bfBarraTexto'); if (barra && BF?.ativa) barra.textContent = textoContagemCurta(agora);
    const dEl = $('bfD');
    if (dEl) {
      const { modo, alvo } = alvoBF();
      const t = tempoRestante(alvo, agora);
      dEl.textContent = pad2(t.dias);
      $('bfH').textContent = pad2(t.horas);
      $('bfM').textContent = pad2(t.minutos);
      $('bfS').textContent = pad2(t.segundos);
      const rot = $('bfRelogioRotulo');
      if (rot) rot.textContent = modo === 'antes' ? 'Começa em' : modo === 'encerrada' ? 'Black Friday encerrada' : 'Termina em';
    }
  }
  function iniciarRelogioBF() {
    if (bfTimer) clearInterval(bfTimer);
    atualizarRelogiosBF();
    bfTimer = setInterval(atualizarRelogiosBF, 1000);
  }
  function aplicarFiltroBF(filtroId) {
    bfFiltroAtivo = filtroId;
    const def = FILTROS_BF.find((f) => f.id === filtroId) ?? FILTROS_BF[0];
    const filtrada = bfListaBase.filter((p) => def.testar(p, { relampagoIds: bfRelampagoIds }));
    view.list = filtrada;
    document.querySelectorAll('.bf-tab').forEach((b) => b.setAttribute('aria-pressed', b.dataset.bfTab === filtroId));
    renderResults();
  }
  async function compartilharBF() {
    const url = `${location.origin}/black-friday`;
    const res = resumoBlackFriday(P);
    const texto = `Black Friday no CIT Shopping: ${res.total} ofertas conferidas${res.maiorOff ? ` com até ${res.maiorOff}% OFF` : ''} e ofertas relâmpago por hora!`;
    try {
      if (navigator.share) return await navigator.share({ title: 'Black Friday · CIT Shopping', text: texto, url });
    } catch { return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${url}`)}`, '_blank', 'noopener');
  }
  function blackFriday() {
    const agora = Date.now();
    bfListaBase = ordenar([...P].filter(ehOfertaBlack).sort((a, b) => melhorDesconto(b) - melhorDesconto(a)));
    const relampago = selecionarRelampago(P, agora, 8);
    bfRelampagoIds = new Set(relampago.map((x) => x.id));
    const res = resumoBlackFriday(P);
    const { modo, alvo } = alvoBF();
    const t = tempoRestante(alvo, agora);
    const selo = modo === 'cyber' ? 'CYBER MONDAY · ÚLTIMO DIA' : modo === 'ativa' ? 'BLACK FRIDAY AO VIVO' : modo === 'antes' ? 'ESQUENTA BLACK FRIDAY' : 'OFERTAS VERIFICADAS';
    const tituloHero = modo === 'cyber'
      ? 'Últimas horas de Black Friday e Cyber Monday'
      : modo === 'ativa'
      ? 'Black Friday CIT Shopping'
      : modo === 'antes'
      ? 'Contagem regressiva pra Black Friday'
      : 'A Black Friday passou, mas os descontos continuam';
    const metricas = [
      res.total && `<span><b>${num.format(res.total)}</b>ofertas conferidas</span>`,
      res.maiorOff && `<span><b>Até ${res.maiorOff}% OFF</b>maior desconto real</span>`,
      res.com40Off && `<span><b>${num.format(res.com40Off)}</b>com 40% OFF ou mais</span>`,
      res.menor30 && `<span><b>${num.format(res.menor30)}</b>no menor preço em 30 dias</span>`,
      res.locais && `<span><b>${num.format(res.locais)}</b>das lojas da cidade</span>`,
    ].filter(Boolean).join('');
    const tabs = FILTROS_BF.map((f) => {
      const n = bfListaBase.filter((p) => f.testar(p, { relampagoIds: bfRelampagoIds })).length;
      if (f.id !== 'todas' && !n) return '';
      return `<button type="button" class="bf-tab" data-bf-tab="${esc(f.id)}" aria-pressed="${f.id === 'todas'}">${esc(f.rotulo)} <small>${n}</small></button>`;
    }).join('');
    const head = `
      <section class="bf-hero" aria-label="Central da Black Friday">
        <div class="bf-hero-top">
          <div class="bf-hero-copy">
            <span class="bf-pill">${selo}</span>
            <h2>${tituloHero}</h2>
            <p>Ofertas com desconto real na Shopee, Mercado Livre, Amazon, SHEIN e lojas da sua cidade — acompanhadas pelo histórico de 30 dias.</p>
            <div class="bf-acoes">
              <button type="button" class="btn bf-btn-share" data-bf-share>${ICONE_COMPARTILHAR} Compartilhar ofertas</button>
              <a class="btn bf-btn-sec" href="/cupons">Cupons do dia</a>
              <a class="btn bf-btn-zap" href="https://whatsapp.com/channel/0029VbDyNjvIyPtZGJ6HTs3i" target="_blank" rel="noopener">${ICONE_ZAP} Canal VIP</a>
            </div>
          </div>
          ${modo !== 'encerrada' ? `<div class="bf-relogio-wrap" aria-label="Contagem regressiva">
            <span class="bf-relogio-rotulo" id="bfRelogioRotulo">${modo === 'antes' ? 'Começa em' : 'Termina em'}</span>
            <div class="bf-relogio">
              <div><b id="bfD">${pad2(t.dias)}</b><small>dias</small></div>
              <div><b id="bfH">${pad2(t.horas)}</b><small>horas</small></div>
              <div><b id="bfM">${pad2(t.minutos)}</b><small>min</small></div>
              <div><b id="bfS">${pad2(t.segundos)}</b><small>seg</small></div>
            </div>
          </div>` : ''}
        </div>
        ${metricas ? `<div class="bf-metricas">${metricas}</div>` : ''}
      </section>
      ${relampago.length ? `<section class="bf-flash-box" aria-label="Ofertas Relâmpago desta hora">
        <div class="head bf-head">
          <div class="bf-head-esq">
            <span class="bf-tag-relampago">RELÂMPAGO</span>
            <h3>Ofertas Relâmpago desta hora</h3>
            <span class="bf-timer-pill" id="bfRelampagoTimerPg">${textoRelampagoTimer(agora)}</span>
          </div>
        </div>
        <div class="rail"><div class="track" id="r-bf-relampago">${relampago.map(card).join('')}</div></div>
      </section>` : ''}
      <div class="bf-tabs" role="group" aria-label="Kits e filtros da Black Friday">${tabs}</div>`;
    bfFiltroAtivo = 'todas';
    showResults('Black Friday CIT Shopping', bfListaBase, head);
    const tr = $('r-bf-relampago');
    if (tr && !tr.parentElement.querySelector('.nav-btn')) {
      tr.parentElement.insertAdjacentHTML('beforeend', '<button class="nav-btn l" aria-label="Anteriores">‹</button><button class="nav-btn r" aria-label="Próximos">›</button>');
      tr.parentElement.querySelector('.l').onclick = () => tr.scrollBy({ left: -tr.clientWidth * 0.8, behavior: 'smooth' });
      tr.parentElement.querySelector('.r').onclick = () => tr.scrollBy({ left: tr.clientWidth * 0.8, behavior: 'smooth' });
    }
    document.title = 'Black Friday · CIT Shopping';
    if (location.pathname !== '/black-friday') history.pushState(null, '', '/black-friday');
    iniciarRelogioBF();
  }

  // Janela do produto
  // Shopee: confere o preço na hora (a API devolve o atual) e troca no modal e na lista, se mudou.
  async function conferirPreco(x) {
    let v;
    try { v = await fetch(`/api/preco-agora/${encodeURIComponent(x.id)}`).then((r) => r.json()); } catch { return; }
    if (!(v?.preco > 0) || (v.preco === x.preco && (v.precoAntigo ?? null) === (x.precoAntigo ?? null))) return;
    Object.assign(x, { preco: v.preco, precoAntigo: v.precoAntigo ?? null, atualizadoEm: v.em });
    if ($('modal').hidden || $('mt').textContent !== x.nome) return;
    $('mold').textContent = off(x) ? `de ${brl.format(x.precoAntigo)}` : '';
    $('mprice').innerHTML = preco(x);
    $('msave').textContent = off(x) ? `Economia de ${brl.format(x.precoAntigo - x.preco)} (${off(x)}% off)` : x.menor30 ? 'Menor preço em 30 dias' : '';
  }
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
    desenharHistorico($('mhist'), x.loja === 'local' ? null : x.id);
    $('msave').textContent = off(x) ? `Economia de ${brl.format(x.precoAntigo - x.preco)} (${off(x)}% off)` : x.menor30 ? 'Menor preço em 30 dias' : '';
    if (x.loja === 'shopee') conferirPreco(x);
    $('mdesc').textContent = x.descricao ?? '';
    // Link próprio do produto: o servidor monta a prévia (título, preço e foto) que o WhatsApp mostra.
    const link = `${location.origin}/p/${encodeURIComponent(x.id)}`;
    // Comprar no site (Pix/cartão) só em lojas que pagam por venda e conectaram o Mercado Pago (comprar.js).
    $('malerta').dataset.alerta = x.id; // sino "baixou de preço" (alerta.js)
    $('mfavorito').dataset.favorito = x.id; // favoritos (favoritos.js)
    window.CITFavoritos?.pintar();
    // Carrinho (comprar.js): só produtos das lojas locais; finaliza uma loja por vez em /carrinho.
    // Loja que paga por venda (soPeloSite) vende só pelo Mercado Pago: sem pedido pelo WhatsApp.
    $('mcarrinho').hidden = !local || (x.soPeloSite && !x.compraOnline);
    if (local) Object.assign($('mcarrinho').dataset, { carrinho: x.id, loja: x.lojaId });
    $('mcomprar').hidden = !(local && x.compraOnline);
    $('mcomprar').dataset.comprar = x.id;
    $('mcomprar').dataset.entrega = x.entrega ?? '';
    $('mbuy').className = local && x.compraOnline ? 'zapbtn' : 'buybtn';
    // Loja local: "Pedir pelo WhatsApp" abre o formulário do pedido (comprar.js) e registra o pedido para a loja.
    if (local) { $('mbuy').dataset.pedirZap = x.id; $('mbuy').dataset.entrega = x.entrega ?? ''; }
    else { delete $('mbuy').dataset.pedirZap; delete $('mbuy').dataset.entrega; }
    if (local) {
      const baseContato = `/contato/${encodeURIComponent(x.id)}`;
      $('mbuy').href = baseContato;
      $('mbuy').rel = 'noopener';
      $('mbuy').textContent = 'Pedir pelo WhatsApp da loja ↗';
      $('mbuy').hidden = Boolean(x.soPeloSite);
      const disponibilidade = DISPONIBILIDADE[x.disponibilidade] ?? DISPONIBILIDADE.consulte;
      $('mnote').textContent = `Vendido por ${x.lojaNome}, ${x.cidade}${x.entrega ? ` · ${window.CIT.textoEntrega(x.entrega)}` : ''} · ${disponibilidade}. ${x.compraOnline ? 'Pague aqui com Pix ou cartão; a loja combina a entrega com você pelo WhatsApp.' : x.soPeloSite ? 'Compra pelo site com Pix ou cartão disponível em breve.' : 'Combine pagamento e entrega direto com a loja.'}`;

      // Opções do pedido: só as variações cadastradas pela loja (sem tamanhos e cores inventados).
      const grupos = Array.isArray(x.variacoes) ? x.variacoes : [];
      $('mvariants').hidden = false;
      $('mvariants').innerHTML = `
        <div class="variant-title">${grupos.length ? 'Opções para o pedido' : 'Detalhes do pedido'}</div>
        ${grupos.map((g) => `
        <div class="variant-group">
          <span>${esc(g.nome)}:</span>
          <div class="chips">${g.opcoes.map((o) => `<button type="button" class="chip-opt" data-var="${esc(g.nome.toLowerCase())}" data-val="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        </div>`).join('')}
        <div class="variant-group">
          <span>Observação para a loja (opcional):</span>
          <input type="text" class="variant-obs" id="mvar-obs" placeholder="Ex.: nome para personalizar, cor preferida, recado...">
        </div>
      `;

      function atualizarLinkModal() {
        const url = new URL(baseContato, location.origin);
        // Variações escolhidas + observação vão juntas no recado do WhatsApp.
        const escolhas = [...$('mvariants').querySelectorAll('.chip-opt.active')].map((c) => `${c.dataset.var}: ${c.dataset.val}`);
        const obs = [...escolhas, $('mvar-obs')?.value?.trim()].filter(Boolean).join('; ');
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
      $('mbuy').hidden = false;
      $('mbuy').href = `/ir/${encodeURIComponent(x.id)}?c=site`; // clique contado e origem marcada (afiliados-canal.js)
      $('mbuy').rel = 'sponsored nofollow noopener';
      $('mbuy').textContent = `Comprar na ${STORE[x.loja]} ↗`;
      // Preço vindo de API com hora da consulta (hoje só a Amazon): mostra quando foi visto.
      const quando = x.atualizadoEm ? ` Preço consultado em ${new Date(x.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} e pode mudar.` : '';
      const pix = x.loja === 'shopee' ? ' Na Shopee pode sair menor no Pix ou com cupom.' : '';
      $('mnote').textContent = `Você finaliza a compra no site da loja. Preço e frete confirmados lá.${quando}${pix}`;
    }
    $('mzap').href = `https://wa.me/?text=${encodeURIComponent(`Olha esse achado na CIT Shopping: ${x.nome} por ${brl.format(x.preco)} ${link}`)}`;
    const jaAberto = !$('modal').hidden;
    $('modal').hidden = false;
    $('mx').focus();
    if (!jaAberto) tituloAntes = location.pathname.startsWith('/p/') ? TITULO : document.title;
    document.title = `${x.nome} · CIT Shopping`;
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

  // Contagem no topo: durante a Black Friday destaca o cronômetro ao vivo; nos outros dias, a próxima data dupla.
  function montarContagem() {
    const favoritos = (window.CITFavoritos?.ler() ?? []).filter((id) => !id.startsWith('loja:'));
    const navBf = $('navBf');
    if (navBf) navBf.innerHTML = BF?.ativa ? 'Black Friday <span class="bf-live">AO VIVO</span>' : 'Black Friday';
    if (BF?.ativa) {
      $('contagem').className = 'wrap contagem contagem-bf';
      $('contagem').innerHTML = `<span class="contagem-dias" id="bfBarraTexto">${esc(textoContagemCurta())}</span><div class="contagem-acoes"><a class="contagem-bf-cta" href="/black-friday">Ver Central Black Friday →</a><button type="button" id="verFavoritos">Seus favoritos (${favoritos.length})</button></div>`;
      $('contagem').hidden = false;
      iniciarRelogioBF();
      return;
    }
    if (!PROXIMA) return;
    $('contagem').className = 'wrap contagem';
    const quando = PROXIMA.dias === 0 ? `É hoje o ${PROXIMA.nome}!` : `Faltam ${PROXIMA.dias} ${PROXIMA.dias === 1 ? 'dia' : 'dias'} para o ${PROXIMA.nome}`;
    $('contagem').innerHTML = `<span class="contagem-dias">${esc(quando)}</span><button type="button" id="verFavoritos">Seus favoritos (${favoritos.length})</button>`;
    $('contagem').hidden = false;
  }
  document.addEventListener('favoritos', montarContagem);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#verFavoritos')) return;
    const ids = window.CITFavoritos?.ler() ?? [];
    const lista = P.filter((x) => ids.includes(x.id));
    showResults(`Seus favoritos para o ${PROXIMA?.nome ?? 'próximo dia de ofertas'}`, lista,
      lista.length ? '' : '<p class="empty">Toque em "Salvar nos favoritos" nos produtos para montar sua lista. Ela fica guardada neste aparelho.</p>');
  });

  // Campanhas da própria Shopee (imagem e prazo vêm da API); o clique passa pelo /ir (conta e marca o canal).
  function terminaEm(fim) {
    if (!fim) return '';
    const ms = Date.parse(fim) - Date.now(), h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
    if (ms <= 0) return 'Encerrada';
    if (d >= 1) return `Termina em ${d} ${d === 1 ? 'dia' : 'dias'}`;
    if (h >= 1) return `Termina em ${h} h`;
    return `Termina em ${Math.max(1, Math.floor(ms / 60000))} min`;
  }
  function montarCampanhas() {
    const lista = CAMPANHAS_SHOPEE.filter((c) => !c.fim || Date.parse(c.fim) > Date.now());
    $('sCampanhas').hidden = !lista.length;
    $('r-campanhas').innerHTML = lista.map((c) => `<a class="camp-card" href="/ir/${encodeURIComponent(c.id)}?c=site" target="_blank" rel="sponsored nofollow noopener">
      <img src="${esc(c.imagem)}" alt="" loading="lazy" width="320" height="160"><span><b>${esc(c.nome)}</b>${c.fim ? `<small>${terminaEm(c.fim)}</small>` : ''}</span></a>`).join('');
  }
  function montarHome() {
    montarRelampagoHome();
    montarCampanhas();
    const lojasFav = new Set((window.CITFavoritos?.ler() ?? []).filter((id) => id.startsWith('loja:')).map((id) => id.slice(5)));
    const lojasHome = [...LOJAS.filter((l) => lojasFav.has(l.slug)), ...LOJAS.filter((l) => !lojasFav.has(l.slug))];
    $('sellers').innerHTML = lojasHome.slice(0, 12).map((l) => `<a class="seller" href="/loja/${esc(l.slug)}" data-seller="${esc(l.slug)}" style="border-top:4px solid ${esc(l.cor || '#036271')}">
        <div class="top"><span class="avatar" style="background:${esc(l.cor || '#036271')};color:${window.CIT.textoSobre(l.cor || '#036271')}">${l.logo ? `<img src="${esc(l.logo)}" alt="">` : esc(iniciais(l.nome))}</span><span><b>${lojasFav.has(l.slug) ? '<span class="seller-fav" aria-label="Loja favorita">♥</span> ' : ''}${esc(l.nome)}</b><small>${esc(l.categoria || 'Loja local')}${l.avaliacao ? ` · ★ ${String(l.avaliacao.media).replace('.', ',')}` : ''}</small></span></div>
        <div class="meta"><span>${P.filter((x) => x.lojaSlug === l.slug).length} produtos</span><span>${esc(l.cidade)}</span></div></a>`).join('') +
      `<a class="seller cta" href="/painel"><div class="top"><span class="avatar">+</span><span><b>Sua loja aqui</b><small>30 dias grátis pra testar</small></span></div></a>`;
    for (const k of Object.keys(LISTS)) rail(`r-${k}`, LISTS[k].f());
  }

  function rota() {
    const mLoja = location.pathname.match(/^\/loja\/([a-z0-9-]+)/i);
    if (mLoja) return bySeller(mLoja[1].toLowerCase());

    const mDireto = location.pathname.match(/^\/([a-z0-9-]+)$/i);
    if (mDireto) {
      const slug = mDireto[1].toLowerCase();
      const reservados = ['black-friday', 'bio', 'admin', 'painel', 'termos', 'privacidade'];
      if (!reservados.includes(slug)) {
        const lojaEncontrada = LOJAS.find((l) => l.slug === slug);
        if (lojaEncontrada) return bySeller(slug);
      }
    }

    if (location.pathname === '/black-friday') return blackFriday();
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
    const bfShare = t.closest('[data-bf-share]'); if (bfShare) return compartilharBF();
    const bfTab = t.closest('[data-bf-tab]'); if (bfTab) return aplicarFiltroBF(bfTab.dataset.bfTab);
    const bfLink = t.closest('a[href="/black-friday"]');
    if (bfLink && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      return blackFriday();
    }
    const sh = t.closest('[data-compartilhar]'); if (sh) return compartilhar(sh);
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
  $('rmarca').addEventListener('change', (e) => { view.marca = e.target.value; renderResults(); });
  $('rmais').addEventListener('click', () => renderResults(true));
  $('rmin').addEventListener('input', (e) => { view.precoMin = e.target.value; renderResults(); });
  $('rmax').addEventListener('input', (e) => { view.precoMax = e.target.value; renderResults(); });
  $('rreset').addEventListener('click', () => {
    view.ordem = 'relevancia'; view.cidade = ''; view.sub = ''; view.origem = ''; view.marca = ''; view.precoMin = ''; view.precoMax = '';
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
    // Só o texto da busca (sem dado de quem buscou): o "mais buscado da semana" vira post no Instagram.
    if (q.length >= 3) fetch('/api/busca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }), keepalive: true }).catch(() => {});
    showResults(q ? `Resultados para "${q}"` : dep ? D[dep].n : 'Todos os produtos', P, '', { q, dept: dep });
    if (q.length >= 3) buscarAoVivo(q);
  });

  // Busca ao vivo: o que o catálogo não tem vem da Shopee na hora (API oficial) e da busca da Amazon com a nossa tag.
  // Nada é gravado na vitrine; os cards levam direto ao link de afiliado.
  async function buscarAoVivo(q) {
    let d;
    try { d = await fetch(`/api/busca-ao-vivo?q=${encodeURIComponent(q)}`).then((r) => r.json()); } catch { return; }
    if (view.q !== q || $('resultsview').hidden) return; // a pessoa já buscou outra coisa
    const cards = (d.produtos ?? []).map((x) => `<a class="card" href="${esc(x.link)}" target="_blank" rel="sponsored nofollow noopener">${shot(x)}</div>
      <div class="body"><h3>${esc(x.nome)}</h3>${x.nota ? `<div class="rate"><b>★ ${x.nota.toFixed(1).replace('.', ',')}</b>${x.vendidos ? ` · ${num.format(x.vendidos)} vendidos` : ''}</div>` : ''}${off(x) ? `<div class="old">${brl.format(x.precoAntigo)}</div>` : ''}
      <div class="price">${preco(x)}</div><div class="vendido">Vendido por Shopee</div></div></a>`).join('');
    const amazon = d.amazon ? `<p class="aovivo-amazon"><a class="btn sec" href="${esc(d.amazon)}" target="_blank" rel="sponsored nofollow noopener">Ver "${esc(q)}" na Amazon ↗</a></p>` : '';
    if (!cards && !amazon) return;
    $('raovivo').innerHTML = `<h2>Mais opções para "${esc(q)}"</h2>${cards ? `<p class="aovivo-ajuda">Direto da Shopee, agora. O preço é confirmado lá.</p><div class="results-grid">${cards}</div>` : ''}${amazon}`;
    $('raovivo').hidden = false;
  }

  fetch('/api/vitrine')
    .then((r) => r.json())
    .then((d) => { P = d.produtos.map((x) => ({ ...x, categoriaNome: D[x.dept]?.n ?? x.dept })); LOJAS = d.lojas; CAMPANHA = d.campanha ?? null; PROXIMA = d.proximaCampanha ?? null; BF = d.blackFriday ?? null; CUPONS = d.cupons ?? []; CAMPANHAS_SHOPEE = d.campanhasShopee ?? []; renderSlides(); start(); montarContagem();
      // Faixa "Especial" na data dupla (12.12, 1.1...) ou Black Friday; nos outros dias fica escondida.
      if (CAMPANHA) { $('seloCampanha').textContent = `Especial ${CAMPANHA}`; $('seloCampanha').hidden = false; $('faixaCampanha').hidden = false; }
      montarHome(); rota();
      // Link /#sellers (ex.: da /bio): a faixa só existe depois do fetch, então rola até ela aqui.
      if (location.hash === '#sellers') $('sellers').closest('section').scrollIntoView(); })
    .catch(() => { $('sellers').innerHTML = '<p class="empty">Não foi possível carregar as ofertas. Recarregue a página.</p>'; });
})();
