// Minha conta do cliente (servidor/conta.js): entrar, criar conta, nova senha pelo WhatsApp, pedidos, dados e endereços.
// Favoritos: os deste aparelho (favoritos.js) somam aos da conta ao entrar, e a conta passa a guardar todos.
(() => {
  const $ = (id) => document.getElementById(id);
  const { esc } = window.CIT;
  const brl = (n) => window.CIT.brl.format(Number(n) || 0);
  const api = async (metodo, caminho, corpo) => {
    const r = await fetch(`/api/conta/${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined }).catch(() => null);
    const d = await r?.json().catch(() => ({})) ?? {};
    return r?.ok ? d : { erro: d.erro || 'Não deu certo. Tente de novo.', status: r?.status };
  };
  const favLocais = () => { try { return JSON.parse(localStorage.getItem('cit-favoritos')) || []; } catch { return []; } };
  let eu = null;

  function mostrar(d) {
    eu = d;
    $('cFora').hidden = Boolean(d); $('cDentro').hidden = !d;
    if (!d) return;
    $('cOla').textContent = `Olá, ${d.nome.split(' ')[0]}`;
    $('cPedidos').innerHTML = d.pedidos.length ? `<ul class="conta-pedidos">${d.pedidos.map((p) => `<li>
        <span><b>${esc(p.loja)}${p.numero ? ` · pedido #${p.numero}` : ''}</b><small>${new Date(p.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(p.itens.join(', '))}</small></span>
        <span class="conta-ped-dir"><b>${p.total != null ? brl(p.total) : ''}</b><small>${esc(p.situacao)}</small>${p.acompanhar ? `<a href="${esc(p.acompanhar)}">Acompanhar</a>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="note">Os pedidos que você fizer com a conta aberta aparecem aqui.</p>';
    const f = $('cDados'); f.nome.value = d.nome; f.whatsapp.value = d.whatsapp.replace(/^55/, ''); $('cEmail').textContent = `E-mail: ${d.email}`;
    desenharEnderecos(d.enderecos);
    $('cFav').textContent = d.favoritos.length ? `${d.favoritos.length} favorito(s) guardados na sua conta.` : '';
  }
  function desenharEnderecos(lista) {
    $('cEndLista').innerHTML = lista.map((e) => `<div class="conta-end" data-id="${esc(e.id)}">
      <label class="food-campo">Nome<input data-nome value="${esc(e.nome)}" maxlength="30" placeholder="Casa"></label>
      <label class="food-campo">Endereço (rua, número, bairro)<input data-texto value="${esc(e.texto)}" maxlength="200" autocomplete="street-address"></label>
      <button type="button" class="btn perigo" data-tirar-end>Remover</button></div>`).join('');
  }
  const lerEnderecos = () => [...document.querySelectorAll('.conta-end')].map((el) => ({ id: el.dataset.id, nome: el.querySelector('[data-nome]').value, texto: el.querySelector('[data-texto]').value }));
  // Ao entrar: os favoritos deste aparelho passam para a conta (e a conta devolve os dela para o aparelho).
  async function juntarFavoritos(d) {
    const todos = [...new Set([...d.favoritos, ...favLocais()])];
    try { localStorage.setItem('cit-favoritos', JSON.stringify(todos)); } catch { /* modo privado */ }
    return todos.length !== d.favoritos.length ? api('PUT', 'eu', { favoritos: todos }) : d;
  }
  const entrou = async (d) => mostrar(d.erro ? d : await juntarFavoritos(d));
  const erroNo = (form, msg) => { form.querySelector('.food-erro').textContent = msg || ''; };
  const aviso = (form, msg) => { form.querySelector('p[aria-live]').textContent = msg; };

  $('cEntrar').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const d = await api('POST', 'entrar', { email: f.email.value, senha: f.senha.value });
    if (d.erro) return erroNo(f, d.erro);
    entrou(d);
  });
  $('cCriar').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const d = await api('POST', 'cadastro', { nome: f.nome.value, email: f.email.value, whatsapp: f.whatsapp.value, senha: f.senha.value, aceite: f.aceite.checked, favoritos: favLocais() });
    if (d.erro) return erroNo(f, d.erro);
    mostrar(d);
  });
  $('cAbrirEsqueci').addEventListener('click', () => { $('cEsqueci').hidden = false; $('cEsqueci').email.value = $('cEntrar').email.value; $('cEsqueci').scrollIntoView({ behavior: 'smooth' }); });
  $('cPedirCodigo').addEventListener('click', async () => {
    const f = $('cEsqueci'), d = await api('POST', 'esqueci', { email: f.email.value });
    erroNo(f, d.erro); $('cEsqueciMsg').textContent = d.mensagem || '';
  });
  $('cEsqueci').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const d = await api('POST', 'redefinir', { email: f.email.value, codigo: f.codigo.value.trim(), senha: f.senha.value });
    if (d.erro) return erroNo(f, d.erro);
    entrou(d);
  });
  $('cSair').addEventListener('click', async () => { await api('POST', 'sair'); mostrar(null); });
  $('cDados').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const d = await api('PUT', 'eu', { nome: f.nome.value, whatsapp: f.whatsapp.value });
    if (d.erro) return aviso(f, d.erro);
    mostrar(d); aviso($('cDados'), 'Dados salvos.');
  });
  $('cMaisEnd').addEventListener('click', () => {
    const lista = lerEnderecos(); if (lista.length >= 5) return;
    desenharEnderecos([...lista, { id: '', nome: lista.length ? '' : 'Casa', texto: '' }]);
    document.querySelector('.conta-end:last-child [data-texto]').focus();
  });
  $('cEndLista').addEventListener('click', (e) => { if (e.target.closest('[data-tirar-end]')) e.target.closest('.conta-end').remove(); });
  $('cEnderecos').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = await api('PUT', 'eu', { enderecos: lerEnderecos() });
    if (d.erro) return aviso(ev.target, d.erro);
    mostrar(d); aviso($('cEnderecos'), d.enderecos.length ? 'Endereços salvos.' : 'Nenhum endereço salvo (confira se tem rua, número e bairro).');
  });
  $('cSenha').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const d = await api('PUT', 'senha', { atual: f.atual.value, nova: f.nova.value });
    aviso(f, d.erro || 'Senha trocada. As outras sessões foram encerradas.'); if (!d.erro) f.reset();
  });

  api('GET', 'eu').then((d) => mostrar(d.erro ? null : d));
})();
