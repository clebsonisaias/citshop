// Administração em abas: lojas (suspender/reativar, senha provisória, ocultar produto), convites, cupons, afiliados, canais e conta.
(() => {
  const { esc, brl } = window.CIT;
  const $ = (id) => document.getElementById(id);
  const ROTULO = { teste: 'Teste grátis', ativa: 'Assinante', vencida: 'Vencida', suspensa: 'Suspensa', parceira: 'Parceira (R$ 1/venda)' };
  const DISPONIBILIDADE = { disponivel: 'Disponível', 'sob-encomenda': 'Sob encomenda', consulte: 'Consultar disponibilidade' };
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
    $('resumo').textContent = `${lojas.length} lojas · ${conta('parceira')} parceiras · ${conta('ativa')} pagantes · ${conta('teste')} em teste · ${conta('vencida')} vencidas · ${conta('suspensa')} suspensas`;
    // Filtro por situação e busca (nome, cidade, e-mail, WhatsApp).
    const sit = $('fStatusLoja').value, q = $('fBuscaLoja').value.trim().toLowerCase();
    const vis = lojas.filter((l) => (!sit || (sit === 'fundadora' ? l.beneficio && !l.beneficio.encerradoEm : l.status === sit))
      && (!q || [l.nome, l.cidade, l.email, l.whatsapp, l.slug].some((v) => String(v ?? '').toLowerCase().includes(q))));
    $('linhas').innerHTML = vis.length ? vis.map((l) => `<tr>
      <td><b>${esc(l.nome)}</b><br><small class="note">${esc(l.cidade)} · desde ${data(l.criadaEm)}</small><br><a href="/${esc(l.slug)}" target="_blank">ver página /${esc(l.slug)}</a></td>
      <td>${esc(l.responsavel)}<br>${esc(l.email)}<br><a href="https://wa.me/${esc(l.whatsapp)}" target="_blank" rel="noopener">${esc(l.whatsapp)}</a></td>
      <td><span class="pill ${l.status}">${ROTULO[l.status] || esc(l.status)}</span><br><small class="note">${l.modeloCobranca === 'comissao_fixa' ? 'Cobrança: R$ ' + (l.comissaoPorVenda || 1).toFixed(2) + ' por venda (Split MP)' : `Cobrança: mensalidade${l.plano?.precoContratado ? ' ' + brl.format(l.plano.precoContratado) : ''}${l.beneficio ? ` · ${esc(l.beneficio.codigo)}${l.beneficio.encerradoEm ? ' (encerrado)' : ''}` : ''}`}<br>teste até ${data(l.testeAte)}<br>MP: ${esc(l.assinatura?.status ?? 'nenhuma')}<br>${l.cliquesContatoLoja ?? 0} cliques no WhatsApp<br>${l.pedidos?.total ?? 0} pedidos (${l.pedidos?.pagos ?? 0} pagos no site, ${l.pedidos?.whatsapp ?? 0} pelo WhatsApp)${l.mpConectado ? '<br>Mercado Pago conectado' : ''}</small></td>
      <td>${l.produtos.length ? `<details><summary>${l.produtos.length} ${l.produtos.length === 1 ? 'produto' : 'produtos'}</summary>` : ''}${l.produtos.map((p) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
          <img src="${esc(p.foto)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px">
          <span style="flex:1">${esc(p.nome)} · ${brl.format(p.preco)}<br><small class="note">${esc(DISPONIBILIDADE[p.disponibilidade] ?? DISPONIBILIDADE.consulte)} · ${p.cliquesContato ?? 0} cliques WhatsApp${p.ativo ? '' : ' · pausado'}</small></span>
          <button class="btn sec" style="min-height:40px;padding:4px 10px;font-size:12px" data-bloq="${p.id}" data-v="${!p.bloqueado}">${p.bloqueado ? 'Mostrar' : 'Ocultar'}</button></div>`).join('') || '<small class="note">nenhum</small>'}${l.produtos.length ? '</details>' : ''}</td>
      <td class="acoes-loja">
        <button class="btn sec" data-modelo="${l.id}" data-atual="${l.modeloCobranca || 'mensalidade'}">${l.modeloCobranca === 'comissao_fixa' ? 'Mudar p/ Mensalidade' : 'Mudar p/ Parceira (R$ 1/venda)'}</button>
        <button class="btn sec" data-susp="${l.id}" data-v="${!l.suspensa}">${l.suspensa ? 'Reativar' : 'Suspender'}</button>
        <button class="btn sec" data-senha="${l.id}">Senha provisória</button>
        <button class="btn sec" data-acesso="${l.id}">Definir acesso</button>
        <button class="btn perigo" data-excluir="${l.id}">Excluir loja</button></td></tr>`).join('') : '<tr><td colspan="5" class="note">Nenhuma loja com esse filtro.</td></tr>';
  }
  async function carregar() { lojas = await api('/api/admin/lojas'); render(); carregarCupons(); carregarConvites(); carregarComercial(); carregarDashboard(); carregarFinanceiro(); carregarAvaliacoes(); carregarFood(); carregarCanais(); }
  ['fStatusLoja', 'fBuscaLoja'].forEach((id) => $(id).addEventListener('input', render));
  // ---------- visão geral (dados reais) ----------
  const cartao = (rotulo, valor, sub = '') => `<div class="cartao"><span>${esc(rotulo)}</span><b>${valor}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  async function carregarDashboard() {
    const d = await api('/api/admin/dashboard').catch(() => null);
    if (!d) return;
    const L = d.lojas, m = d.receitaMes;
    $('dash').innerHTML = `
      <h2 class="sub-adm">Receita do CITshop</h2>
      <div class="cartoes">${cartao('MRR (mensalidades ativas)', brl.format(d.mrr), `${L.ativas} assinantes`)}${cartao('Recebido no mês', brl.format(m.liquido), 'mensalidades + comissões − estornos')}${cartao('Mensalidades no mês', brl.format(m.mensalidade))}${cartao('Comissões no mês', brl.format(m.comissao), `estornos ${brl.format(m.reembolso + m.chargeback)}`)}</div>
      <h2 class="sub-adm">Lojas</h2>
      <div class="cartoes">${cartao('Cadastradas', L.total)}${cartao('Assinantes', L.ativas)}${cartao('Em teste', L.teste)}${cartao('Fundadoras', L.fundadoras)}${cartao('Parceiras', L.parceiras)}${cartao('Vencidas', L.vencidas, `${L.pausadas} com pagamento em atraso`)}${cartao('Canceladas', L.canceladas)}${cartao('Suspensas', L.suspensas)}</div>
      <h2 class="sub-adm">Pedidos e catálogo (30 dias)</h2>
      <div class="cartoes">${cartao('Pedidos', d.pedidos30.total)}${cartao('Vendas concluídas', d.pedidos30.aprovados, `${brl.format(d.pedidos30.vendasLojas)} vendidos pelas lojas`)}${cartao('Reembolsos', d.pedidos30.reembolsados)}${cartao('Produtos ativos', d.produtos.ativos, `${d.produtos.semEstoque} sem estoque`)}${cartao('Teste → assinatura', d.conversaoTeste.percentual == null ? '—' : `${d.conversaoTeste.percentual}%`, `${d.conversaoTeste.assinaram} de ${d.conversaoTeste.base} lojas com teste encerrado`)}</div>`;
  }
  // ---------- financeiro: livro de lançamentos ----------
  const TIPO_LANC = { mensalidade: 'Mensalidade', comissao: 'Comissão', reembolso: 'Reembolso', chargeback: 'Chargeback', ajuste: 'Ajuste', afiliado: 'Afiliado' };
  async function carregarFinanceiro() {
    const sel = $('fLojaLanc'), atual = sel.value;
    sel.innerHTML = '<option value="">Todas</option>' + lojas.map((l) => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join('');
    sel.value = atual;
    const q = new URLSearchParams({ ...($('fTipoLanc').value && { tipo: $('fTipoLanc').value }), ...(sel.value && { lojaId: sel.value }) });
    const f = await api(`/api/admin/financeiro?${q}`).catch(() => null);
    if (!f) return;
    const r = f.resumo;
    $('resumoLivro').innerHTML = cartao('Líquido', brl.format(r.liquido), `${f.total} lançamentos`) + cartao('Mensalidades', brl.format(r.mensalidade)) + cartao('Comissões', brl.format(r.comissao)) + cartao('Estornos', brl.format(r.reembolso + r.chargeback));
    $('linhasLivro').innerHTML = f.lancamentos.length ? f.lancamentos.map((l) => `<tr><td>${new Date(l.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(TIPO_LANC[l.tipo] ?? l.tipo)}</td><td>${esc(l.lojaNome ?? '—')}</td><td>${esc(l.pedidoId ?? l.referencia ?? '—')}</td><td class="${l.valor < 0 ? 'neg' : ''}">${brl.format(l.valor)}</td></tr>`).join('') : '<tr><td colspan="5" class="note">Nenhum lançamento ainda.</td></tr>';
  }
  ['fTipoLanc', 'fLojaLanc'].forEach((id) => $(id).addEventListener('change', carregarFinanceiro));
  // ---------- planos e cupons de assinatura ----------
  const dataIso = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' }); // AAAA-MM-DD para o campo de data
  const fimDoDia = (d) => `${d}T23:59:59-03:00`;
  async function carregarComercial() {
    const c = await api('/api/admin/comercial').catch(() => null);
    if (!c) return;
    $('fPrecoPlano').precoMensal.value = Number(c.precoMensal).toFixed(2).replace('.', ',');
    $('fPrecoPlano').precoFood.value = Number(c.precoFood ?? 299.9).toFixed(2).replace('.', ',');
    $('listaCuponsPlano').innerHTML = c.cupons.length ? c.cupons.map((x) => `<div class="item-adm">
        <div><b>${esc(x.codigo)}</b> · ${x.percentual}% · ${x.valendo ? '<span class="pill ativa">valendo</span>' : '<span class="pill vencida">fora do período</span>'}
          <br><small class="note">${x.usos} ${x.usos === 1 ? 'loja usou' : 'lojas usaram'}${x.limite ? ` de ${x.limite}` : ''} · começou em ${data(x.inicio)}</small></div>
        <label>Termina em<input type="date" value="${dataIso(x.fim)}" data-fim-cupom="${esc(x.codigo)}"></label>
        <button class="btn sec" type="button" data-ativo-cupom="${esc(x.codigo)}" data-v="${!x.ativo}">${x.ativo ? 'Desativar' : 'Ativar'}</button>
      </div>`).join('') : '<p class="note">Nenhum cupom de assinatura.</p>';
    $('listaBeneficiarios').innerHTML = c.beneficiarios.length ? c.beneficiarios.map((x) => `<div class="item-adm"><div><b>${esc(x.nome)}</b> · ${esc(x.codigo)} (${x.percentual}%)
        <br><small class="note">${x.cnpj ? `CNPJ ${esc(x.cnpj)} · ` : ''}WhatsApp ${esc(x.whatsapp)} · aplicado em ${data(x.aplicadoEm)} · assinatura: ${esc(x.assinatura)}${x.precoContratado ? ` · ${brl.format(x.precoContratado)}/mês` : ''}${x.encerradoEm ? ` · <b>encerrado em ${data(x.encerradoEm)}</b>` : ''}</small></div></div>`).join('') : '<p class="note">Nenhuma loja com benefício ainda.</p>';
    const aud = await api('/api/admin/auditoria').catch(() => []);
    $('listaAuditoria').innerHTML = aud.length ? aud.slice(0, 40).map((x) => `<p class="note">${new Date(x.em).toLocaleString('pt-BR')} · <b>${esc(x.acao)}</b> ${esc(JSON.stringify(x.detalhe))}</p>`).join('') : '<p class="note">Nada registrado ainda.</p>';
  }
  $('fPrecoPlano').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('mPrecoPlano'), num = (v) => Number(String(v).replace(/\./g, '').replace(',', '.'));
    const valor = num(e.target.precoMensal.value), food = num(e.target.precoFood.value);
    if (!confirm(`Plano Loja ${brl.format(valor)} e FOOD PRO ${brl.format(food)}? Quem já assina continua com o preço contratado.`)) return;
    try { await api('/api/admin/comercial/preco', 'PUT', { precoMensal: valor }); await api('/api/admin/comercial/preco', 'PUT', { precoFood: food }); m.className = 'msg ok'; m.textContent = 'Preço salvo. Vale para novas assinaturas.'; m.hidden = false; carregarComercial(); }
    catch (err) { m.className = 'msg'; m.textContent = err.message; m.hidden = false; }
  });
  $('fNovoCupomPlano').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, m = $('mNovoCupomPlano');
    try {
      await api('/api/admin/comercial/cupons', 'POST', { codigo: f.codigo.value, percentual: f.percentual.value, inicio: `${f.inicio.value}T00:00:00-03:00`, fim: fimDoDia(f.fim.value), limite: f.limite.value, segmento: f.segmento.value });
      f.reset(); m.className = 'msg ok'; m.textContent = 'Cupom criado.'; m.hidden = false; carregarComercial();
    } catch (err) { m.className = 'msg'; m.textContent = err.message; m.hidden = false; }
  });
  $('listaCuponsPlano').addEventListener('change', async (e) => {
    const campo = e.target.closest('[data-fim-cupom]');
    if (!campo || !campo.value) return;
    try { await api(`/api/admin/comercial/cupons/${encodeURIComponent(campo.dataset.fimCupom)}`, 'PATCH', { fim: fimDoDia(campo.value) }); carregarComercial(); }
    catch (err) { alert(err.message); }
  });
  $('listaCuponsPlano').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ativo-cupom]');
    if (!b) return;
    try { await api(`/api/admin/comercial/cupons/${encodeURIComponent(b.dataset.ativoCupom)}`, 'PATCH', { ativo: b.dataset.v === 'true' }); carregarComercial(); }
    catch (err) { alert(err.message); }
  });
  // Convites de parceria: o link só aparece enquanto o convite está aberto.
  const STATUS_CONVITE = { aberto: 'Aberto', usado: 'Usado', expirado: 'Expirado', cancelado: 'Cancelado' };
  async function carregarConvites() {
    const convites = await api('/api/admin/convites').catch(() => []);
    $('listaConvitesAdm').innerHTML = convites.length ? convites.map((c) => `<p class="note"><b>${esc(STATUS_CONVITE[c.status] ?? c.status)}</b> · ${esc(c.predefinicao ?? 'Em branco')}${c.email ? ` · ${esc(c.email)}` : ''} · criado em ${data(c.criadoEm)}${c.status === 'aberto' ? ` · vale até ${data(c.expiraEm)}` : ''}${c.lojaNome ? ` · usado por <b>${esc(c.lojaNome)}</b>` : ''}
      ${c.link ? `<br><input readonly value="${esc(c.link)}" aria-label="Link do convite" style="width:100%;max-width:520px"> <button class="btn sec" type="button" data-copiar-conv="${esc(c.link)}">Copiar link</button> <button class="btn perigo" type="button" data-cancelar-conv="${esc(c.id)}">Cancelar</button>` : ''}</p>`).join('') : '<p class="note">Nenhum convite gerado.</p>';
  }
  $('fConviteAdm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('mConviteAdm');
    try {
      await api('/api/admin/convites', 'POST', Object.fromEntries(new FormData(e.target)));
      e.target.reset(); msg.className = 'msg ok'; msg.textContent = 'Convite gerado. Copie o link abaixo e envie para a loja.'; msg.hidden = false; carregarConvites();
    } catch (err) { msg.className = 'msg'; msg.textContent = err.message; msg.hidden = false; }
  });
  $('listaConvitesAdm').addEventListener('click', async (e) => {
    const copiar = e.target.closest('[data-copiar-conv]'), cancelar = e.target.closest('[data-cancelar-conv]');
    if (copiar) {
      try { await navigator.clipboard.writeText(copiar.dataset.copiarConv); copiar.textContent = 'Copiado!'; }
      catch { copiar.previousElementSibling.select(); copiar.textContent = 'Selecionado: copie com Ctrl+C'; }
      return;
    }
    if (!cancelar || !confirm('Cancelar este convite? O link deixa de funcionar.')) return;
    await api(`/api/admin/convites/${encodeURIComponent(cancelar.dataset.cancelarConv)}`, 'DELETE').catch((err) => alert(err.message));
    carregarConvites();
  });
  const NOME_CANAL = { site: 'Site (vitrine)', produto: 'Página do produto', whatsapp: 'WhatsApp (Radar)', telegram: 'Telegram', instagram: 'Instagram', bio: 'Link da bio', outros: 'Outros', sem_canal: 'Sem canal (links antigos ou diretos)' };
  async function carregarCanais() {
    const d = await api(`/api/admin/afiliados/canais?dias=${$('canalPeriodo').value}`).catch((e) => ({ erro: e.message, cliques: {}, vendas: {}, confirmadaNoLivro: {} }));
    const canais = [...new Set([...Object.keys(NOME_CANAL), ...Object.keys(d.cliques), ...Object.keys(d.vendas)])]
      .filter((c) => d.cliques[c] || d.vendas[c] || ['site', 'produto', 'whatsapp', 'telegram'].includes(c));
    $('canalLinhas').innerHTML = canais.map((c) => {
      const cl = d.cliques[c], v = d.vendas[c] ?? {};
      return `<tr><td>${esc(NOME_CANAL[c] ?? c)}</td><td>${cl?.total ?? 0}${cl ? ` <small>(${Object.entries(cl.porLoja).map(([l, n]) => `${esc(l)} ${n}`).join(', ')})</small>` : ''}</td><td>${v.pedidos ?? 0}${v.cancelados ? ` <small>(${v.cancelados} cancelados)</small>` : ''}</td><td>${brl.format(v.estimada ?? 0)}</td><td>${brl.format(v.confirmada ?? 0)}</td></tr>`;
    }).join('');
    $('canalStatus').textContent = d.erro ? `Vendas: ${d.erro} Os cliques continuam sendo contados.` : `No Financeiro (comissão de afiliado confirmada no período): ${brl.format(d.totalNoLivro ?? 0)}.`;
  }
  $('canalPeriodo').addEventListener('change', carregarCanais);
  async function carregarFood() {
    const d = await api('/api/admin/food').catch(() => null);
    if (!d) return;
    const PAPEL = { cozinha: 'Cozinha', atendente: 'Atendimento', impressora: 'Impressora' };
    $('foodRest').innerHTML = d.restaurantes.length ? d.restaurantes.map((r) => `<div class="item-adm"><p><b>${esc(r.nome)}</b> · ${esc(r.situacao)} · ${r.itens} itens · ${r.pedidos} pedidos${r.suspensa ? ' · <b>suspenso</b>' : ''} · <a href="/alimentacao/${esc(r.slug)}" target="_blank" rel="noopener">ver</a></p></div>`).join('') : '<p class="note">Nenhum restaurante cadastrado.</p>';
    $('foodAcessos').innerHTML = d.acessos.length ? d.acessos.map((a) => `<div class="item-adm"><p><b>${esc(PAPEL[a.papel])}</b> · ${esc(a.lojaNome)} · ${esc(a.nome)}${a.dispositivo?.impressora ? ` · ${esc(a.dispositivo.impressora)}` : ''}${a.vistoEm ? ` · visto ${new Date(a.vistoEm).toLocaleString('pt-BR')}` : ''}</p><button class="btn sec" type="button" data-revogar-food="${esc(a.id)}">Revogar</button></div>`).join('') : '<p class="note">Nenhum aparelho vinculado.</p>';
    $('foodFalhas').innerHTML = d.falhasImpressao.length ? d.falhasImpressao.map((j) => `<p class="note">${new Date(j.criadoEm).toLocaleString('pt-BR')} · ${esc(j.erro)} · ${j.tentativas} tentativas</p>`).join('') : '<p class="note">Nenhuma falha.</p>';
  }
  $('foodAcessos').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-revogar-food]');
    if (!b || !confirm('Revogar este aparelho? Ele perde o acesso na hora.')) return;
    await api(`/api/admin/food/acessos/${encodeURIComponent(b.dataset.revogarFood)}`, 'DELETE').catch(() => {});
    carregarFood();
  });
  async function carregarAvaliacoes() {
    const l = await api('/api/admin/avaliacoes').catch(() => []);
    $('listaAvaliacoes').innerHTML = l.length ? l.map((a) => `<div class="item-adm"><p><b>${'★'.repeat(a.nota)}</b> ${esc(a.nome)} · ${esc(a.lojaNome)} · ${new Date(a.em).toLocaleDateString('pt-BR')}${a.oculta ? ' · <b>oculta</b>' : ''}</p>
      ${a.texto ? `<p class="note">${esc(a.texto)}</p>` : ''}<button class="btn sec" type="button" data-avaliacao="${esc(a.id)}" data-oculta="${a.oculta ? '' : '1'}">${a.oculta ? 'Mostrar' : 'Ocultar'}</button></div>`).join('') : '<p class="note">Nenhuma avaliação ainda.</p>';
  }
  $('listaAvaliacoes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-avaliacao]');
    if (!b) return;
    await api(`/api/admin/avaliacoes/${encodeURIComponent(b.dataset.avaliacao)}`, 'PATCH', { oculta: Boolean(b.dataset.oculta) }).catch(() => {});
    carregarAvaliacoes();
  });
  async function carregarCupons() {
    const cupons = await api('/api/admin/cupons').catch(() => []);
    $('listaCuponsAdm').innerHTML = cupons.length ? cupons.map((c) => `<p class="note"><b>${esc(c.codigo)}</b> · ${esc(c.lojaNome)} · ${esc(c.descricao)} · até ${new Date(`${c.validoAte}T12:00:00`).toLocaleDateString('pt-BR')} <button class="btn sec" type="button" data-apagar-cupom="${esc(c.id)}">Apagar</button></p>`).join('') : '<p class="note">Nenhum cupom cadastrado.</p>';
  }
  $('fCupomAdm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('mCupomAdm');
    try {
      await api('/api/admin/cupons', 'POST', Object.fromEntries(new FormData(e.target)));
      e.target.reset(); msg.className = 'msg ok'; msg.textContent = 'Cupom publicado.'; msg.hidden = false; carregarCupons();
    } catch (err) { msg.className = 'msg'; msg.textContent = err.message; msg.hidden = false; }
  });
  $('listaCuponsAdm').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-apagar-cupom]');
    if (!b || !confirm('Apagar este cupom?')) return;
    await api(`/api/admin/cupons/${encodeURIComponent(b.dataset.apagarCupom)}`, 'DELETE').catch(() => {});
    carregarCupons();
  });

  $('linhas').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.modelo) {
        const novo = b.dataset.atual === 'comissao_fixa' ? 'mensalidade' : 'comissao_fixa';
        await api(`/api/admin/lojas/${b.dataset.modelo}/modelo-cobranca`, 'PUT', { modeloCobranca: novo, comissaoPorVenda: 1.00 });
      }
      if (b.dataset.susp) await api(`/api/admin/lojas/${b.dataset.susp}/suspensa`, 'POST', { suspensa: b.dataset.v === 'true' });
      if (b.dataset.bloq) await api(`/api/admin/produtos/${b.dataset.bloq}/bloqueado`, 'POST', { bloqueado: b.dataset.v === 'true' });
      if (b.dataset.excluir) {
        const loja = lojas.find((l) => l.id === b.dataset.excluir);
        if (!confirm(`Excluir ${loja.nome} com todos os produtos e fotos? Isso não pode ser desfeito.`)) return;
        await api(`/api/admin/lojas/${loja.id}`, 'DELETE');
      }
      if (b.dataset.acesso) {
        const loja = lojas.find((l) => l.id === b.dataset.acesso);
        const email = prompt(`E-mail de acesso de ${loja.nome}:`, loja.email ?? '');
        if (!email) return;
        const senha = prompt('Senha provisória (mínimo 8 caracteres). No primeiro acesso a loja é obrigada a trocar:');
        if (!senha) return;
        await api(`/api/admin/lojas/${loja.id}/acesso`, 'PUT', { email, senha });
        $('aviso').hidden = false;
        $('aviso').textContent = `Acesso de ${loja.nome} definido: ${email.trim().toLowerCase()}. No primeiro login a loja precisa escolher uma senha nova.`;
      }
      if (b.dataset.senha) {
        const loja = lojas.find((l) => l.id === b.dataset.senha);
        if (!confirm(`Gerar uma senha provisória para ${loja.nome}? A senha atual deixa de funcionar.`)) return;
        const { senha } = await api(`/api/admin/lojas/${b.dataset.senha}/senha`, 'POST');
        $('aviso').hidden = false;
        $('aviso').textContent = `Senha provisória de ${loja.nome}: ${senha} (envie para a loja: no primeiro login ela será obrigada a escolher uma senha nova).`;
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

  // Central de Ofertas: status consolidado, métricas de cliques, configuração e desativados
  async function carregarCentralOfertas() {
    try {
      const s = await api('/api/admin/central-ofertas');
      const ult = s.ultimaExecucao ? new Date(s.ultimaExecucao).toLocaleString('pt-BR') : 'nunca';
      $('centralStatus').textContent = `Última execução: ${ult} · ${s.totalPublicados || 0} produtos ativos na vitrine · ${s.totalDesativados || 0} desativados/rejeitados`;

      const porLoja = s.porMarketplace || {};
      $('listaPorLoja').innerHTML = `
        <li>Amazon: <b>${porLoja.amazon || 0}</b> ofertas</li>
        <li>Shopee: <b>${porLoja.shopee || 0}</b> ofertas</li>
        <li>Mercado Livre: <b>${porLoja['mercado-livre'] || 0}</b> ofertas</li>
        <li>SHEIN: <b>${porLoja.shein || 0}</b> ofertas</li>
      `;

      const met = s.metricas || {};
      const clq = met.cliquesPorMarketplace || {};
      $('metricasCliques').innerHTML = `
        Total de cliques: <b>${met.totalCliques || 0}</b><br>
        <small class="note">Amazon: ${clq.amazon || 0} · Shopee: ${clq.shopee || 0} · Mercado Livre: ${clq['mercado-livre'] || 0} · SHEIN: ${clq.shein || 0}</small>
      `;

      const cfg = s.configuracao || {};
      $('cfgLimitePorCat').value = cfg.limitePorCategoria || 12;
      $('cfgLimiteTotal').value = cfg.limiteTotal || 180;
      $('cfgTermosAmazon').value = (cfg.termosPorMarketplace?.amazon || []).join(', ');
      $('cfgTermosShopee').value = (cfg.termosPorMarketplace?.shopee || []).join(', ');
      $('cfgTermosML').value = (cfg.termosPorMarketplace?.['mercado-livre'] || []).join(', ');
      if ($('cfgTermosShein')) $('cfgTermosShein').value = (cfg.termosPorMarketplace?.shein || []).join(', ');

      const desat = s.desativadosRecentes || [];
      if (!desat.length) {
        $('listaDesativados').innerHTML = '<p class="note">Nenhum produto desativado recentemente.</p>';
      } else {
        $('listaDesativados').innerHTML = desat.map((d) => `
          <div style="border-bottom:1px solid #eee;padding:4px 0">
            <b>[${esc(d.loja)}] ${esc(d.nome || d.id)}</b><br>
            <span style="color:#d9534f">Motivo: ${esc(d.motivos?.join(', '))}</span>
          </div>
        `).join('');
      }
    } catch (err) {
      $('centralStatus').textContent = `Falha ao carregar central: ${err.message}`;
    }
  }

  $('btnSalvarConfig').onclick = async () => {
    $('centralAviso').hidden = true;
    $('centralErro').hidden = true;
    try {
      const parseTermos = (v) => v.split(',').map((t) => t.trim()).filter(Boolean);
      const payload = {
        limitePorCategoria: Number($('cfgLimitePorCat').value) || 12,
        limiteTotal: Number($('cfgLimiteTotal').value) || 180,
        termosPorMarketplace: {
          amazon: parseTermos($('cfgTermosAmazon').value),
          shopee: parseTermos($('cfgTermosShopee').value),
          'mercado-livre': parseTermos($('cfgTermosML').value),
          shein: $('cfgTermosShein') ? parseTermos($('cfgTermosShein').value) : [],
        },
      };
      await api('/api/admin/central-ofertas/config', 'PUT', payload);
      $('centralAviso').hidden = false;
      $('centralAviso').textContent = 'Configurações do motor salvas com sucesso!';
      await carregarCentralOfertas();
    } catch (err) {
      $('centralErro').hidden = false;
      $('centralErro').textContent = err.message;
    }
  };

  $('btnExecutarGeral').onclick = async () => {
    $('centralAviso').hidden = true;
    $('centralErro').hidden = true;
    $('btnExecutarGeral').disabled = true;
    $('btnExecutarGeral').textContent = 'Executando coleta…';
    try {
      await api('/api/admin/central-ofertas/executar', 'POST', {});
      $('centralAviso').hidden = false;
      $('centralAviso').textContent = 'Coleta finalizada e vitrine atualizada com sucesso!';
      await carregarCentralOfertas();
    } catch (err) {
      $('centralErro').hidden = false;
      $('centralErro').textContent = err.message;
    } finally {
      $('btnExecutarGeral').disabled = false;
      $('btnExecutarGeral').textContent = 'Executar Coleta Agora';
    }
  };

  // Shopee Afiliados: relatório de pedidos, vendas e comissões via Affiliate Open API
  async function carregarShopeeRelatorio() {
    const periodo = $('shopeePeriodo') ? Number($('shopeePeriodo').value) || 30 : 30;
    try {
      if ($('shopeeStatus')) $('shopeeStatus').textContent = `Consultando API da Shopee (últimos ${periodo} dias)…`;
      const r = await api(`/api/admin/shopee/relatorio?dias=${periodo}`);
      if (!r.configurado) {
        if ($('shopeeStatus')) $('shopeeStatus').textContent = 'API Shopee não configurada.';
        return;
      }
      if (r.erro) {
        if ($('shopeeStatus')) $('shopeeStatus').textContent = `Aviso da API Shopee: ${r.erro}`;
      } else {
        if ($('shopeeStatus')) $('shopeeStatus').textContent = `Conexão ativa · AppID: ${r.appId || 'OK'} · Últimos ${r.dias} dias analisados`;
      }

      if ($('shopeeTotalComissao')) $('shopeeTotalComissao').textContent = brl.format(r.totalComissao || 0);
      if ($('shopeeTotalVendas')) $('shopeeTotalVendas').textContent = `Volume transacionado: ${brl.format(r.totalVendas || 0)}`;
      if ($('shopeeTotalPedidos')) $('shopeeTotalPedidos').textContent = `${r.totalPedidos || 0} pedidos`;
      if ($('shopeeAppInfo')) $('shopeeAppInfo').textContent = `Rastreamento via conversionReport (AppID: ${r.appId || 'OK'})`;

      const convs = r.conversoes || [];
      const tbody = $('linhasShopeeConversoes');
      if (tbody) {
        if (!convs.length) {
          tbody.innerHTML = `<tr><td colspan="5" class="note" style="text-align:center;padding:16px">Nenhum pedido de venda registrado na Shopee nos últimos ${periodo} dias. Conforme as compras forem concluídas através dos links da vitrine, elas aparecerão aqui automaticamente.</td></tr>`;
        } else {
          tbody.innerHTML = convs.map((c) => `
            <tr>
              <td><small>${c.dataCompra ? new Date(c.dataCompra).toLocaleDateString('pt-BR') : 'recente'}</small></td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  ${c.imagem ? `<img src="${esc(c.imagem)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:4px">` : ''}
                  <div>
                    <b>${esc(c.nome || 'Produto')}</b><br>
                    <small class="note">${esc(c.loja || 'Loja Shopee')} · Qtd: ${c.quantidade || 1}</small>
                  </div>
                </div>
              </td>
              <td><b>${brl.format(c.valorPago || c.preco || 0)}</b></td>
              <td style="color:#2b825b;font-weight:700">${brl.format(c.comissao || 0)}</td>
              <td><span class="pill ativa" style="font-size:11px">${esc(c.statusPedido || 'Concluído')}</span></td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      if ($('shopeeStatus')) $('shopeeStatus').textContent = `Erro ao carregar dados da Shopee: ${err.message}`;
    }
  }

  if ($('btnAtualizarShopee')) $('btnAtualizarShopee').onclick = () => carregarShopeeRelatorio();
  if ($('shopeePeriodo')) $('shopeePeriodo').onchange = () => carregarShopeeRelatorio();

  // Amazon Afiliados: só mostra o estado. As credenciais ficam no Coolify, nunca nesta tela.
  async function carregarAmazon() {
    try {
      const s = await api('/api/admin/amazon');
      $('amzStatus').textContent = s.configurada
        ? `Marketplace ${s.marketplace} · tag ${s.parceiro} · credencial ${s.versao} · última sincronização: ${s.ultimaSincronizacao ? new Date(s.ultimaSincronizacao).toLocaleString('pt-BR') : 'nunca'} · ${s.total} produtos`
        : 'Não configurada. Defina AMAZON_CREDENCIAL_ID, AMAZON_CREDENCIAL_SEGREDO e AMAZON_PARTNER_TAG no Coolify.';
      $('amzErro').hidden = !s.erro;
      $('amzErro').textContent = s.erro ? `Último erro: ${s.erro}` : '';
    } catch (err) { $('amzStatus').textContent = err.message; }
  }
  $('amzTestar').onclick = async () => {
    $('amzTeste').hidden = true;
    try {
      const r = await api('/api/admin/amazon/testar', 'POST', { asin: $('amzAsin').value });
      $('amzTeste').hidden = false;
      $('amzTeste').className = `msg ${r.ok ? 'ok' : 'erro'}`;
      $('amzTeste').textContent = r.ok ? `Conexão ok: ${r.titulo ?? 'produto encontrado'}${r.preco ? ` · ${r.preco}` : ''}` : r.mensagem;
    } catch (err) { alert(err.message); }
  };

  $('fSenhaAdm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, m = $('mSenhaAdm');
    try {
      await api('/api/admin/senha', 'POST', { atual: f.atual.value, nova: f.nova.value });
      f.reset();
      m.className = 'msg ok';
      m.textContent = 'Senha trocada. Use a nova no próximo login.';
    } catch (err) { m.className = 'msg erro'; m.textContent = err.message; }
    m.hidden = false;
  });

  // Radar de Ofertas no WhatsApp (WAHA)
  async function carregarRadar() {
    try {
      const r = await api('/api/admin/radar/status');
      const w = r.waha || {};
      const cfg = r.config || {};

      if ($('radarStatusDot')) {
        $('radarStatusDot').style.background = w.online ? '#22c55e' : '#ef4444';
      }
      if ($('radarStatusTitulo')) {
        $('radarStatusTitulo').textContent = w.online ? `WAHA Conectado (${w.nomePerfil || 'Online'})` : 'WAHA Desconectado';
      }
      if ($('radarStatusDetalhes')) {
        $('radarStatusDetalhes').textContent = w.online
          ? `Sessão: ${w.sessao} · WhatsApp: ${w.numero || 'ativo'} · Endpoint: ${w.apiUrl || 'http://waha:3000'}`
          : `Status: ${w.status || 'offline'} · Motivo: ${w.erro || 'Não foi possível comunicar com o WAHA'}`;
      }
      if ($('radarWahaStatusCard')) {
        $('radarWahaStatusCard').style.background = w.online ? '#f0fdf4' : '#fef2f2';
        $('radarWahaStatusCard').style.borderColor = w.online ? '#bbf7d0' : '#fecaca';
      }

      if ($('radarChatId') && !$('radarChatId').value) $('radarChatId').value = cfg.chatId || '';
      if ($('radarDescontoMin')) $('radarDescontoMin').value = cfg.descontoMinimoPct || 25;
      if ($('radarAtivo')) $('radarAtivo').checked = Boolean(cfg.ativo);
      if ($('radarContador24h')) $('radarContador24h').textContent = r.enviados24h || 0;

      const ultimos = r.ultimosEnviados || [];
      if ($('linhasRadarEnviados')) {
        if (!ultimos.length) {
          $('linhasRadarEnviados').innerHTML = '<tr><td colspan="4" class="note">Nenhum envio recente registrado.</td></tr>';
        } else {
          $('linhasRadarEnviados').innerHTML = ultimos.map((it) => `
            <tr>
              <td><small class="note">${new Date(it.enviadoEm).toLocaleString('pt-BR')}</small></td>
              <td><b>${esc(it.nome)}</b></td>
              <td><b>${brl.format(it.preco)}</b></td>
              <td><span class="pill ${it.tipo === 'local' ? 'ativa' : 'teste'}" style="font-size:11px">${esc(it.tipo || 'afiliado')}</span></td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      if ($('radarStatusDetalhes')) $('radarStatusDetalhes').textContent = `Erro ao checar status do radar: ${e.message}`;
    }
  }

  function mostrarRadarMsg(texto, ok = true) {
    if (!$('radarMsg')) return;
    $('radarMsg').hidden = false;
    $('radarMsg').className = `msg ${ok ? 'ok' : 'erro'}`;
    $('radarMsg').textContent = texto;
  }

  if ($('btnSalvarRadar')) {
    $('btnSalvarRadar').onclick = async () => {
      $('radarMsg').hidden = true;
      try {
        const payload = {
          chatId: $('radarChatId').value.trim(),
          descontoMinimoPct: Number($('radarDescontoMin').value) || 25,
          ativo: $('radarAtivo').checked,
        };
        await api('/api/admin/radar/config', 'POST', payload);
        mostrarRadarMsg('Configuração do Radar salva com sucesso!');
        await carregarRadar();
      } catch (err) {
        mostrarRadarMsg(`Falha ao salvar radar: ${err.message}`, false);
      }
    };
  }

  if ($('btnTestarRadar')) {
    $('btnTestarRadar').onclick = async () => {
      $('radarMsg').hidden = true;
      const chatId = $('radarChatId').value.trim();
      if (!chatId) {
        mostrarRadarMsg('Informe um ChatID / canal / grupo para enviar o teste.', false);
        return;
      }
      try {
        mostrarRadarMsg('Enviando mensagem de teste via WAHA...');
        await api('/api/admin/radar/testar', 'POST', { chatId });
        mostrarRadarMsg('Mensagem de teste enviada com sucesso no WhatsApp!');
        await carregarRadar();
      } catch (err) {
        mostrarRadarMsg(`Erro no envio de teste: ${err.message}`, false);
      }
    };
  }

  if ($('btnDispararRadar')) {
    $('btnDispararRadar').onclick = async () => {
      $('radarMsg').hidden = true;
      const chatId = $('radarChatId').value.trim();
      if (!chatId) {
        mostrarRadarMsg('Informe um ChatID / canal / grupo de destino.', false);
        return;
      }
      try {
        mostrarRadarMsg('Varrendo ofertas e despachando as melhores oportunidades...');
        const res = await api('/api/admin/radar/disparar-agora', 'POST', {
          chatId,
          descontoMinimoPct: Number($('radarDescontoMin').value) || 25,
        });
        if (res.resultado?.enviados > 0) {
          mostrarRadarMsg(`Sucesso! ${res.resultado.enviados} ofertas despachadas no WhatsApp.`);
        } else {
          mostrarRadarMsg(res.resultado?.mensagem || 'Nenhuma oferta elegível encontrada para envio.', false);
        }
        await carregarRadar();
      } catch (err) {
        mostrarRadarMsg(`Erro ao disparar radar: ${err.message}`, false);
      }
    };
  }

  // Instagram @citshopping
  let produtosInsta = [];
  async function carregarInstagram() {
    try {
      const st = await api('/api/admin/instagram/status');
      if ($('instaAccountId') && st.accountId) $('instaAccountId').value = st.accountId;
      if ($('instaPostarAutomatico') && st.postarAutomatico !== undefined) {
        $('instaPostarAutomatico').checked = Boolean(st.postarAutomatico);
      }
      if ($('instaStoryDiario')) $('instaStoryDiario').checked = Boolean(st.storyDiario);
      // Postagem diária, validade do token, mais buscados e histórico
      $('instaDiarioAtivo').checked = Boolean(st.diario?.ativo);
      $('instaDiarioStory').checked = Boolean(st.diario?.story);
      $('instaDiarioHorarios').value = (st.diario?.horarios ?? []).join(', ');
      const tk = st.token ?? {};
      $('instaTokenInfo').innerHTML = st.conexaoErro
        ? `<b class="erro">Instagram desconectado:</b> ${esc(st.conexaoErro)}. Gere um token novo na Meta e cole em "Meta Access Token" abaixo.`
        : `Token ${tk.expiraEm ? `vence em <b>${new Date(tk.expiraEm).toLocaleDateString('pt-BR')}</b>` : '<b>sem data de vencimento</b>'}${tk.tipo ? ` (${tk.tipo === 'PAGE' ? 'de Página' : tk.tipo === 'USER' ? 'de usuário' : esc(tk.tipo)})` : ''}.`;
      $('instaBuscas').textContent = st.maisBuscados?.length ? `Mais buscados da semana: ${st.maisBuscados.map((b) => `${b.termo} (${b.n})`).join(', ')}` : 'Ainda sem buscas registradas no site.';
      $('instaHistorico').innerHTML = (st.historicoDiario ?? []).map((h) => `<div class="item-adm"><p>${new Date(h.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${h.ok ? 'Publicado' : '<b>Falhou</b>'} · ${esc(h.nome ?? '-')}</p><p class="note">${esc(h.motivo ?? '')}${h.erro ? ` · ${esc(h.erro)}` : ''}</p></div>`).join('') || '<p class="note">Nenhuma postagem diária ainda.</p>';
      if ($('instaUltimoStory')) $('instaUltimoStory').textContent = st.ultimoStory ? `Último Story: ${st.ultimoStory.produto} (${st.ultimoStory.loja}), em ${new Date(`${st.ultimoStory.dia}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Nenhum Story de loja publicado ainda.';

      const v = await api('/api/vitrine');
      produtosInsta = v.produtos || [];
      if ($('instaSelectProduto')) {
        $('instaSelectProduto').innerHTML = produtosInsta.map((p) => {
          const desc = p.precoAntigo > p.preco ? ` (${Math.round((1 - p.preco / p.precoAntigo) * 100)}% OFF)` : '';
          return `<option value="${esc(p.id)}">[${esc(p.loja)}] ${esc(p.nome.slice(0, 50))} - ${brl.format(p.preco)}${desc}</option>`;
        }).join('');
      }
    } catch (e) {
      console.error('Erro ao carregar Instagram:', e.message);
    }
  }

  if ($('btnGerarCardInsta')) {
    $('btnGerarCardInsta').onclick = async () => {
      const id = $('instaSelectProduto')?.value;
      if (!id) return alert('Selecione um produto.');
      const formato = $('instaFormatoCard')?.value || 'feed';
      const endpoint = formato === 'stories' ? '/api/instagram/card-stories/' : '/api/instagram/card/';
      const cardUrl = `${endpoint}${encodeURIComponent(id)}?t=${Date.now()}`;
      $('instaCardImg').src = cardUrl;
      $('btnBaixarCard').href = cardUrl;
      $('btnBaixarCard').download = formato === 'stories' ? 'stories-citshop.jpg' : 'post-citshop.jpg';
      if ($('instaCardTitulo')) {
        $('instaCardTitulo').textContent = formato === 'stories' ? 'Card Stories (1080x1920 HD):' : 'Card Feed (1080x1080 HD):';
      }
      $('instaPreviaBox').hidden = false;

      try {
        const leg = await api(`/api/admin/instagram/legenda/${encodeURIComponent(id)}`);
        $('instaLegendaTxt').value = leg.legenda || '';
      } catch (err) {
        $('instaLegendaTxt').value = 'Erro ao gerar legenda: ' + err.message;
      }
    };
  }

  if ($('btnCopiarLegenda')) {
    $('btnCopiarLegenda').onclick = () => {
      const txt = $('instaLegendaTxt').value;
      navigator.clipboard.writeText(txt);
      alert('Legenda copiada para a área de transferência!');
    };
  }

  if ($('btnPublicarInsta')) {
    $('btnPublicarInsta').onclick = async () => {
      const id = $('instaSelectProduto')?.value;
      const legenda = $('instaLegendaTxt')?.value;
      if (!id) return;
      $('instaMsg').hidden = false;
      $('instaMsg').className = 'msg';
      $('instaMsg').textContent = 'Publicando no feed do @citshopping via Meta Graph API...';

      try {
        const res = await api('/api/admin/instagram/publicar', 'POST', { produtoId: id, legenda });
        $('instaMsg').className = 'msg ok';
        $('instaMsg').textContent = `Publicado com sucesso no Instagram! ID da Mídia: ${res.publicacao?.mediaId || ''}`;
      } catch (err) {
        $('instaMsg').className = 'msg erro';
        $('instaMsg').textContent = `Falha ao publicar: ${err.message}`;
      }
    };
  }

  if ($('btnSalvarInstaConfig')) {
    $('btnSalvarInstaConfig').onclick = async () => {
      try {
        await api('/api/admin/instagram/config', 'POST', {
          accountId: $('instaAccountId').value.trim(),
          accessToken: $('instaToken').value.trim(),
          postarAutomatico: $('instaPostarAutomatico')?.checked || false,
          storyDiario: $('instaStoryDiario')?.checked || false,
          diario: { ativo: $('instaDiarioAtivo').checked, story: $('instaDiarioStory').checked, horarios: $('instaDiarioHorarios').value },
        });
        $('instaToken').value = '';
        alert('Configurações do Instagram salvas com sucesso!');
        carregarInstagram();
      } catch (err) {
        alert('Erro ao salvar: ' + err.message);
      }
    };
  }

  // Telegram Oficial
  async function carregarTelegram() {
    try {
      const st = await api('/api/admin/telegram/status');
      if ($('tgChatId') && st.chatId) $('tgChatId').value = st.chatId;
      if ($('tgAtivo') && st.ativo !== undefined) $('tgAtivo').checked = Boolean(st.ativo);
    } catch (e) {
      console.error('Erro ao carregar Telegram:', e.message);
    }
  }

  if ($('btnSalvarTgConfig')) {
    $('btnSalvarTgConfig').onclick = async () => {
      try {
        await api('/api/admin/telegram/config', 'POST', {
          botToken: $('tgBotToken').value.trim(),
          chatId: $('tgChatId').value.trim(),
          ativo: $('tgAtivo')?.checked || false,
        });
        alert('Configurações do Telegram salvas com sucesso!');
      } catch (err) {
        alert('Erro ao salvar: ' + err.message);
      }
    };
  }

  if ($('btnTestarTg')) {
    $('btnTestarTg').onclick = async () => {
      $('tgMsg').hidden = false;
      $('tgMsg').className = 'msg';
      $('tgMsg').textContent = 'Disparando oferta de teste no Telegram...';
      try {
        const res = await api('/api/admin/telegram/testar', 'POST');
        $('tgMsg').className = 'msg ok';
        $('tgMsg').textContent = `Enviado com sucesso no Telegram! ID da mensagem: ${res.envio?.messageId || 'OK'}`;
      } catch (err) {
        $('tgMsg').className = 'msg erro';
        $('tgMsg').textContent = `Erro ao enviar teste: ${err.message}`;
      }
    };
  }

  // Abas (#lojas, #convites, #cupons, #afiliados, #canais, #conta): uma seção por vez, o endereço guarda a aba.
  function irPara() {
    const nome = location.hash.slice(1);
    const aba = document.querySelector(`[data-aba="${nome}"]`) ? nome : 'inicio';
    document.querySelectorAll('[data-aba]').forEach((el) => { el.hidden = el.dataset.aba !== aba; });
    document.querySelectorAll('#abas a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === `#${aba}`));
  }
  addEventListener('hashchange', irPara);
  // Botões "copiar" (ex.: link da bio). O onclick embutido no HTML era bloqueado pela CSP.
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copiar-texto]');
    if (!b) return;
    const antes = b.textContent;
    try { await navigator.clipboard.writeText(b.dataset.copiarTexto); b.textContent = 'Copiado!'; }
    catch { b.textContent = b.dataset.copiarTexto; }
    setTimeout(() => { b.textContent = antes; }, 2000);
  });
  // No celular as tabelas viram cartões: cada célula ganha o nome da coluna (o CSS mostra como rótulo).
  function rotular() {
    document.querySelectorAll('#vAdm table.tabela').forEach((t) => {
      const nomes = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
        if (nomes[i] && !td.hasAttribute('colspan') && td.dataset.rotulo !== nomes[i]) td.dataset.rotulo = nomes[i];
      }));
    });
  }
  new MutationObserver(rotular).observe($('vAdm'), { childList: true, subtree: true });

  function iniciar() {
    carregar().then(() => {
      $('fEnt').hidden = true;
      $('vAdm').hidden = false;
      irPara();
      $('sair').hidden = false;
      carregarShopeeRelatorio();
      carregarCentralOfertas();
      carregarAmazon();
      carregarRadar();
      carregarInstagram();
      carregarTelegram();
    }).catch(() => { $('fEnt').hidden = false; });
  }
  iniciar();
})();
