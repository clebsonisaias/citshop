// O que as pessoas buscam no site (só o texto, sem nada de quem buscou), somado por dia, para escolher o que postar.
// Fica em <DADOS_DIR>/buscas.json (60 dias). Contador na memória, gravado a cada minuto: busca não regrava o banco.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "para", "pra", "com", "em", "um", "uma", "no", "na"]);
/** "Capa de Celular!!" → "capa de celular". Curto demais, só número ou com cara de dado pessoal = null. */
export function normalizarBusca(q) {
  const t = String(q ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (t.length < 3 || !/[a-z]{3}/.test(t) || /\d{6,}/.test(t)) return null; // telefone, CPF, CEP etc. não entram
  return t;
}

export class Buscas {
  constructor({ dadosDir, agora = Date.now }) {
    Object.assign(this, { agora, arq: join(dadosDir, "buscas.json") });
    try { this.dias = JSON.parse(readFileSync(this.arq, "utf8")); } catch { this.dias = {}; }
    this.sujo = false;
  }
  registrar(q) {
    const termo = normalizarBusca(q);
    if (!termo) return false;
    const dia = new Date(this.agora() - 3 * 3600_000).toISOString().slice(0, 10);
    const d = (this.dias[dia] ??= {});
    if (!d[termo] && Object.keys(d).length >= 5000) return false; // teto por dia
    d[termo] = (d[termo] ?? 0) + 1;
    this.sujo = true;
    return true;
  }
  descarregar() {
    if (!this.sujo) return;
    const dias = Object.keys(this.dias).sort();
    for (const d of dias.slice(0, Math.max(0, dias.length - 60))) delete this.dias[d];
    writeFileSync(`${this.arq}.tmp`, JSON.stringify(this.dias));
    renameSync(`${this.arq}.tmp`, this.arq);
    this.sujo = false;
  }
  /**
   * Mais buscados dos últimos `dias`. Junta o que é começo de outra busca ("capa" e "capa de" contam para
   * "capa de celular" quando ela é a mais comum com esse começo), já que a busca registra enquanto a pessoa digita.
   */
  top(dias = 7, limite = 10) {
    const desde = new Date(this.agora() - 3 * 3600_000 - dias * 86_400_000).toISOString().slice(0, 10);
    const soma = {};
    for (const [dia, termos] of Object.entries(this.dias)) if (dia > desde) for (const [t, n] of Object.entries(termos)) soma[t] = (soma[t] ?? 0) + n;
    const termos = Object.keys(soma).sort((a, b) => b.length - a.length);
    for (const curto of [...termos].reverse()) {
      const longo = termos.filter((l) => l !== curto && l.startsWith(curto)).sort((a, b) => soma[b] - soma[a])[0];
      if (longo && soma[curto] != null) { soma[longo] += soma[curto]; delete soma[curto]; }
    }
    return Object.entries(soma).sort((a, b) => b[1] - a[1]).slice(0, limite).map(([termo, n]) => ({ termo, n, palavras: termo.split(" ").filter((p) => !PALAVRAS_VAZIAS.has(p)) }));
  }
}
