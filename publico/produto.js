// Página /p/<id>: marca a opção escolhida (modelo/tamanho/cor) e leva para o link do pedido.
// Estava embutido no HTML e a CSP (script-src 'self') bloqueava: as opções não marcavam e não chegavam ao pedido.
(function() {
  const container = document.getElementById('variacoes-produto');
  const btnComprar = document.getElementById('btn-comprar');
  if (!container || !btnComprar) return;

  btnComprar.setAttribute('data-base', btnComprar.getAttribute('href'));

  function atualizarLink() {
    const base = btnComprar.getAttribute('data-base') || btnComprar.href;
    const url = new URL(base, window.location.origin);

    const chipMod = container.querySelector('.chip-opt[data-var="modelo"].active');
    const inputMod = container.querySelector('input[name="modelo"]');
    const modelo = chipMod ? chipMod.dataset.val : (inputMod ? inputMod.value.trim() : '');

    const chipTam = container.querySelector('.chip-opt[data-var="tamanho"].active');
    const inputTam = container.querySelector('input[name="tamanho"]');
    const tamanho = chipTam ? chipTam.dataset.val : (inputTam ? inputTam.value.trim() : '');

    const chipCor = container.querySelector('.chip-opt[data-var="cor"].active');
    const inputCor = container.querySelector('input[name="cor"]');
    const cor = chipCor ? chipCor.dataset.val : (inputCor ? inputCor.value.trim() : '');

    const obs = container.querySelector('input[name="obs"]')?.value?.trim() || '';

    if (modelo) url.searchParams.set('modelo', modelo); else url.searchParams.delete('modelo');
    if (tamanho) url.searchParams.set('tamanho', tamanho); else url.searchParams.delete('tamanho');
    if (cor) url.searchParams.set('cor', cor); else url.searchParams.delete('cor');
    if (obs) url.searchParams.set('obs', obs); else url.searchParams.delete('obs');

    btnComprar.href = url.pathname + url.search;
  }

  container.addEventListener('click', function(e) {
    const chip = e.target.closest('.chip-opt');
    if (!chip) return;
    const grupo = chip.dataset.var;
    if (chip.classList.contains('active')) {
      chip.classList.remove('active');
    } else {
      container.querySelectorAll(`.chip-opt[data-var="${grupo}"]`).forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    }
    atualizarLink();
  });

  container.addEventListener('input', function() {
    atualizarLink();
  });
})();
