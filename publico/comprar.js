// Formulário de pedido das lojas locais, usado na vitrine e na página /p/<id>:
// - data-comprar="<id>": compra no site (Pix ou cartão no Mercado Pago), para lojas que pagam por venda;
// - data-pedir-zap="<id>": pedido pelo WhatsApp da loja (todas as lojas locais), registrado com código.
// Nos dois casos o cliente informa nome e WhatsApp e o pedido aparece em "Vendas e pedidos" no painel da loja.
// Arquivo externo porque a CSP do site (script-src 'self') bloqueia script inline.
(() => {
  const AVISOS = {
    aprovada: ['ok', 'Pagamento aprovado! A loja vai falar com você no WhatsApp para combinar a entrega.'],
    pendente: ['info', 'Pagamento em análise ou aguardando o Pix. Assim que confirmar, a loja fala com você no WhatsApp.'],
    falhou: ['erro', 'O pagamento não foi concluído. Você pode tentar de novo.'],
  };

  // Volta do Mercado Pago (/p/<id>?compra=aprovada|pendente|falhou).
  const volta = new URLSearchParams(location.search).get('compra');
  if (AVISOS[volta]) {
    const aviso = document.createElement('div');
    aviso.className = `aviso-compra ${AVISOS[volta][0]}`;
    aviso.setAttribute('role', 'status');
    aviso.innerHTML = `<p></p><button type="button" aria-label="Fechar aviso">×</button>`;
    aviso.querySelector('p').textContent = AVISOS[volta][1];
    aviso.querySelector('button').onclick = () => aviso.remove();
    document.body.append(aviso);
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
      <label>Quantidade<input name="quantidade" type="number" min="1" max="10" value="1" required></label>
      <label>Observação para a loja <small>opcional</small><textarea name="observacao" rows="2" maxlength="300" placeholder="Cor, tamanho, recado..."></textarea></label>
      <p class="compra-erro" role="alert" hidden></p>
      <button class="buybtn" type="submit"></button>
      <p class="compra-seguro">Seus dados vão só para a loja, para combinar o pedido, e ficam guardados por 12 meses. <a href="/privacidade.html" target="_blank">Privacidade</a></p>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const erro = dlg.querySelector('.compra-erro');
  const endereco = dlg.querySelector('.compra-endereco');
  let produtoId = null, modo = 'site';
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

  document.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-comprar], [data-pedir-zap]');
    if (!botao) return;
    e.preventDefault();
    modo = botao.dataset.comprar ? 'site' : 'zap';
    produtoId = botao.dataset.comprar || botao.dataset.pedirZap;
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
    form.observacao.value = opcoesEscolhidas(botao);
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
    try {
      const res = await fetch(m.rota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId,
          quantidade: Number(form.quantidade.value) || 1,
          comprador: { nome: form.nome.value, whatsapp: form.whatsapp.value, receber: form.receber.value, endereco: form.endereco.value, observacao: form.observacao.value },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !m.destino(d)) throw new Error(d.erro || 'Não foi possível enviar agora. Tente de novo.');
      location.href = m.destino(d);
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      enviar.disabled = false;
      enviar.textContent = m.enviar;
    }
  });
})();
