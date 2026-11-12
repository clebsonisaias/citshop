// Sino "Avisar quando baixar o preço": botões com data-alerta="<id do produto>" (vitrine e /p/<id>).
// O cliente deixa o WhatsApp e recebe um aviso quando o preço cair. Arquivo externo por causa da CSP.
(() => {
  const dlg = document.createElement('dialog');
  dlg.className = 'compra';
  dlg.setAttribute('aria-labelledby', 'alertaTitulo');
  dlg.innerHTML = `
    <form class="compra-form" novalidate>
      <div class="compra-topo"><h2 id="alertaTitulo">Avisar quando baixar</h2><button type="button" class="compra-fechar" aria-label="Fechar">×</button></div>
      <p class="compra-ajuda">Quando o preço deste produto cair, mandamos um aviso no seu WhatsApp com o link. É um aviso só, e você pode cancelar quando quiser.</p>
      <label>Seu WhatsApp com DDD<input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" placeholder="(84) 99999-9999" required></label>
      <p class="compra-erro" role="alert" hidden></p>
      <button class="buybtn" type="submit">Quero ser avisado</button>
      <p class="compra-seguro">Usamos seu número só para este aviso. O alerta expira em 90 dias. <a href="/privacidade.html" target="_blank">Privacidade</a></p>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const erro = dlg.querySelector('.compra-erro');
  const enviar = form.querySelector('button[type="submit"]');
  let produtoId = null;
  dlg.querySelector('.compra-fechar').onclick = () => dlg.close();

  document.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-alerta]');
    if (!botao) return;
    e.preventDefault();
    produtoId = botao.dataset.alerta;
    erro.hidden = true;
    enviar.disabled = false;
    enviar.textContent = 'Quero ser avisado';
    dlg.showModal();
    form.whatsapp.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    enviar.disabled = true;
    erro.hidden = true;
    try {
      const res = await fetch('/api/alertas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produtoId, whatsapp: form.whatsapp.value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.erro || 'Não foi possível criar o alerta. Tente de novo.');
      enviar.textContent = 'Pronto! Você será avisado';
      setTimeout(() => dlg.close(), 1600);
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      enviar.disabled = false;
    }
  });
})();
