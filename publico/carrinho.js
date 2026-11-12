// Página /carrinho: itens guardados no aparelho (comprar.js), agrupados por loja. Nome, foto e preço vêm da
// vitrine atual, e o servidor recalcula tudo ao finalizar. Cada loja finaliza o próprio pedido (data-finalizar).
(() => {
  const { esc } = window.CIT;
  const { ler, gravar } = window.CITCarrinho;
  const caixa = document.getElementById('carrinho');
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  let produtos = null, sumiu = false;

  function render() {
    const todos = ler();
    // Produto que saiu da vitrine (pausado, apagado, loja vencida) sai do carrinho com aviso.
    const itens = todos.filter((i) => produtos.has(i.id));
    const sumiram = todos.length - itens.length;
    if (sumiram) { sumiu = true; gravar(itens); return; }
    if (!itens.length) {
      caixa.innerHTML = '<div class="carrinho-vazio"><p>Seu carrinho está vazio.</p><p class="note">Nos produtos das lojas da região, toque em "Adicionar ao carrinho" para juntar vários itens num pedido só.</p><a class="buybtn" href="/#sellers">Ver lojas da região</a></div>';
      return;
    }
    const lojas = new Map();
    for (const i of itens) {
      const p = produtos.get(i.id);
      if (!lojas.has(p.lojaId)) lojas.set(p.lojaId, { p, itens: [] });
      lojas.get(p.lojaId).itens.push({ ...i, p });
    }
    const aviso = sumiu ? '<p class="note carrinho-aviso">Alguns produtos não estão mais disponíveis e saíram do carrinho.</p>' : '';
    caixa.innerHTML = aviso + [...lojas.entries()].map(([lojaId, { p: l, itens: doLoja }]) => {
      const total = doLoja.reduce((s, i) => s + i.p.preco * i.q, 0);
      const unidades = doLoja.reduce((s, i) => s + i.q, 0);
      const fim = `data-finalizar="${esc(lojaId)}" data-entrega="${esc(l.entrega ?? '')}"`;
      return `<section class="carrinho-loja" aria-label="Pedido para ${esc(l.lojaNome)}">
        <div class="carrinho-loja-topo"><h2><a href="/${esc(l.lojaSlug)}">${esc(l.lojaNome)}</a></h2><small>${esc(l.cidade ?? '')}</small></div>
        <ul>${doLoja.map((i) => {
          const chave = esc(JSON.stringify([i.id, i.obs]));
          return `<li class="carrinho-item">
            ${i.p.fotos?.[0] ? `<img src="${esc(i.p.fotos[0])}" alt="" width="64" height="64" loading="lazy">` : '<span class="carrinho-sem-foto"></span>'}
            <div class="carrinho-item-info">
              <a href="/p/${encodeURIComponent(i.id)}">${esc(i.p.nome)}</a>
              ${i.obs ? `<small>${esc(i.obs)}</small>` : ''}
              <b>${brl.format(i.p.preco * i.q)}</b>
            </div>
            <div class="carrinho-qtd" role="group" aria-label="Quantidade de ${esc(i.p.nome)}">
              <button type="button" data-qtd="-1" data-item="${chave}" aria-label="Diminuir">−</button>
              <span>${i.q}</span>
              <button type="button" data-qtd="1" data-item="${chave}" aria-label="Aumentar"${i.q >= 10 ? ' disabled' : ''}>+</button>
            </div>
            <button type="button" class="carrinho-remover" data-remover data-item="${chave}">Remover</button>
          </li>`;
        }).join('')}</ul>
        <p class="carrinho-total"><span>${unidades} ${unidades === 1 ? 'item' : 'itens'}</span><b>${brl.format(total)}</b></p>
        ${l.compraOnline
          ? `<button type="button" class="buybtn" ${fim} data-modo="site">Pagar com Pix ou cartão</button>
             <p class="note">Pagamento pelo Mercado Pago. A loja combina a entrega com você pelo WhatsApp.</p>`
          : l.soPeloSite
          ? '<p class="note">Esta loja está ativando os pagamentos pelo site. Volte em breve para finalizar.</p>'
          : `<button type="button" class="buybtn" ${fim} data-modo="zap">Enviar pedido pelo WhatsApp</button>
             <p class="note">A loja combina com você o pagamento e a entrega pelo WhatsApp.</p>`}
      </section>`;
    }).join('');
  }

  caixa.addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]');
    if (!b) return;
    const [id, obs] = JSON.parse(b.dataset.item);
    const c = ler();
    const i = c.findIndex((x) => x.id === id && x.obs === obs);
    if (i < 0) return;
    const q = b.hasAttribute('data-remover') ? 0 : c[i].q + Number(b.dataset.qtd);
    if (q <= 0) c.splice(i, 1); else c[i].q = Math.min(10, q);
    gravar(c);
  });
  addEventListener('carrinho', () => { if (produtos) render(); });

  fetch('/api/vitrine')
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then((v) => { produtos = new Map(v.produtos.filter((p) => p.loja === 'local').map((p) => [p.id, p])); render(); })
    .catch(() => { caixa.innerHTML = '<p class="note">Não foi possível carregar o carrinho agora. Atualize a página para tentar de novo.</p>'; });
})();
