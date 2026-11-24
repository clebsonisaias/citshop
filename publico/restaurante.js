// Painel do restaurante (CITshop Food). Conta, plano FOOD PRO e Mercado Pago reaproveitam /api/painel/*;
// cardápio, pedidos, funcionamento, cozinha e impressão usam /api/food/painel/*.
(() => {
  const $ = (id) => document.getElementById(id);
  const { esc } = window.CIT;
  const brl = (n) => window.CIT.brl.format(Number(n) || 0);
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const SIT = { aguardando: 'Novo', aceito: 'Aceito', preparo: 'No preparo', pronto: 'Pronto', aguardando_saida: 'Aguardando saída', saiu: 'Saiu para entrega', entregue: 'Entregue', concluido: 'Concluído', cancelado: 'Cancelado' };
  const PAG = { dinheiro: 'Dinheiro na entrega', cartao_entrega: 'Cartão na entrega', pix_entrega: 'Pix na entrega', online: 'Online (Mercado Pago)' };
  const IMP = { pendente: 'Na fila', enviado: 'Enviado à impressora', erro: 'Erro (tentando de novo)', cancelado: 'Cancelado', expirado: 'Expirou sem imprimir' };
  let conta = null, food = null;

  async function api(url, metodo = 'GET', corpo) {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erro || 'Não deu certo. Tente de novo.'), { status: r.status });
    return d;
  }
  const aviso = (t, ok = true) => { const m = $('rAviso'); m.textContent = t; m.className = `msg${ok ? ' ok' : ''}`; m.hidden = !t; };

  // ---------- item: editor visual (editor-food.js) + prévia com o mesmo cálculo do servidor ----------
  const resumoGrupo = (g) => `${g.nome}${g.tipo === 'remover' ? ' (tirar ingrediente)' : ''}: ${g.min ? `${g.min === g.max ? g.min : `${g.min} a ${g.max}`} obrigatório` : `até ${g.max}`} · ${g.opcoes.length} opções`;
  let modeloAplicado = null, precoMod = null;
  import('/food-preco.js').then((m) => { precoMod = m; }).catch(() => {});
  function previa() {
    const f = $('fItemRest'), v = CITEditorFood.valor();
    if (!precoMod) return;
    const item = { nome: f.nome.value || 'Item', preco: Number(String(f.preco.value || '0').replace(',', '.')) || 0, variacoes: v.variacoes.map((x, i) => ({ ...x, id: x.id ?? `v${i}`, preco: Number(String(x.preco || '0').replace(',', '.')) || 0 })), grupos: v.grupos.map((g, i) => ({ ...g, id: g.id ?? `g${i}`, opcoes: g.opcoes.map((o, j) => ({ ...o, id: o.id ?? `o${j}`, preco: Number(String(o.preco || '0').replace(',', '.')) || 0 })) })) };
    const minimo = precoMod.precoMinimo(item, {});
    $('edPrevia').textContent = Number.isFinite(minimo) ? `Prévia na vitrine: a partir de ${brl(minimo / 100)}${item.grupos.length ? ` · ${item.grupos.map(resumoGrupo).join(' · ')}` : ''}` : '';
  }
  function abrirItem(i) {
    const f = $('fItemRest');
    f.reset(); f.id.value = i?.id ?? ''; modeloAplicado = i?.modeloId ?? null;
    if (i) {
      f.nome.value = i.nome; f.categoria.value = i.categoria; f.descricao.value = i.descricao ?? ''; f.preco.value = i.preco ? String(i.preco).replace('.', ',') : '';
      f.estacao.value = i.estacao ?? ''; f.ativo.checked = i.ativo; f.estoque.value = i.estoque ?? ''; f.datas.value = (i.datas ?? []).join(', ');
      f.horaDe.value = i.horario?.de ?? ''; f.horaAte.value = i.horario?.ate ?? '';
    }
    $('edModelo').value = modeloAplicado ?? '';
    $('fItemTitulo').textContent = i ? `Editar: ${i.nome}` : 'Novo item';
    CITEditorFood.abrir($('edItem'), i, previa);
  }

  // ---------- render ----------
  function renderTopo() {
    $('rNome').textContent = conta.loja.nome;
    $('rSituacao').textContent = `${food.situacao.motivo}${conta.status === 'vencida' ? ' · assinatura vencida: o restaurante não aparece na praça' : ''}`;
    $('rFechar').textContent = food.food.fechadoManual ? 'Abrir agora' : 'Fechar agora';
    $('rLoja').href = `/alimentacao/${food.slug}`;
    const imp = food.impressao;
    if (imp.configurada && !imp.online) aviso('Impressão automática indisponível: o CITshop Print não responde. Os pedidos continuam na tela da cozinha.', false);
  }
  // Pedidos em colunas (como no novo design): cada cartão tem o próximo passo num botão; o resto fica em "Mais opções".
  const COLUNAS = [['Novos', ['aguardando']], ['Em preparo', ['aceito', 'preparo']], ['Prontos e entrega', ['pronto', 'aguardando_saida', 'saiu']], ['Concluídos', ['entregue', 'concluido', 'cancelado']]];
  const ativo = (p) => p.status === 'na_entrega' || p.status === 'approved';
  const proximo = (p) => ({ aguardando: ['aceito', 'Aceitar pedido'], aceito: ['preparo', 'Começar preparo'], preparo: ['pronto', 'Marcar como pronto'],
    pronto: p.receber === 'entrega' ? ['saiu', 'Saiu para entrega'] : ['concluido', 'Cliente retirou'], aguardando_saida: p.receber === 'entrega' ? ['saiu', 'Saiu para entrega'] : ['concluido', 'Cliente retirou'],
    saiu: ['entregue', 'Marcar como entregue'] })[p.situacao];
  function renderPedidos() {
    const colunaDe = (p) => (ativo(p) ? COLUNAS.findIndex(([, s]) => s.includes(p.situacao)) : 3);
    $('rPedidos').innerHTML = food.pedidos.length ? `<div class="kanban">${COLUNAS.map(([nome], c) => {
      const lista = food.pedidos.filter((p) => colunaDe(p) === c).slice(0, c === 3 ? 20 : 100);
      return `<section class="kanban-col"><header><h2>${nome}</h2><span>${lista.length}</span></header>${lista.map((p) => cartaoPedido(p, c)).join('') || '<p class="note">Nada aqui.</p>'}</section>`;
    }).join('')}</div>` : '<p class="note">Nenhum pedido ainda. Divulgue o link do restaurante.</p>';
  }
  function cartaoPedido(p, c) {
    const prox = c < 3 ? proximo(p) : null;
    return `<article class="kanban-card">
      <header><b>#${p.numero}</b><span>${new Date(p.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></header>
      <p class="kanban-itens">${p.itens.map((i) => `${i.quantidade}x ${esc(i.nome)}${i.opcoes.length || i.variacao ? ` <small>(${esc([i.variacao?.nome, ...i.opcoes.map((o) => `${o.tipo === 'remover' ? 'sem ' : ''}${(o.qtd ?? 1) > 1 ? `${o.qtd}x ` : ''}${o.nome}`)].filter(Boolean).join(', '))})</small>` : ''}${i.observacao ? ` — <b>${esc(i.observacao)}</b>` : ''}`).join('<br>')}</p>
      ${p.comprador?.observacao ? `<p class="kds-obs">⚠ ${esc(p.comprador.observacao)}</p>` : ''}
      <p class="kanban-pe"><span class="pilula">${p.receber === 'entrega' ? 'Entrega' : 'Retirada'}</span><b>${brl(p.valorTotal)}</b></p>
      ${c === 3 ? `<p class="note">${esc(ativo(p) ? SIT[p.situacao] : p.status === 'approved' ? SIT[p.situacao] : 'Pagamento não concluído')}</p>` : ''}
      ${prox ? `<button class="btn" type="button" data-avancar="${esc(p.id)}" data-para="${prox[0]}">${prox[1]}</button>` : ''}
      <details class="kanban-mais"><summary>Mais opções</summary><div class="item-adm">
      <p><b>#${p.numero}</b> · ${esc(SIT[p.situacao])} · ${new Date(p.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(PAG[p.pagamentoForma] ?? '')}${p.status === 'approved' ? ' (pago)' : ''}</p>
      <p>${p.itens.map((i) => `${i.quantidade}x ${esc(i.nome)}${i.opcoes.length || i.variacao ? ` (${esc([i.variacao?.nome, ...i.opcoes.map((o) => `${o.tipo === 'remover' ? 'sem ' : ''}${(o.qtd ?? 1) > 1 ? `${o.qtd}x ` : ''}${o.nome}`)].filter(Boolean).join(', '))})` : ''}${i.observacao ? ` — <b>${esc(i.observacao)}</b>` : ''}`).join('<br>')}</p>
      <p class="note">${esc(p.comprador?.nome)} · ${p.receber === 'entrega' ? `Entrega: ${esc(p.comprador?.endereco)}` : 'Retirada'} · total ${brl(p.valorTotal)}${p.troco ? ` · troco para ${brl(p.troco)}` : ''}</p>
      ${p.comprador?.observacao ? `<p class="kds-obs">⚠ ${esc(p.comprador.observacao)}</p>` : ''}
      <p class="rest-acoes"><label class="food-campo">Situação<select data-situacao="${esc(p.id)}">${Object.entries(SIT).map(([k, v]) => `<option value="${k}" ${k === p.situacao ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${p.comprador?.whatsapp ? `<a class="btn sec" href="https://wa.me/${esc(p.comprador.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${food.impressao.configurada ? `<button class="btn sec" type="button" data-imprimir="${esc(p.id)}" data-tipo="completa">Reimprimir</button><button class="btn sec" type="button" data-imprimir="${esc(p.id)}" data-tipo="cozinha">Via da cozinha</button>` : ''}</p></div></details>
    </article>`;
  }
  function renderItens() {
    const cats = [...new Set(food.itens.map((i) => i.categoria))];
    $('rCats').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
    $('rItens').innerHTML = food.itens.length ? cats.map((c) => `<h3>${esc(c)}</h3>${food.itens.filter((i) => i.categoria === c).map((i) => `<div class="item-adm">
      <p><b>${esc(i.nome)}</b> · ${brl(i.preco)}${i.ativo ? '' : ' · <b>indisponível</b>'}${i.estacao ? ` · ${esc(i.estacao)}` : ''}</p>
      ${(i.variacoes ?? []).length ? `<p class="note">Tamanhos: ${i.variacoes.map((v) => `${esc(v.nome)} ${brl(v.preco)}`).join(' · ')}</p>` : ''}
      ${i.grupos.length ? `<p class="note">${i.grupos.map((g) => esc(resumoGrupo(g))).join('<br>')}</p>` : ''}
      ${i.estoque != null || (i.datas ?? []).length ? `<p class="note">${i.estoque != null ? `Estoque: ${i.estoque}` : ''}${(i.datas ?? []).length ? ` · Dias: ${esc(i.datas.join(', '))}` : ''}</p>` : ''}
      <p class="rest-acoes"><button class="btn sec" type="button" data-editar="${esc(i.id)}">Editar</button><button class="btn sec" type="button" data-alternar="${esc(i.id)}">${i.ativo ? 'Marcar indisponível' : 'Disponibilizar'}</button>
      <label class="btn sec rest-foto">Foto<input type="file" accept="image/jpeg,image/png,image/webp" data-foto="${esc(i.id)}" hidden></label>
      <button class="btn sec" type="button" data-apagar="${esc(i.id)}">Apagar</button></p></div>`).join('')}`).join('') : '<p class="note">Cadastre o primeiro item do cardápio acima.</p>';
  }
  function renderConfig() {
    const f = $('fConfig'), c = food.food;
    $('rHorarios').innerHTML = DIAS.map((d, n) => {
      const h = (c.horarios ?? []).find((x) => x.dia === n);
      return `<div class="rest-dia"><label><input type="checkbox" data-dia="${n}" ${h ? 'checked' : ''}> ${d}</label><input type="time" data-abre="${n}" value="${h?.abre ?? '18:00'}" aria-label="${d} abre"><input type="time" data-fecha="${n}" value="${h?.fecha ?? '23:00'}" aria-label="${d} fecha"></div>`;
    }).join('');
    f.feriados.value = (c.feriados ?? []).join(', ');
    f.tipo.value = c.tipo ?? conta.loja.categoria ?? '';
    f.preparoMin.value = c.preparoMin ?? 40; f.pedidoMinimo.value = c.pedidoMinimo ?? ''; f.taxaEntrega.value = c.taxaEntrega ?? ''; f.maxSimultaneos.value = c.maxSimultaneos ?? '';
    f.entrega.checked = c.entrega !== false; f.retirada.checked = c.retirada !== false;
  }
  function renderCozinha() {
    const imp = food.impressao;
    $('rImpStatus').textContent = !imp.configurada ? 'Nenhuma impressora vinculada. Sem impressora, os pedidos aparecem normalmente na tela da cozinha.'
      : imp.online ? `Impressora conectada${imp.pendentes ? ` · ${imp.pendentes} na fila` : ''}.` : `CITshop Print sem resposta desde ${imp.vistoEm ? new Date(imp.vistoEm).toLocaleString('pt-BR') : 'o vínculo'}. A fila espera e imprime quando voltar.`;
    const PAPEL = { cozinha: 'Cozinha', atendente: 'Atendimento', entregador: 'Entregador', impressora: 'Impressora' };
    $('rAcessos').innerHTML = food.acessos.length ? food.acessos.map((a) => `<div class="item-adm"><p><b>${esc(PAPEL[a.papel])}</b> · ${esc(a.nome)}${a.dispositivo?.impressora ? ` · ${esc(a.dispositivo.impressora)} (${a.dispositivo.largura} mm)` : ''}${a.papel === 'impressora' && !a.vinculado ? ' · aguardando o código' : ''}${a.vistoEm ? ` · visto ${new Date(a.vistoEm).toLocaleTimeString('pt-BR')}` : ''}</p><button class="btn sec" type="button" data-revogar="${esc(a.id)}">Revogar</button></div>`).join('') : '<p class="note">Nenhum acesso criado.</p>';
    $('rImpressoes').innerHTML = food.impressoes.length ? food.impressoes.map((j) => `<div class="item-adm"><p>#${j.numero} · ${esc(j.tipo)}${j.manual ? ' (reimpressão)' : ''} · <b>${esc(IMP[j.status])}</b>${j.erro ? ` · ${esc(j.erro)}` : ''} · ${new Date(j.criadoEm).toLocaleTimeString('pt-BR')}</p>${['pendente', 'erro'].includes(j.status) ? `<button class="btn sec" type="button" data-cancelar-imp="${esc(j.id)}">Cancelar</button>` : ''}</div>`).join('') : '<p class="note">Nenhuma impressão ainda.</p>';
  }
  function renderConta() {
    const p = conta.plano, mpOk = conta.loja.mpConectado;
    const ass = conta.loja.assinatura?.status;
    $('rConta').innerHTML = `<h2>Plano ${esc(p.nome)}</h2>
      <p>${p.precoContratado ? `Você paga <b>${brl(p.precoContratado)}</b> por mês.` : `Mensalidade: <b>${brl(p.precoParaAssinar)}</b>${p.precoParaAssinar < p.precoOficial ? ` (de ${brl(p.precoOficial)}, cupom ${esc(p.beneficio?.codigo ?? '')})` : ''}.`} Sem comissão sobre os pedidos, sem limite de faturamento.</p>
      <p class="note">${conta.status === 'teste' ? `Teste grátis: faltam ${conta.diasTeste} dias. Assinando agora, a primeira cobrança só vem no fim do teste.` : ''}${ass === 'authorized' ? 'Assinatura ativa.' : ass === 'pausada' ? 'Pagamento atrasado: regularize no Mercado Pago.' : ''}</p>
      ${ass !== 'authorized' ? `<p><button class="btn" type="button" id="rAssinar">Assinar o FOOD PRO</button></p>
      ${!p.beneficio && p.campanha ? `<form id="rCupom" class="rest-acoes"><label class="food-campo">Cupom<input name="codigo" placeholder="${esc(p.campanha.codigo)}"></label><button class="btn sec" type="submit">Aplicar</button></form><p class="note">${esc(p.campanha.codigo)}: ${brl(p.campanha.preco)} por mês até o fim da campanha (${new Date(p.campanha.fim).toLocaleDateString('pt-BR')}) e nas renovações.</p>` : ''}` : ''}
      <h2>Pagamento online dos pedidos</h2>
      <p class="note">${mpOk ? 'Mercado Pago conectado: os clientes podem pagar com Pix ou cartão e o dinheiro cai direto na sua conta.' : 'Conecte o Mercado Pago para aceitar Pix e cartão no pedido. Sem conectar, os clientes pagam na entrega.'}</p>
      ${mpOk ? '' : '<p><a class="btn" href="/api/painel/mercadopago/conectar">Conectar Mercado Pago</a></p>'}
      <p class="note">Logo, cor, endereço e entrega por km: <a href="/painel#loja">dados do estabelecimento</a>.</p>`;
  }
  function renderTudo() { renderTopo(); renderPedidos(); renderItens(); renderModelos(); renderConfig(); renderCozinha(); renderConta(); }

  async function carregar() {
    try { conta = await api('/api/painel/eu'); } catch { $('vAuth').hidden = false; $('vPainel').hidden = true; $('sair').hidden = true; return; }
    if (conta.loja.segmento !== 'food') { location.replace('/painel'); return; }
    food = await api('/api/food/painel');
    $('vAuth').hidden = true; $('vPainel').hidden = false; $('sair').hidden = false;
    renderTudo();
    abrirItem(null);
    const q = new URLSearchParams(location.search);
    if (q.get('mp') === 'conectado') aviso('Mercado Pago conectado.');
    if (q.get('mp') === 'erro') aviso('Não deu para conectar o Mercado Pago. Tente de novo.', false);
  }
  // Atualização automática: só pedidos, topo e impressão (não mexe em formulários sendo preenchidos).
  async function recarregarFood() { food = await api('/api/food/painel'); renderTopo(); renderPedidos(); renderCozinha(); }

  // ---------- eventos ----------
  const enviarForm = (id, fn) => $(id).addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = e.target.querySelector('.food-erro'), bt = e.target.querySelector('[type=submit]');
    erroEl.textContent = ''; bt.disabled = true;
    try { await fn(e.target); } catch (err) { erroEl.textContent = err.message; } finally { bt.disabled = false; }
  });
  enviarForm('fEntrar', async (f) => { await api('/api/painel/entrar', 'POST', { email: f.email.value, senha: f.senha.value, segmento: 'food' }); carregar(); });
  enviarForm('fCadastro', async (f) => {
    const d = Object.fromEntries(new FormData(f));
    await api('/api/painel/cadastro', 'POST', { ...d, aceite: f.aceite.checked, segmento: 'food' });
    carregar();
  });
  enviarForm('fItemRest', async (f) => {
    const id = f.id.value, ed = CITEditorFood.valor();
    const corpo = { nome: f.nome.value, categoria: f.categoria.value, descricao: f.descricao.value, preco: f.preco.value || '0', estacao: f.estacao.value, ativo: f.ativo.checked,
      estoque: f.estoque.value, datas: f.datas.value, horario: f.horaDe.value && f.horaAte.value ? { de: f.horaDe.value, ate: f.horaAte.value } : null,
      variacoes: ed.variacoes, grupos: ed.grupos, modeloId: modeloAplicado };
    food = await api(id ? `/api/food/painel/itens/${encodeURIComponent(id)}` : '/api/food/painel/itens', id ? 'PUT' : 'POST', corpo);
    const salvo = id ? food.itens.find((x) => x.id === id) : food.itens.at(-1);
    abrirItem(salvo); renderItens(); aviso('Item salvo. Agora dá para ajustar as regras de cada tamanho.');
  });
  $('fItemNovo').addEventListener('click', (e) => { e.preventDefault(); abrirItem(null); });
  $('fItemRest').addEventListener('input', (e) => { if (!e.target.closest('#edItem')) previa(); });
  $('edModelo').addEventListener('change', (e) => {
    const m = food.modelos.find((x) => x.id === e.target.value);
    if (!m) { modeloAplicado = null; return; }
    if (CITEditorFood.valor().grupos.length && !confirm(`Trocar os grupos deste item pelos do modelo "${m.nome}"?`)) { e.target.value = modeloAplicado ?? ''; return; }
    modeloAplicado = m.id; CITEditorFood.usarGrupos(m.grupos);
  });
  $('edSalvarModelo').addEventListener('click', async () => {
    const grupos = CITEditorFood.valor().grupos;
    if (!grupos.length) return aviso('Crie pelo menos um grupo com opções antes de salvar o modelo.', false);
    const nome = prompt('Nome do modelo (ex.: Marmita tradicional):');
    if (!nome) return;
    try { food = await api('/api/food/painel/modelos', 'POST', { nome, grupos }); renderModelos(); aviso('Modelo salvo.'); } catch (err) { aviso(err.message, false); }
  });
  function renderModelos() {
    $('edModelo').innerHTML = '<option value="">—</option>' + food.modelos.map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('');
    $('edModelo').value = modeloAplicado ?? '';
    const uso = (id) => food.itens.filter((i) => i.modeloId === id).length;
    $('rModelos').innerHTML = food.modelos.length ? food.modelos.map((m) => `<div class="item-adm"><p><b>${esc(m.nome)}</b> · ${m.grupos.map((g) => esc(g.nome)).join(', ')} · usado em ${uso(m.id)} ${uso(m.id) === 1 ? 'produto' : 'produtos'}</p>
      <p class="rest-acoes"><button class="btn sec" type="button" data-modelo-atualizar="${esc(m.id)}">Atualizar com as opções do formulário</button><button class="btn sec" type="button" data-modelo-apagar="${esc(m.id)}">Apagar</button></p></div>`).join('') : '<p class="note">Nenhum modelo ainda. Monte os grupos de um item e toque em "Salvar opções como modelo".</p>';
  }
  enviarForm('fCopiarDia', async (f) => {
    const d = await api('/api/food/painel/cardapio/copiar', 'POST', { de: f.de.value, para: f.para.value });
    food = d.painel; renderItens(); aviso(`${d.copiados} ${d.copiados === 1 ? 'item ou opção copiado' : 'itens e opções copiados'} para ${f.para.value.split('-').reverse().join('/')}.`);
  });
  enviarForm('fConfig', async (f) => {
    const horarios = DIAS.map((_, n) => n).filter((n) => $('rHorarios').querySelector(`[data-dia="${n}"]`).checked)
      .map((n) => ({ dia: n, abre: $('rHorarios').querySelector(`[data-abre="${n}"]`).value, fecha: $('rHorarios').querySelector(`[data-fecha="${n}"]`).value }));
    food = await api('/api/food/painel/config', 'PUT', { horarios, feriados: f.feriados.value.split(',').map((x) => x.trim()).filter(Boolean), tipo: f.tipo.value, preparoMin: f.preparoMin.value, pedidoMinimo: f.pedidoMinimo.value, taxaEntrega: f.taxaEntrega.value, maxSimultaneos: f.maxSimultaneos.value, entrega: f.entrega.checked, retirada: f.retirada.checked });
    renderTudo(); aviso('Funcionamento salvo.');
  });
  document.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      const aba = t.closest('[data-aba]');
      if (aba) {
        document.querySelectorAll('[data-aba]').forEach((b) => b.setAttribute('aria-pressed', String(b === aba)));
        document.querySelectorAll('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== aba.dataset.aba; });
        return;
      }
      const pz = t.closest('[data-pausa]'); if (pz) { food = await api('/api/food/painel/pausa', 'POST', { minutos: Number(pz.dataset.pausa), ...(pz.dataset.pausa === '0' && { fechado: false }) }); return renderTudo(); }
      if (t.closest('#rFechar')) { food = await api('/api/food/painel/pausa', 'POST', { minutos: 0, fechado: !food.food.fechadoManual }); return renderTudo(); }
      const ed = t.closest('[data-editar]');
      if (ed) {
        abrirItem(food.itens.find((x) => x.id === ed.dataset.editar)); $('fItemRest').scrollIntoView({ behavior: 'smooth' }); return;
      }
      const alt = t.closest('[data-alternar]');
      if (alt) { const i = food.itens.find((x) => x.id === alt.dataset.alternar); food = await api(`/api/food/painel/itens/${encodeURIComponent(i.id)}`, 'PUT', { ...i, ativo: !i.ativo }); return renderItens(); }
      const mu = t.closest('[data-modelo-atualizar]');
      if (mu) {
        const m = food.modelos.find((x) => x.id === mu.dataset.modeloAtualizar), grupos = CITEditorFood.valor().grupos;
        if (!grupos.length) return aviso('Monte os grupos no formulário do item primeiro.', false);
        if (!confirm(`Substituir as opções do modelo "${m.nome}" pelas do formulário?`)) return;
        const aplicar = confirm('Aplicar também aos produtos que usam este modelo?\n\nOK = aplicar agora nos produtos publicados.\nCancelar = vale só para os próximos produtos.');
        const d = await api(`/api/food/painel/modelos/${encodeURIComponent(m.id)}`, 'PUT', { nome: m.nome, grupos, aplicarEmProdutos: aplicar });
        food = d.painel; renderItens(); renderModelos(); return aviso(aplicar ? `Modelo atualizado e aplicado em ${d.aplicados} ${d.aplicados === 1 ? 'produto' : 'produtos'}.` : 'Modelo atualizado. Os produtos publicados não mudaram.');
      }
      const ma = t.closest('[data-modelo-apagar]');
      if (ma && confirm('Apagar este modelo? Os produtos que usaram continuam com as opções.')) { food = await api(`/api/food/painel/modelos/${encodeURIComponent(ma.dataset.modeloApagar)}`, 'DELETE'); return renderModelos(); }
      const ap = t.closest('[data-apagar]');
      if (ap && confirm('Apagar este item do cardápio? Os pedidos antigos continuam guardados.')) { food = await api(`/api/food/painel/itens/${encodeURIComponent(ap.dataset.apagar)}`, 'DELETE'); return renderItens(); }
      const av = t.closest('[data-avancar]');
      if (av) { av.disabled = true; await api(`/api/food/painel/pedidos/${encodeURIComponent(av.dataset.avancar)}`, 'PATCH', { situacao: av.dataset.para }); return recarregarFood(); }
      const im = t.closest('[data-imprimir]');
      if (im) { food = await api(`/api/food/painel/pedidos/${encodeURIComponent(im.dataset.imprimir)}/imprimir`, 'POST', { tipo: im.dataset.tipo }); renderTudo(); return aviso('Enviado para a fila de impressão.'); }
      const ci = t.closest('[data-cancelar-imp]');
      if (ci) { food = await api(`/api/food/painel/impressoes/${encodeURIComponent(ci.dataset.cancelarImp)}`, 'DELETE'); return renderCozinha(); }
      const na = t.closest('[data-novo-acesso]');
      if (na) {
        const d = await api('/api/food/painel/acessos', 'POST', { papel: na.dataset.novoAcesso });
        food = d.painel; renderCozinha();
        if (d.codigo) { $('rCodigo').hidden = false; $('rCodigo').innerHTML = `Código da impressora: <b>${esc(d.codigo)}</b> (vale 15 minutos, uma vez)`; }
        if (d.link) { $('rLink').hidden = false; $('rLink').innerHTML = `Abra este link no aparelho ${na.dataset.novoAcesso === 'entregador' ? 'do entregador' : 'da cozinha'} (aparece só agora):<br><a href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.link)}</a> <button class="btn sec" type="button" data-copiar="${esc(d.link)}">Copiar</button>`; }
        return;
      }
      const cp = t.closest('[data-copiar]'); if (cp) { await navigator.clipboard?.writeText(cp.dataset.copiar); cp.textContent = 'Copiado'; return; }
      const rv = t.closest('[data-revogar]');
      if (rv && confirm('Revogar este acesso? O aparelho perde o acesso na hora.')) { food = await api(`/api/food/painel/acessos/${encodeURIComponent(rv.dataset.revogar)}`, 'DELETE'); return renderCozinha(); }
      if (t.closest('#rAssinar')) { const d = await api('/api/painel/assinar', 'POST'); location.href = d.url; return; }
      if (t.closest('#sair')) { await api('/api/painel/sair', 'POST'); location.reload(); }
    } catch (err) { aviso(err.message, false); }
  });
  document.addEventListener('change', async (e) => {
    try {
      const s = e.target.closest('[data-situacao]');
      if (s) { await api(`/api/food/painel/pedidos/${encodeURIComponent(s.dataset.situacao)}`, 'PATCH', { situacao: s.value }); return recarregarFood(); }
      const ft = e.target.closest('[data-foto]');
      if (ft?.files?.length) {
        const fd = new FormData(); fd.append('fotos', ft.files[0]);
        const r = await fetch(`/api/food/painel/itens/${encodeURIComponent(ft.dataset.foto)}/foto`, { method: 'POST', body: fd });
        const d = await r.json(); if (!r.ok) throw new Error(d.erro); food = d; renderItens(); aviso('Foto salva.');
      }
    } catch (err) { aviso(err.message, false); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'rCupom') return;
    e.preventDefault();
    try { conta = await api('/api/painel/cupom-assinatura', 'POST', { codigo: e.target.codigo.value }); renderConta(); aviso('Cupom aplicado.'); } catch (err) { aviso(err.message, false); }
  });
  fetch('/api/planos').then((r) => r.json()).then((p) => {
    const f = p.food; if (!f) return;
    $('precoFood').textContent = `Plano FOOD PRO: ${brl(f.precoMensal)} por mês, sem comissão sobre os pedidos e sem limite de faturamento. 30 dias grátis.${f.campanha ? ` Cupom ${f.campanha.codigo}: ${brl(f.campanha.preco)} por mês.` : ''}`;
  }).catch(() => {});
  setInterval(() => { if (!document.hidden && food) recarregarFood().catch(() => {}); }, 20000);
  carregar();
})();
