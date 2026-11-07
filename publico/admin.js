// Administração: lista de lojas, suspender/reativar, senha provisória e ocultar produto.
(() => {
  const { esc, brl } = window.CIT;
  const $ = (id) => document.getElementById(id);
  const ROTULO = { teste: 'Teste grátis', ativa: 'Pagante', vencida: 'Vencida', suspensa: 'Suspensa' };
  let lojas = [];

  async function api(url, metodo = 'GET', json) {
    const r = await fetch(url, { method: metodo, headers: json ? { 'Content-Type': 'application/json' } : undefined, body: json ? JSON.stringify(json) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erro ?? 'Falhou.'), { status: r.status });
    return d;
  }
  const data = (iso) => new Date(iso).toLocaleDateString('pt-BR');

  function render() {
    const conta = (s) => lojas.filter((l) => l.status === s).length;
    $('resumo').textContent = `${lojas.length} lojas · ${conta('ativa')} pagantes · ${conta('teste')} em teste · ${conta('vencida')} vencidas · ${conta('suspensa')} suspensas`;
    $('linhas').innerHTML = lojas.map((l) => `<tr>
      <td><b>${esc(l.nome)}</b><br><small class="note">${esc(l.cidade)} · desde ${data(l.criadaEm)}</small><br><a href="/loja/${esc(l.slug)}" target="_blank">ver página</a></td>
      <td>${esc(l.responsavel)}<br>${esc(l.email)}<br><a href="https://wa.me/${esc(l.whatsapp)}" target="_blank" rel="noopener">${esc(l.whatsapp)}</a></td>
      <td><span class="pill ${l.status}">${ROTULO[l.status]}</span><br><small class="note">teste até ${data(l.testeAte)}<br>MP: ${esc(l.assinatura?.status ?? 'nenhuma')}</small></td>
      <td>${l.produtos.map((p) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
          <img src="${esc(p.foto)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px">
          <span style="flex:1">${esc(p.nome)} · ${brl.format(p.preco)}${p.ativo ? '' : ' (pausado)'}</span>
          <button class="btn sec" style="min-height:32px;padding:4px 8px;font-size:11px" data-bloq="${p.id}" data-v="${!p.bloqueado}">${p.bloqueado ? 'Mostrar' : 'Ocultar'}</button></div>`).join('') || '<small class="note">nenhum</small>'}</td>
      <td style="display:grid;gap:6px">
        <button class="btn sec" data-susp="${l.id}" data-v="${!l.suspensa}">${l.suspensa ? 'Reativar' : 'Suspender'}</button>
        <button class="btn sec" data-senha="${l.id}">Senha provisória</button></td></tr>`).join('');
  }
  async function carregar() { lojas = await api('/api/admin/lojas'); render(); }

  $('linhas').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.susp) await api(`/api/admin/lojas/${b.dataset.susp}/suspensa`, 'POST', { suspensa: b.dataset.v === 'true' });
      if (b.dataset.bloq) await api(`/api/admin/produtos/${b.dataset.bloq}/bloqueado`, 'POST', { bloqueado: b.dataset.v === 'true' });
      if (b.dataset.senha) {
        const loja = lojas.find((l) => l.id === b.dataset.senha);
        if (!confirm(`Gerar uma senha provisória para ${loja.nome}? A senha atual deixa de funcionar.`)) return;
        const { senha } = await api(`/api/admin/lojas/${b.dataset.senha}/senha`, 'POST');
        $('aviso').hidden = false;
        $('aviso').textContent = `Senha provisória de ${loja.nome}: ${senha} (envie para a loja e peça que troque no painel).`;
      }
      await carregar();
    } catch (err) { alert(err.message); }
  });
  $('fEnt').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/admin/entrar', 'POST', { senha: e.target.senha.value }); iniciar(); }
    catch (err) { $('eEnt').hidden = false; $('eEnt').textContent = err.message; }
  });
  $('sair').onclick = async () => { await api('/api/admin/sair', 'POST').catch(() => {}); location.reload(); };

  function iniciar() {
    carregar().then(() => { $('fEnt').hidden = true; $('vAdm').hidden = false; $('sair').hidden = false; })
      .catch(() => { $('fEnt').hidden = false; });
  }
  iniciar();
})();
