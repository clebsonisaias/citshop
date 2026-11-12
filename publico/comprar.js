// Formulário de pedido das lojas locais, usado na vitrine, na página /p/<id> e no /carrinho:
// - data-comprar="<id>": compra no site (Pix ou cartão no Mercado Pago), para lojas que pagam por venda;
// - data-pedir-zap="<id>": pedido pelo WhatsApp da loja (todas as lojas locais), registrado com código;
// - data-carrinho="<id>" data-loja="<lojaId>": põe o produto no carrinho (guardado no aparelho);
// - data-finalizar="<lojaId>" data-modo="site|zap": finaliza os itens do carrinho daquela loja (página /carrinho).
// Em todos os casos o cliente informa nome e WhatsApp e o pedido aparece em "Vendas e pedidos" no painel da loja.
// Arquivo externo porque a CSP do site (script-src 'self') bloqueia script inline.
(() => {
  // ---------- carrinho: [{ id, loja, q, obs }] no localStorage; nome e preço vêm do servidor ----------
  const CHAVE = 'cit-carrinho';
  const ler = () => {
    try { const c = JSON.parse(localStorage.getItem(CHAVE)); return Array.isArray(c) ? c : []; } catch { return []; }
  };
  const flutuante = document.createElement('a');
  flutuante.className = 'carrinho-flutuante';
  flutuante.href = '/carrinho';
  flutuante.hidden = true;
  flutuante.innerHTML = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h11L21 7H6.2M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1"/></svg><span></span>';
  function pintar() {
    const n = ler().reduce((s, i) => s + i.q, 0);
    flutuante.hidden = !n || location.pathname === '/carrinho';
    flutuante.querySelector('span').textContent = `Carrinho (${n})`;
    flutuante.setAttribute('aria-label', `Ver carrinho, ${n} ${n === 1 ? 'item' : 'itens'}`);
  }
  function gravar(c) {
    try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch { /* modo privado: o carrinho vale só nesta página */ }
    pintar();
    dispatchEvent(new Event('carrinho'));
  }
  window.CITCarrinho = { ler, gravar };
  addEventListener('storage', (e) => { if (e.key === CHAVE) { pintar(); dispatchEvent(new Event('carrinho')); } });
  document.body.append(flutuante);
  pintar();

  const AVISOS = {
    aprovada: ['ok', 'Pagamento aprovado! A loja vai falar com você no WhatsApp para combinar a entrega.'],
    pendente: ['info', 'Pagamento em análise ou aguardando o Pix. Assim que confirmar, a loja fala com você no WhatsApp.'],
    falhou: ['erro', 'O pagamento não foi concluído. Você pode tentar de novo.'],
  };
  function avisar(tipo, texto) {
    const aviso = document.createElement('div');
    aviso.className = `aviso-compra ${tipo}`;
    aviso.setAttribute('role', 'status');
    aviso.innerHTML = `<p></p><button type="button" aria-label="Fechar aviso">×</button>`;
    aviso.querySelector('p').textContent = texto;
    aviso.querySelector('button').onclick = () => aviso.remove();
    document.body.append(aviso);
    return aviso;
  }

  // Volta do Mercado Pago (/p/<id>?compra=... ou /carrinho?compra=...&loja=<lojaId>).
  const params = new URLSearchParams(location.search);
  const volta = params.get('compra');
  if (AVISOS[volta]) {
    avisar(...AVISOS[volta]);
    // Pago (ou Pix aguardando): os itens daquela loja saem do carrinho; se falhou, ficam para tentar de novo.
    const lojaPaga = params.get('loja');
    if (lojaPaga && volta !== 'falhou') gravar(ler().filter((i) => i.loja !== lojaPaga));
    history.replaceState(null, '', location.pathname);
  }

  const dlg = document.createElement('dialog');
  dlg.className = 'compra';
  dlg.setAttribute('aria-labelledby', 'compraTitulo');
  dlg.innerHTML = `
    <form class="compra-form" novalidate>
      <div class="compra-topo"><h2 id="compraTitulo"></h2><button type="button" class="compra-fechar" aria-label="Fechar">×</button></div>
      <p class="compra-ajuda"></p>
      <label>Seu nome<input name="nome" autocomplete="name" required maxlength="80"></label>
      <label>Seu WhatsApp com DDD<input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" placeholder="(84) 99999-9999" required></label>
      <fieldset class="compra-receber"><legend>Como quer receber</legend>
        <label><input type="radio" name="receber" value="retirada" checked> Retirar na loja</label>
        <label><input type="radio" name="receber" value="entrega"> Entrega</label>
      </fieldset>
      <label class="compra-endereco" hidden>Endereço de entrega<input name="endereco" autocomplete="street-address" maxlength="200" placeholder="Rua, número, bairro e cidade"></label>
      <label class="compra-qtd">Quantidade<input name="quantidade" type="number" min="1" max="10" value="1" required></label>
      <label>Observação para a loja <small>opcional</small><textarea name="observacao" rows="2" maxlength="300" placeholder="Cor, tamanho, recado..."></textarea></label>
      <p class="compra-erro" role="alert" hidden></p>
      <button class="buybtn" type="submit"></button>
      <p class="compra-seguro">Seus dados vão só para a loja, para combinar o pedido, e ficam guardados por 12 meses. <a href="/privacidade.html" target="_blank">Privacidade</a></p>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const erro = dlg.querySelector('.compra-erro');
  const endereco = dlg.querySelector('.compra-endereco');
  const qtd = dlg.querySelector('.compra-qtd');
  let produtoId = null, lojaFinal = null, modo = 'site';
  const MODOS = {
    site: { titulo: 'Seus dados para a compra', ajuda: 'A loja usa esses dados para combinar a entrega com você. Depois você paga com Pix ou cartão no Mercado Pago, que cuida dos dados do cartão.', enviar: 'Ir para o pagamento', enviando: 'Abrindo o pagamento...', rota: '/api/pagamento/split', destino: (d) => d.initPoint },
    zap: { titulo: 'Seus dados para o pedido', ajuda: 'Seu pedido vai para o WhatsApp da loja, que combina com você o pagamento e a entrega.', enviar: 'Enviar pedido pelo WhatsApp', enviando: 'Abrindo o WhatsApp...', rota: '/api/pedidos/whatsapp', destino: (d) => d.url },
  };

  const atualizarEntrega = () => { endereco.hidden = form.receber.value !== 'entrega'; };
  form.addEventListener('change', atualizarEntrega);
  dlg.querySelector('.compra-fechar').onclick = () => dlg.close();

  // Opções escolhidas na página (modelo/cor/tamanho/observação) viram a observação do pedido.
  function opcoesEscolhidas(botao) {
    const area = botao.closest('.sheet, .product-info') ?? document;
    const partes = [...area.querySelectorAll('.chip-opt.active')].map((c) => `${c.dataset.var}: ${c.dataset.val}`);
    const obs = area.querySelector('.variant-obs')?.value.trim();
    return [...partes, obs].filter(Boolean).join('; ');
  }

  function adicionar(botao) {
    const id = botao.dataset.carrinho, loja = botao.dataset.loja, obs = opcoesEscolhidas(botao).slice(0, 150);
    const c = ler();
    const igual = c.find((i) => i.id === id && i.obs === obs);
    if (igual) igual.q = Math.min(10, igual.q + 1);
    else c.push({ id, loja, q: 1, obs });
    if (c.length > 60) c.shift(); // ponytail: limite simples para o carrinho não crescer sem fim
    gravar(c);
    const rotulo = botao.querySelector('span') ?? botao;
    const antes = botao.dataset.rotulo ??= rotulo.textContent;
    rotulo.textContent = 'Adicionado ao carrinho ✓';
    clearTimeout(botao._t);
    botao._t = setTimeout(() => { rotulo.textContent = antes; }, 1800);
  }

  document.addEventListener('click', (e) => {
    const noCarrinho = e.target.closest('[data-carrinho]');
    if (noCarrinho) { e.preventDefault(); adicionar(noCarrinho); return; }
    const botao = e.target.closest('[data-comprar], [data-pedir-zap], [data-finalizar]');
    if (!botao) return;
    e.preventDefault();
    lojaFinal = botao.dataset.finalizar ?? null;
    modo = lojaFinal ? botao.dataset.modo : botao.dataset.comprar ? 'site' : 'zap';
    produtoId = botao.dataset.comprar || botao.dataset.pedirZap || null;
    const m = MODOS[modo];
    dlg.querySelector('#compraTitulo').textContent = m.titulo;
    dlg.querySelector('.compra-ajuda').textContent = m.ajuda;
    form.querySelector('button[type="submit"]').textContent = m.enviar;
    const entrega = botao.dataset.entrega; // retirada | entrega | ambos | vazio
    const so = entrega === 'retirada' || entrega === 'entrega' ? entrega : null;
    form.querySelectorAll('input[name="receber"]').forEach((r) => {
      r.closest('label').hidden = Boolean(so) && r.value !== so;
      r.checked = so ? r.value === so : r.value === 'retirada';
    });
    // No carrinho a quantidade e as opções já estão em cada item.
    qtd.hidden = Boolean(lojaFinal);
    form.observacao.value = lojaFinal ? '' : opcoesEscolhidas(botao);
    erro.hidden = true;
    atualizarEntrega();
    dlg.showModal();
    form.nome.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enviar = form.querySelector('button[type="submit"]');
    const m = MODOS[modo];
    enviar.disabled = true;
    enviar.textContent = m.enviando;
    erro.hidden = true;
    const comprador = { nome: form.nome.value, whatsapp: form.whatsapp.value, receber: form.receber.value, endereco: form.endereco.value, observacao: form.observacao.value };
    const itensLoja = lojaFinal ? ler().filter((i) => i.loja === lojaFinal) : null;
    try {
      const res = await fetch(m.rota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itensLoja
          ? { itens: itensLoja.map((i) => ({ produtoId: i.id, quantidade: i.q, observacao: i.obs })), comprador }
          : { produtoId, quantidade: Number(form.quantidade.value) || 1, comprador }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !m.destino(d)) throw new Error(d.erro || 'Não foi possível enviar agora. Tente de novo.');
      // Pedido pelo WhatsApp já está registrado: os itens desta loja saem do carrinho.
      if (itensLoja && modo === 'zap') gravar(ler().filter((i) => i.loja !== lojaFinal));
      location.href = m.destino(d);
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      enviar.disabled = false;
      enviar.textContent = m.enviar;
    }
  });
})();
