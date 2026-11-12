// Editor visual de personalização (CITshop Food): grupos, opções, tamanhos/variações com regras próprias, estoque,
// cardápio do dia. O restaurante define tudo; o servidor revalida. Uso: CITEditorFood.abrir(elemento, item, aoMudar).
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => String(v ?? '').replace('.', ',');
  const REGRA = { soma: 'Somar os adicionais', maior: 'Cobrar pelo mais caro (ex.: pizza meio a meio)', media: 'Cobrar a média dos escolhidos' };
  let estado = null, raiz = null, aoMudar = () => {};

  const novoGrupo = () => ({ nome: '', descricao: '', tipo: 'escolha', min: 0, max: 1, regra: 'soma', incluidas: 0, estacao: '', ativo: true, opcoes: [{ nome: '', preco: 0, maxQtd: 1, estoque: null, datas: [], ativo: true }] });
  function render() {
    const s = estado;
    raiz.innerHTML = `
      <fieldset class="ed-bloco"><legend>Tamanhos ou variações <small>opcional · cada um com preço e regras próprias</small></legend>
        ${s.variacoes.map((v, i) => `<div class="ed-linha">
          <input aria-label="Nome do tamanho" data-v="${i}" data-c="nome" value="${esc(v.nome)}" placeholder="Ex.: Pequena, 500 ml">
          <input aria-label="Preço" data-v="${i}" data-c="preco" value="${num(v.preco)}" inputmode="decimal" placeholder="R$">
          <label class="ed-ck"><input type="checkbox" data-v="${i}" data-c="ativo" ${v.ativo !== false ? 'checked' : ''}> Ativo</label>
          <button type="button" class="ed-x" data-acao="tirar-v" data-i="${i}" aria-label="Remover tamanho">×</button>
          ${s.grupos.length ? `<details class="ed-regras"><summary>Regras deste tamanho</summary>${s.grupos.map((g) => {
            const r = v.grupos?.[g.id] ?? {};
            return `<div class="ed-linha"><span>${esc(g.nome || 'Grupo')}</span>
              <label>mín <input data-v="${i}" data-g="${esc(g.id)}" data-c="min" value="${r.min ?? ''}" placeholder="${g.min}" inputmode="numeric"></label>
              <label>máx <input data-v="${i}" data-g="${esc(g.id)}" data-c="max" value="${r.max ?? ''}" placeholder="${g.max}" inputmode="numeric"></label>
              <label class="ed-ck"><input type="checkbox" data-v="${i}" data-g="${esc(g.id)}" data-c="ativo" ${r.ativo === false ? '' : 'checked'}> usa</label></div>`;
          }).join('')}<p class="note">Em branco = igual ao grupo. Salve o item uma vez para criar os grupos antes de ajustar por tamanho.</p></details>` : ''}
        </div>`).join('')}
        <button type="button" class="btn sec" data-acao="mais-v">+ Tamanho/variação</button>
      </fieldset>
      ${s.grupos.map((g, i) => `<fieldset class="ed-bloco ed-grupo"><legend>Grupo ${i + 1}</legend>
        <div class="ed-linha">
          <input aria-label="Nome do grupo" data-g="${i}" data-c="nome" value="${esc(g.nome)}" placeholder="Ex.: Proteínas, Sabores, Molhos">
          <select aria-label="Tipo" data-g="${i}" data-c="tipo"><option value="escolha" ${g.tipo !== 'remover' ? 'selected' : ''}>Escolha</option><option value="remover" ${g.tipo === 'remover' ? 'selected' : ''}>Retirar ingredientes</option></select>
          <span class="ed-ord"><button type="button" class="ed-x" data-acao="subir" data-i="${i}" aria-label="Subir grupo">↑</button><button type="button" class="ed-x" data-acao="descer" data-i="${i}" aria-label="Descer grupo">↓</button><button type="button" class="ed-x" data-acao="tirar-g" data-i="${i}" aria-label="Remover grupo">×</button></span>
        </div>
        <input aria-label="Descrição do grupo" data-g="${i}" data-c="descricao" value="${esc(g.descricao)}" placeholder="Descrição (opcional)">
        <div class="ed-linha">
          <label>Mínimo<input data-g="${i}" data-c="min" value="${g.min}" inputmode="numeric"></label>
          <label>Máximo<input data-g="${i}" data-c="max" value="${g.max}" inputmode="numeric"></label>
          <label>Sem custo<input data-g="${i}" data-c="incluidas" value="${g.incluidas ?? 0}" inputmode="numeric" title="Quantas escolhas já estão incluídas no preço"></label>
          <label>Estação<input data-g="${i}" data-c="estacao" value="${esc(g.estacao ?? '')}" placeholder="chapa, forno"></label>
        </div>
        <label>Preço do grupo<select data-g="${i}" data-c="regra">${Object.entries(REGRA).map(([k, t]) => `<option value="${k}" ${g.regra === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <p class="note">${g.min > 0 ? `Obrigatório: escolher ${g.min === g.max ? g.min : `de ${g.min} a ${g.max}`}.` : `Opcional: até ${g.max}.`}${g.incluidas ? ` ${g.incluidas} sem custo.` : ''}</p>
        <div class="ed-opcoes">${g.opcoes.map((o, j) => `<div class="ed-linha ed-op">
          <input aria-label="Opção" data-g="${i}" data-o="${j}" data-c="nome" value="${esc(o.nome)}" placeholder="Opção">
          <input aria-label="Preço adicional" data-g="${i}" data-o="${j}" data-c="preco" value="${num(o.preco)}" inputmode="decimal" placeholder="+ R$">
          <input aria-label="Máximo por opção" data-g="${i}" data-o="${j}" data-c="maxQtd" value="${o.maxQtd ?? 1}" inputmode="numeric" title="Quantas vezes pode repetir">
          <input aria-label="Estoque" data-g="${i}" data-o="${j}" data-c="estoque" value="${o.estoque ?? ''}" inputmode="numeric" placeholder="estoque">
          <input aria-label="Datas (cardápio do dia)" data-g="${i}" data-o="${j}" data-c="datas" value="${esc((o.datas ?? []).join(', '))}" placeholder="todo dia">
          <label class="ed-ck"><input type="checkbox" data-g="${i}" data-o="${j}" data-c="ativo" ${o.ativo !== false ? 'checked' : ''}> Tem</label>
          <button type="button" class="ed-x" data-acao="tirar-o" data-i="${i}" data-j="${j}" aria-label="Remover opção">×</button></div>`).join('')}
          <button type="button" class="btn sec" data-acao="mais-o" data-i="${i}">+ Opção</button></div>
      </fieldset>`).join('')}
      <p><button type="button" class="btn sec" data-acao="mais-g">+ Grupo de opções</button></p>
      <p class="note ed-legenda">Colunas das opções: nome · preço adicional · quantas vezes pode repetir · estoque (vazio = sem controle) · datas do cardápio do dia (vazio = todo dia) · disponível.</p>`;
    aoMudar(estado);
  }
  function ler(e) {
    const t = e.target, c = t.dataset.c;
    if (!c) return;
    const valor = t.type === 'checkbox' ? t.checked : t.value;
    const inteiro = (v) => (v === '' ? '' : Math.max(0, Math.floor(Number(v) || 0)));
    if (t.dataset.v != null && t.dataset.g != null) { // regra do tamanho para um grupo
      const v = estado.variacoes[t.dataset.v], r = ((v.grupos ??= {})[t.dataset.g] ??= {});
      if (c === 'ativo') { if (valor) delete r.ativo; else r.ativo = false; } else if (valor === '') delete r[c]; else r[c] = inteiro(valor);
    } else if (t.dataset.v != null) estado.variacoes[t.dataset.v][c] = c === 'preco' ? valor : valor;
    else if (t.dataset.o != null) {
      const o = estado.grupos[t.dataset.g].opcoes[t.dataset.o];
      o[c] = c === 'datas' ? valor.split(/[,\s]+/).filter(Boolean) : c === 'estoque' ? (valor === '' ? null : inteiro(valor)) : c === 'maxQtd' ? Math.max(1, inteiro(valor) || 1) : valor;
    } else if (t.dataset.g != null) estado.grupos[t.dataset.g][c] = ['min', 'max', 'incluidas'].includes(c) ? inteiro(valor) : valor;
    if (t.tagName === 'SELECT' || ['min', 'max', 'incluidas'].includes(c)) render(); else aoMudar(estado);
  }
  function acao(e) {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const i = Number(b.dataset.i), j = Number(b.dataset.j), g = estado.grupos;
    ({
      'mais-v': () => estado.variacoes.push({ nome: '', preco: '', ativo: true, grupos: {} }),
      'tirar-v': () => estado.variacoes.splice(i, 1),
      'mais-g': () => g.push(novoGrupo()),
      'tirar-g': () => confirm('Remover este grupo e suas opções?') && g.splice(i, 1),
      subir: () => i > 0 && g.splice(i - 1, 0, g.splice(i, 1)[0]),
      descer: () => i < g.length - 1 && g.splice(i + 1, 0, g.splice(i, 1)[0]),
      'mais-o': () => g[i].opcoes.push({ nome: '', preco: 0, maxQtd: 1, estoque: null, datas: [], ativo: true }),
      'tirar-o': () => g[i].opcoes.splice(j, 1),
    })[b.dataset.acao]?.();
    render();
  }
  window.CITEditorFood = {
    abrir(el, item, mudou) {
      raiz = el; aoMudar = mudou ?? (() => {});
      estado = JSON.parse(JSON.stringify({ variacoes: item?.variacoes ?? [], grupos: item?.grupos ?? [] }));
      if (!raiz.dataset.ligado) { raiz.addEventListener('input', ler); raiz.addEventListener('change', ler); raiz.addEventListener('click', acao); raiz.dataset.ligado = '1'; }
      render();
    },
    /** Aplica os grupos de um modelo (cópia). */
    usarGrupos(grupos) { estado.grupos = JSON.parse(JSON.stringify(grupos)); render(); },
    valor() {
      const limpo = JSON.parse(JSON.stringify(estado));
      limpo.grupos = limpo.grupos.map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => String(o.nome).trim()) })).filter((g) => String(g.nome).trim() && g.opcoes.length);
      limpo.variacoes = limpo.variacoes.filter((v) => String(v.nome).trim());
      return limpo;
    },
  };
})();
