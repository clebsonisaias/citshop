// Favoritos guardados só neste aparelho (localStorage): botões data-favorito="<id>" salvam ou removem.
// A home usa a lista na contagem para a próxima data dupla. Arquivo externo por causa da CSP.
(() => {
  const CHAVE = 'cit-favoritos';
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; } };
  const gravar = (l) => { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch { /* modo privado: só nesta visita */ } };
  const pintar = (b) => {
    const salvo = ler().includes(b.dataset.favorito);
    b.setAttribute('aria-pressed', String(salvo));
    b.querySelector('span').textContent = salvo ? 'Salvo nos favoritos' : 'Salvar nos favoritos';
  };
  window.CITFavoritos = { ler, pintar: () => document.querySelectorAll('[data-favorito]').forEach(pintar) };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-favorito]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.favorito, l = ler();
    gravar(l.includes(id) ? l.filter((x) => x !== id) : [...l, id]);
    pintar(b);
    document.dispatchEvent(new CustomEvent('favoritos'));
  });
  window.CITFavoritos.pintar();
})();
