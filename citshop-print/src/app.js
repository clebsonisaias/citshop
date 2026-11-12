// CITshop Print: roda no computador do restaurante. Busca os pedidos a imprimir a cada 5 s e manda para a impressora.
// Configuração pelo navegador em http://127.0.0.1:17777 (só este computador). Sem dependências: Node 22.
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { Agente, VERSAO, pastaPadrao } from "./agente.js";
import { listarImpressoras } from "./saidas.js";

const PORTA = Number(process.env.CITPRINT_PORTA ?? 17777);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function criarInterface(agente) {
  return createServer(async (req, res) => {
    // Só aceita o próprio computador e bloqueia páginas de outros sites (DNS rebinding e formulários forjados).
    const host = String(req.headers.host ?? "");
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403).end(); return; }
    const json = (st, d) => { res.writeHead(st, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(d)); };
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'", "X-Frame-Options": "DENY" }).end(PAGINA);
      return;
    }
    if (req.method === "GET" && req.url === "/app.js") { res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(SCRIPT); return; }
    if (req.method === "GET" && req.url === "/estado") {
      return json(200, { versao: VERSAO, vinculado: agente.vinculado, restaurante: agente.cfg.restaurante ?? null, servidor: agente.cfg.servidor, destino: agente.cfg.destino, largura: agente.cfg.largura,
        automatico: agente.cfg.automatico, ...agente.estado, historico: agente.historico(), impressoras: await listarImpressoras() });
    }
    if (req.method !== "POST" || req.headers["x-cit"] !== "1") { res.writeHead(404).end(); return; } // cabeçalho próprio: navegador de outro site não consegue mandar
    let corpo = "";
    for await (const p of req) { corpo += p; if (corpo.length > 10_000) { res.writeHead(413).end(); return; } }
    const b = (() => { try { return JSON.parse(corpo || "{}"); } catch { return {}; } })();
    try {
      if (req.url === "/vincular") return json(200, { restaurante: await agente.vincular(String(b.codigo ?? ""), String(b.dispositivo ?? "Computador do caixa")) });
      if (req.url === "/desvincular") { agente.desvincular(); return json(200, { ok: true }); }
      if (req.url === "/configurar") { agente.configurar(b); return json(200, { ok: true }); }
      if (req.url === "/testar") { await agente.testar(); return json(200, { ok: true }); }
      if (req.url === "/reimprimir") { await agente.reimprimirLocal(String(b.id ?? "")); return json(200, { ok: true }); }
      res.writeHead(404).end();
    } catch (e) { json(400, { erro: e.message }); }
  });
}

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CITshop Print</title>
<style>body{font:16px system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#0b2e35}h1{margin:0 0 4px}section{border:1px solid #dae7e5;border-radius:12px;padding:14px;margin:14px 0}
label{display:grid;gap:4px;font-weight:600;margin:8px 0}input,select{min-height:42px;font-size:16px;padding:0 10px;border:1.5px solid #c9d9d6;border-radius:10px}
button{min-height:44px;padding:0 16px;border:0;border-radius:10px;background:#036271;color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin:4px 4px 0 0}button.sec{background:#e7efee;color:#0b2e35}
.ok{color:#0a7a4f;font-weight:700}.erro{color:#9a3a1c;font-weight:700}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #eee;padding:6px;text-align:left}</style></head>
<body><h1>CITshop Print</h1><p id="status">Carregando…</p>
<section id="sVinculo"><h2>1. Vincular ao restaurante</h2><p>No painel do restaurante, em <b>Cozinha e impressão</b>, toque em <b>Gerar código da impressora</b> e digite o código aqui.</p>
<label>Código<input id="codigo" maxlength="12" autocomplete="off"></label><label>Nome deste computador<input id="disp" value="Computador do caixa"></label><button id="bVincular">Vincular</button></section>
<section><h2>2. Impressora</h2><label>Tipo<select id="tipo"><option value="sistema">Instalada neste computador (USB ou compartilhada)</option><option value="rede">Na rede (IP, porta 9100)</option></select></label>
<label id="lImp">Impressora<select id="imp"></select></label><label id="lHost" hidden>Endereço IP da impressora<input id="host" placeholder="192.168.0.50"></label>
<label>Largura do papel<select id="larg"><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
<label><span><input type="checkbox" id="auto"> Imprimir os pedidos automaticamente</span></label>
<button id="bSalvar">Salvar</button><button class="sec" id="bTeste">Imprimir teste</button></section>
<section><h2>Histórico</h2><table><thead><tr><th>Pedido</th><th>Tipo</th><th>Situação</th><th>Quando</th><th></th></tr></thead><tbody id="hist"></tbody></table></section>
<p><button class="sec" id="bDesv">Desvincular este computador</button></p><script src="/app.js"></script></body></html>`;

const SCRIPT = `const $=(i)=>document.getElementById(i);const post=async(u,b)=>{const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json','X-CIT':'1'},body:JSON.stringify(b||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||'Falhou');return d};
const SIT={recebido:'Na fila',enviado:'Enviado à impressora',reportado:'Enviado à impressora',erro:'Erro'};let carregado=false;
async function estado(){const e=await (await fetch('/estado')).json();
$('status').innerHTML=e.vinculado?('Vinculado a <b>'+esc(e.restaurante||'')+'</b> · '+(e.online?'<span class=ok>conectado</span>':'<span class=erro>sem conexão com o CITshop</span>')+(e.ultimoErro?' · <span class=erro>'+esc(e.ultimoErro)+'</span>':'')):'<span class=erro>Ainda não vinculado.</span>';
$('sVinculo').hidden=e.vinculado;
if(!carregado){carregado=true;$('imp').innerHTML=e.impressoras.map(n=>'<option>'+esc(n)+'</option>').join('')||'<option value="">Nenhuma impressora encontrada</option>';
 if(e.destino){$('tipo').value=e.destino.tipo;if(e.destino.impressora)$('imp').value=e.destino.impressora;if(e.destino.host)$('host').value=e.destino.host}
 $('larg').value=String(e.largura);$('auto').checked=e.automatico;troca()}
$('hist').innerHTML=e.historico.map(t=>'<tr><td>#'+esc(t.numero)+'</td><td>'+esc(t.tipo)+(t.manual?' (reimpressão)':'')+'</td><td>'+(SIT[t.estado]||t.estado)+(t.erro?' · '+esc(t.erro):'')+'</td><td>'+new Date(t.recebidoEm).toLocaleString('pt-BR')+'</td><td><button class=sec data-re="'+esc(t.id)+'">Reimprimir</button></td></tr>').join('')}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function troca(){const r=$('tipo').value==='rede';$('lHost').hidden=!r;$('lImp').hidden=r}
$('tipo').onchange=troca;
const tenta=(fn)=>async()=>{try{await fn();await estado()}catch(e){alert(e.message)}};
$('bVincular').onclick=tenta(async()=>{const d=await post('/vincular',{codigo:$('codigo').value,dispositivo:$('disp').value});alert('Vinculado a '+d.restaurante)});
$('bSalvar').onclick=tenta(async()=>{const rede=$('tipo').value==='rede';await post('/configurar',{destino:rede?{tipo:'rede',host:$('host').value.trim(),porta:9100}:{tipo:'sistema',impressora:$('imp').value},largura:$('larg').value,automatico:$('auto').checked});alert('Salvo')});
$('bTeste').onclick=tenta(async()=>{await post('/testar');alert('Teste enviado à impressora')});
$('bDesv').onclick=tenta(async()=>{if(confirm('Desvincular este computador? Os pedidos param de imprimir aqui.'))await post('/desvincular')});
document.addEventListener('click',tenta(async(ev)=>{const b=ev.target.closest('[data-re]');if(b)await post('/reimprimir',{id:b.dataset.re})}));
estado();setInterval(estado,5000);`;

// Ponto de entrada: `node src/app.js` (ou o executável do Windows gerado com Node SEA).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("citshop-print.exe")) {
  const agente = new Agente({ dir: pastaPadrao(), servidor: process.env.CITPRINT_SERVIDOR ?? "https://shop.citmax.com.br" });
  criarInterface(agente).listen(PORTA, "127.0.0.1", () => {
    console.log(`CITshop Print ${VERSAO} — configure em http://127.0.0.1:${PORTA}`);
    if (!agente.vinculado && process.platform === "win32") exec(`start http://127.0.0.1:${PORTA}`);
  });
  let rodando = false;
  const ciclo = async () => { if (rodando) return; rodando = true; try { await agente.ciclo(); } finally { rodando = false; } };
  ciclo(); setInterval(ciclo, 5000);
  agente.batimento(); setInterval(() => agente.batimento(), 30_000);
}
