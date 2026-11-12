// Administração: lista de lojas, suspender/reativar, senha provisória e ocultar produto.
(() => {
  const { esc, brl } = window.CIT;
  const $ = (id) => document.getElementById(id);
  const ROTULO = { teste: 'Teste grátis', ativa: 'Pagante', vencida: 'Vencida', suspensa: 'Suspensa' };
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
    $('resumo').textContent = `${lojas.length} lojas · ${conta('ativa')} pagantes · ${conta('teste')} em teste · ${conta('vencida')} vencidas · ${conta('suspensa')} suspensas`;
    $('linhas').innerHTML = lojas.map((l) => `<tr>
      <td><b>${esc(l.nome)}</b><br><small class="note">${esc(l.cidade)} · desde ${data(l.criadaEm)}</small><br><a href="/loja/${esc(l.slug)}" target="_blank">ver página</a></td>
      <td>${esc(l.responsavel)}<br>${esc(l.email)}<br><a href="https://wa.me/${esc(l.whatsapp)}" target="_blank" rel="noopener">${esc(l.whatsapp)}</a></td>
      <td><span class="pill ${l.status}">${ROTULO[l.status]}</span><br><small class="note">teste até ${data(l.testeAte)}<br>MP: ${esc(l.assinatura?.status ?? 'nenhuma')}<br>${l.cliquesContatoLoja ?? 0} cliques no WhatsApp da loja</small></td>
      <td>${l.produtos.map((p) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
          <img src="${esc(p.foto)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px">
          <span style="flex:1">${esc(p.nome)} · ${brl.format(p.preco)}<br><small class="note">${esc(DISPONIBILIDADE[p.disponibilidade] ?? DISPONIBILIDADE.consulte)} · ${p.cliquesContato ?? 0} cliques WhatsApp${p.ativo ? '' : ' · pausado'}</small></span>
          <button class="btn sec" style="min-height:32px;padding:4px 8px;font-size:11px" data-bloq="${p.id}" data-v="${!p.bloqueado}">${p.bloqueado ? 'Mostrar' : 'Ocultar'}</button></div>`).join('') || '<small class="note">nenhum</small>'}</td>
      <td style="display:grid;gap:6px">
        <button class="btn sec" data-susp="${l.id}" data-v="${!l.suspensa}">${l.suspensa ? 'Reativar' : 'Suspender'}</button>
        <button class="btn sec" data-senha="${l.id}">Senha provisória</button>
        <button class="btn perigo" data-excluir="${l.id}">Excluir loja</button></td></tr>`).join('');
  }
  async function carregar() { lojas = await api('/api/admin/lojas'); render(); }

  $('linhas').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.susp) await api(`/api/admin/lojas/${b.dataset.susp}/suspensa`, 'POST', { suspensa: b.dataset.v === 'true' });
      if (b.dataset.bloq) await api(`/api/admin/produtos/${b.dataset.bloq}/bloqueado`, 'POST', { bloqueado: b.dataset.v === 'true' });
      if (b.dataset.excluir) {
        const loja = lojas.find((l) => l.id === b.dataset.excluir);
        if (!confirm(`Excluir ${loja.nome} com todos os produtos e fotos? Isso não pode ser desfeito.`)) return;
        await api(`/api/admin/lojas/${loja.id}`, 'DELETE');
      }
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
        });
        alert('Configurações do Instagram salvas com sucesso!');
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

  function iniciar() {
    carregar().then(() => {
      $('fEnt').hidden = true;
      $('vAdm').hidden = false;
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
