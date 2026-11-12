// Compra pelo site (Pix ou cartão no Mercado Pago) para lojas que pagam por venda, como a Mimos da Delly.
// Qualquer botão com data-comprar="<id do produto>" abre o formulário; usado na vitrine e na página /p/<id>.
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
      <div class="compra-topo"><h2 id="compraTitulo">Seus dados para a compra</h2><button type="button" class="compra-fechar" aria-label="Fechar">×</button></div>
      <p class="compra-ajuda">A loja usa esses dados para combinar a entrega com você. Depois você paga com Pix ou cartão no Mercado Pago.</p>
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
      <button class="buybtn" type="submit">Ir para o pagamento</button>
      <p class="compra-seguro">Pagamento processado pelo Mercado Pago. O CIT Shopping não vê os dados do seu cartão.</p>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const erro = dlg.querySelector('.compra-erro');
  const endereco = dlg.querySelector('.compra-endereco');
  let produtoId = null;

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
    const botao = e.target.closest('[data-comprar]');
    if (!botao) return;
    e.preventDefault();
    produtoId = botao.dataset.comprar;
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
    enviar.disabled = true;
    enviar.textContent = 'Abrindo o pagamento...';
    erro.hidden = true;
    try {
      const res = await fetch('/api/pagamento/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoId,
          quantidade: Number(form.quantidade.value) || 1,
          comprador: { nome: form.nome.value, whatsapp: form.whatsapp.value, receber: form.receber.value, endereco: form.endereco.value, observacao: form.observacao.value },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.initPoint) throw new Error(d.erro || 'Não foi possível abrir o pagamento. Tente de novo.');
      location.href = d.initPoint;
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      enviar.disabled = false;
      enviar.textContent = 'Ir para o pagamento';
    }
  });
})();
