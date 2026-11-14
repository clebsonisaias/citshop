// Gráfico do preço nos últimos dias (produtos de marketplace), na página do produto e no modal da home.
// Lê /api/preco/<id> (historico.json da coleta). Some quando há menos de 2 dias de histórico.
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const diaMes = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Desenha em `el` o histórico do produto `id` (null = esconde). Ignora a resposta se `el` já mudou de produto. */
export async function desenharHistorico(el, id) {
  if (!el) return;
  el.hidden = true; el.innerHTML = ''; el.dataset.historico = id ?? '';
  if (!id) return;
  let pontos = [];
  try { ({ pontos } = await fetch(`/api/preco/${encodeURIComponent(id)}`).then((r) => r.json())); } catch { return; }
  if (el.dataset.historico !== id || !(pontos?.length >= 2)) return;
  const precos = pontos.map(([, v]) => v), min = Math.min(...precos), max = Math.max(...precos), hoje = precos.at(-1), n = pontos.length;
  const titulo = document.createElement('h2');
  titulo.textContent = 'Histórico de preço';
  const texto = document.createElement('p');
  if (max === min) {
    texto.textContent = `Preço estável nos últimos ${n} dias: ${brl.format(hoje)}.`;
    el.replaceChildren(titulo, texto);
  } else {
    const W = 300, H = 80, P = 6, iMin = precos.lastIndexOf(min);
    const px = (i) => (P + (i / (n - 1)) * (W - 2 * P)).toFixed(1), py = (v) => (P + ((max - v) / (max - min)) * (H - 2 * P)).toFixed(1);
    const linha = precos.map((v, i) => `${px(i)},${py(v)}`).join(' ');
    const veredito = hoje <= min ? ' Hoje está no menor preço do período.' : hoje >= max ? ' Hoje está no maior preço do período.' : '';
    texto.textContent = `Últimos ${n} dias: menor ${brl.format(min)} em ${diaMes(pontos[iMin][0])}, maior ${brl.format(max)}. Hoje ${brl.format(hoje)}.${veredito}`;
    const grafico = document.createElement('div');
    grafico.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">
        <polygon class="area" points="${px(0)},${H} ${linha} ${px(n - 1)},${H}"/>
        <polyline class="linha" points="${linha}"/>
        <circle class="ponto-min" cx="${px(iMin)}" cy="${py(min)}" r="4"/>
        <circle class="ponto-hoje" cx="${px(n - 1)}" cy="${py(hoje)}" r="4"/>
      </svg><div class="hist-eixo" aria-hidden="true"><span>${diaMes(pontos[0][0])}</span><span>hoje</span></div>`;
    grafico.querySelector('svg').setAttribute('aria-label', texto.textContent);
    el.replaceChildren(titulo, ...grafico.childNodes, texto);
  }
  el.hidden = false;
}

// Página /p/<id>: o servidor põe <div class="hist" data-historico="<id>">.
document.querySelectorAll('.hist[data-historico]').forEach((el) => el.dataset.historico && desenharHistorico(el, el.dataset.historico));
