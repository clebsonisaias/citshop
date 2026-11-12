// Núcleo do CITshop Print: vínculo com o restaurante, fila local persistente e envio à impressora.
// Garantias:
// - Nada se perde: o servidor só tira um trabalho da fila quando o app confirma "enviado"; queda de internet,
//   impressora desligada ou computador desligado deixam o trabalho pendente lá.
// - Sem impressão duplicada: antes de avisar o servidor, o app grava no disco que já enviou aquele trabalho.
//   Se cair entre enviar e avisar, ao voltar ele só avisa (não imprime de novo).
// - Erro de impressora: avisa o servidor (aparece no painel), espera com intervalo crescente e tenta de novo.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { comandaEscPos, paginaTeste } from "./escpos.js";
import { enviar as enviarPadrao } from "./saidas.js";

export const VERSAO = "1.0.0";
const MAX_HISTORICO = 500, DIA = 24 * 60 * 60 * 1000;

// Token guardado cifrado pelo Windows (DPAPI, só este usuário deste computador). Em outros sistemas, arquivo 0600.
function protegerPadrao(texto) {
  if (process.platform !== "win32") return { claro: texto };
  const ps = `ConvertTo-SecureString -String $env:CIT_T -AsPlainText -Force | ConvertFrom-SecureString`;
  return { dpapi: execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { env: { ...process.env, CIT_T: texto }, windowsHide: true }).toString().trim() };
}
function abrirPadrao(g) {
  if (g?.claro) return g.claro;
  if (!g?.dpapi) return null;
  const ps = `$s = ConvertTo-SecureString $env:CIT_T; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { env: { ...process.env, CIT_T: g.dpapi }, windowsHide: true }).toString().trim();
}

export class Agente {
  constructor({ dir, servidor = "https://shop.citmax.com.br", enviar = enviarPadrao, fetchImpl = fetch, agora = Date.now, proteger = protegerPadrao, abrir = abrirPadrao, log = console }) {
    Object.assign(this, { dir, enviar, fetchImpl, agora, proteger, abrir, log });
    mkdirSync(dir, { recursive: true });
    this.cfg = this.lerJson("config.json", { servidor, largura: 80, automatico: true, destino: null });
    this.fila = this.lerJson("fila.json", { trabalhos: {} });
    this.estado = { online: false, ultimoErro: null, ultimoCiclo: null };
  }
  lerJson(nome, padrao) { try { return JSON.parse(readFileSync(join(this.dir, nome), "utf8")); } catch { return padrao; } }
  gravar(nome, dados) {
    const f = join(this.dir, nome), tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(dados, null, 1), { mode: 0o600 });
    renameSync(tmp, f);
    try { chmodSync(f, 0o600); } catch { /* Windows */ }
  }
  salvarCfg() { this.gravar("config.json", this.cfg); }
  salvarFila() {
    const lista = Object.values(this.fila.trabalhos).sort((a, b) => a.recebidoEm.localeCompare(b.recebidoEm));
    for (const t of lista.slice(0, Math.max(0, lista.length - MAX_HISTORICO))) if (t.estado === "reportado") delete this.fila.trabalhos[t.id];
    this.gravar("fila.json", this.fila);
  }
  get token() { return this.cfg.token ? this.abrir(this.cfg.token) : null; }
  set token(t) { this.cfg.token = t ? this.proteger(t) : null; this.cfg.tokenEm = new Date(this.agora()).toISOString(); }
  get vinculado() { return Boolean(this.cfg.token); }

  async api(caminho, metodo = "GET", corpo, { semToken = false } = {}) {
    const r = await this.fetchImpl(`${this.cfg.servidor}${caminho}`, {
      method: metodo, headers: { "Content-Type": "application/json", ...(semToken ? {} : { Authorization: `Bearer ${this.token}` }) },
      body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(15_000),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !semToken) { this.token = null; this.salvarCfg(); }
    if (!r.ok) throw Object.assign(new Error(d.erro || `Servidor respondeu ${r.status}`), { status: r.status });
    return d;
  }

  async vincular(codigo, dispositivo = "Computador do caixa") {
    const d = await this.api("/api/print/vincular", "POST", { codigo, dispositivo }, { semToken: true });
    this.token = d.token; Object.assign(this.cfg, { restaurante: d.restaurante, acessoId: d.acessoId });
    this.salvarCfg();
    return d.restaurante;
  }
  desvincular() { Object.assign(this.cfg, { token: null, restaurante: null, acessoId: null }); this.salvarCfg(); }
  configurar({ destino, largura, automatico }) {
    if (destino !== undefined) this.cfg.destino = destino;
    if ([58, 80].includes(Number(largura))) this.cfg.largura = Number(largura);
    if (automatico !== undefined) this.cfg.automatico = Boolean(automatico);
    this.salvarCfg();
  }
  async testar() { await this.enviar(paginaTeste({ largura: this.cfg.largura, impressora: this.cfg.destino?.impressora ?? this.cfg.destino?.host ?? "" }), this.cfg.destino); }

  /** Avisa o servidor do resultado; se a internet cair, fica para o próximo ciclo. */
  async reportar(t) {
    try {
      await this.api(`/api/print/trabalhos/${encodeURIComponent(t.id)}`, "POST", t.estado === "erro" ? { status: "erro", erro: t.erro } : { status: "enviado" });
      if (t.estado === "enviado") { t.estado = "reportado"; t.reportadoEm = new Date(this.agora()).toISOString(); }
      else t.erroReportado = true;
    } catch (e) { this.estado.ultimoErro = `Sem conexão com o CITshop: ${e.message}`; }
  }
  async imprimir(t) {
    try {
      await this.enviar(comandaEscPos(t.comanda, { largura: this.cfg.largura, reimpressao: t.manual }), this.cfg.destino);
      Object.assign(t, { estado: "enviado", enviadoEm: new Date(this.agora()).toISOString(), erro: null });
    } catch (e) {
      t.tentativas = (t.tentativas ?? 0) + 1;
      Object.assign(t, { estado: "erro", erro: e.message.slice(0, 200), erroReportado: false, proximaEm: this.agora() + Math.min(5 * 60_000, 15_000 * 2 ** (t.tentativas - 1)) });
      this.estado.ultimoErro = e.message;
    }
    this.salvarFila(); // grava ANTES de avisar o servidor (proteção contra impressão duplicada)
    await this.reportar(t);
    this.salvarFila();
  }

  /** Um ciclo: renova o token se precisar, busca trabalhos, imprime os novos e reenvia avisos pendentes. */
  async ciclo() {
    this.estado.ultimoCiclo = new Date(this.agora()).toISOString();
    if (!this.vinculado) return;
    try {
      if (this.agora() - Date.parse(this.cfg.tokenEm ?? 0) > DIA) { this.token = (await this.api("/api/print/renovar", "POST")).token; this.salvarCfg(); }
      const pendentes = await this.api("/api/print/trabalhos");
      this.estado.online = true;
      for (const j of pendentes) {
        const t = (this.fila.trabalhos[j.id] ??= { ...j, estado: "recebido", recebidoEm: new Date(this.agora()).toISOString() });
        if (t.estado === "enviado" || t.estado === "reportado") { t.estado = "enviado"; await this.reportar(t); continue; } // já saiu: só avisa
        if (!this.cfg.automatico && !t.manual) continue;
        if (t.estado === "erro" && t.proximaEm > this.agora()) continue;
        await this.imprimir(t);
      }
      for (const t of Object.values(this.fila.trabalhos)) if ((t.estado === "enviado") || (t.estado === "erro" && !t.erroReportado)) await this.reportar(t);
      this.salvarFila();
    } catch (e) { this.estado.online = false; this.estado.ultimoErro = e.message; }
  }
  async batimento() {
    if (!this.vinculado) return;
    const d = this.cfg.destino;
    await this.api("/api/print/batimento", "POST", { impressora: d?.impressora ?? (d?.host ? `${d.host}:${d.porta ?? 9100}` : ""), largura: this.cfg.largura, versaoApp: VERSAO, estado: this.estado.ultimoErro ?? "ok" }).catch(() => {});
  }
  historico() { return Object.values(this.fila.trabalhos).sort((a, b) => b.recebidoEm.localeCompare(a.recebidoEm)).slice(0, 100).map(({ comanda, ...t }) => ({ ...t, numero: comanda?.numero })); }
  /** Reimpressão local (sem passar pelo servidor) de um trabalho do histórico; não muda o estado registrado. */
  async reimprimirLocal(id) { const t = this.fila.trabalhos[id]; if (!t) throw new Error("Trabalho não encontrado"); await this.enviar(comandaEscPos(t.comanda, { largura: this.cfg.largura, reimpressao: true }), this.cfg.destino); }
}
export const pastaPadrao = () => (process.platform === "win32" ? join(process.env.APPDATA ?? ".", "CITshopPrint") : join(process.env.HOME ?? ".", ".citshop-print"));
export const existe = existsSync;
