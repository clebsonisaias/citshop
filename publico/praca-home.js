// Praça de Alimentação na home: os restaurantes abertos primeiro, com atalho para a praça inteira.
// Sem restaurantes cadastrados, a faixa fica escondida.
(() => {
  const { esc, cartaoRestaurante } = window.CIT;
  fetch('/api/food/restaurantes')
    .then((r) => (r.ok ? r.json() : []))
    .then((lista) => {
      if (!Array.isArray(lista) || !lista.length) return;
      const ordem = [...lista].sort((a, b) => Number(b.aberto) - Number(a.aberto));
      const tipos = [...new Set(lista.map((r) => r.tipo))].sort();
      document.getElementById('hCozinhas').innerHTML = tipos.map((t) => `<a class="chip" href="/alimentacao">${esc(t)}</a>`).join('');
      document.getElementById('hRestaurantes').innerHTML = ordem.slice(0, 4).map(cartaoRestaurante).join('');
      document.getElementById('sPraca').hidden = false;
    })
    .catch(() => { /* a praça continua acessível pelo menu */ });
})();
