// Compartilhado entre vitrine e painel: departamentos, ícones e formatação.
window.CIT = (() => {
  const ICON = {
    tec: '<rect x="8" y="14" width="48" height="30" rx="3"/><path d="M24 52h16M32 44v8"/>',
    cel: '<rect x="20" y="6" width="24" height="52" rx="5"/><path d="M29 50h6"/>',
    info: '<rect x="14" y="14" width="36" height="26" rx="2"/><path d="M6 48h52l-4 4H10z"/>',
    eletro: '<rect x="18" y="6" width="28" height="52" rx="4"/><path d="M18 26h28M24 14v6M24 32v8"/>',
    cozinha: '<rect x="12" y="26" width="40" height="24" rx="6"/><path d="M8 26h48M26 18h12M6 32h6M52 32h6"/>',
    casa: '<path d="M20 54h24M32 54V30M22 30h20l-6-16h-8z"/>',
    cama: '<rect x="14" y="12" width="36" height="40" rx="3"/><path d="M14 22h36M14 42h36"/>',
    moda: '<path d="M22 8l-12 8 6 10 6-4v32h20V22l6 4 6-10-12-8c-2 4-6 6-10 6s-8-2-10-6z"/>',
    calc: '<path d="M8 40c0-6 2-14 6-18l6 6c6 2 14 2 18 6l14 4c4 1 6 4 6 8v2H8z"/><path d="M8 44h50"/>',
    beleza: '<rect x="16" y="24" width="32" height="30" rx="6"/><rect x="26" y="12" width="12" height="12" rx="2"/><path d="M32 6v6"/>',
    brinq: '<circle cx="32" cy="36" r="16"/><circle cx="18" cy="18" r="6"/><circle cx="46" cy="18" r="6"/><circle cx="26" cy="34" r="1.5"/><circle cx="38" cy="34" r="1.5"/><path d="M28 42c2 2 6 2 8 0"/>',
    esporte: '<circle cx="16" cy="42" r="10"/><circle cx="48" cy="42" r="10"/><path d="M16 42l10-18h14l8 18M26 24l6 18 8-18M22 20h8"/>',
    ferr: '<path d="M8 18h34v14H8zM42 22h14M20 32l-4 22h10l2-22"/>',
    auto: '<path d="M8 40v-8l6-12h36l6 12v8z"/><circle cx="18" cy="42" r="5"/><circle cx="46" cy="42" r="5"/><path d="M14 30h36"/>',
    pets: '<circle cx="22" cy="20" r="5"/><circle cx="42" cy="20" r="5"/><circle cx="12" cy="32" r="4"/><circle cx="52" cy="32" r="4"/><path d="M32 30c-8 0-14 10-14 16 0 6 6 8 14 4 8 4 14 2 14-4 0-6-6-16-14-16z"/>',
    papel: '<path d="M14 50l4-12 28-28 8 8-28 28zM40 16l8 8"/>',
    bag: '<path d="M14 22h36l-3 34H17z"/><path d="M24 22v-4a8 8 0 0 1 16 0v4"/>',
    shop: '<path d="M8 26l4-14h40l4 14M8 26h48v28H8zM24 54V38h16v16"/>',
  };
  const DEPTS = [
    ['tec', 'Eletrônicos', '#3A7BD5'], ['cel', 'Celulares', '#008B87'], ['info', 'Informática', '#5A5FD8'], ['eletro', 'Eletrodomésticos', '#0F8FB0'],
    ['cozinha', 'Cozinha', '#E2622B'], ['casa', 'Casa e Decoração', '#1D9A6C'], ['cama', 'Cama, Mesa e Banho', '#7A62C9'], ['moda', 'Moda', '#D23C8C'],
    ['calc', 'Calçados', '#B5651D'], ['beleza', 'Beleza e Perfumaria', '#C2417A'], ['brinq', 'Brinquedos', '#E0A100'], ['esporte', 'Esporte e Lazer', '#2E9E3E'],
    ['ferr', 'Ferramentas', '#C0582A'], ['auto', 'Automotivo', '#4A6178'], ['pets', 'Pet Shop', '#B88A12'], ['papel', 'Papelaria', '#2D7FB8'],
  ];
  const D = Object.fromEntries(DEPTS.map(([k, n, h]) => [k, { n, h }]));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const svg = (k) => `<svg class="ic" viewBox="0 0 64 64" aria-hidden="true">${ICON[k] ?? ICON.bag}</svg>`;
  return { ICON, DEPTS, D, esc, brl, svg };
})();
