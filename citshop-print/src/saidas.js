// Saídas de impressão (camada de abstração): cada uma recebe um Buffer ESC/POS e resolve quando os bytes foram
// ENTREGUES (à impressora de rede ou ao spooler do sistema). Isso não prova que o papel saiu: a maioria das
// térmicas não devolve confirmação confiável, por isso o estado registrado é "enviado".
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executar = (cmd, args, timeout = 20_000) => new Promise((ok, falha) =>
  execFile(cmd, args, { timeout, windowsHide: true }, (e, out, err) => (e ? falha(new Error((err || e.message).trim().slice(0, 200))) : ok(out))));

/** Impressora de rede (Ethernet/Wi-Fi) na porta RAW 9100. */
export function enviarRede(bytes, { host, porta = 9100, timeout = 8000 }) {
  return new Promise((ok, falha) => {
    const s = createConnection({ host, port: porta });
    const fim = (e) => { s.destroy(); e ? falha(e) : ok(); };
    s.setTimeout(timeout, () => fim(new Error(`Impressora ${host}:${porta} não respondeu`)));
    s.on("error", (e) => fim(new Error(e.code === "ECONNREFUSED" ? `Impressora ${host}:${porta} recusou a conexão (desligada?)` : e.message)));
    s.on("connect", () => s.end(bytes, () => fim()));
  });
}

// Windows: escreve RAW direto no spooler pela API winspool (funciona com USB, rede e compartilhada, sem compartilhar).
const PS_RAW = `
param([string]$Impressora, [string]$Arquivo)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class CitRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr h, int l, DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Enviar(string impressora, byte[] dados) {
    IntPtr h; if (!OpenPrinter(impressora, out h, IntPtr.Zero)) throw new Exception("Impressora nao encontrada: " + impressora);
    try {
      var di = new DOCINFO { pDocName = "CITshop Food", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("Spooler recusou o trabalho");
      StartPagePrinter(h); int w; bool ok = WritePrinter(h, dados, dados.Length, out w); EndPagePrinter(h); EndDocPrinter(h);
      if (!ok || w != dados.Length) throw new Exception("Falha ao escrever na impressora");
    } finally { ClosePrinter(h); }
  }
}
"@
[CitRaw]::Enviar($Impressora, [IO.File]::ReadAllBytes($Arquivo))
`;
async function comArquivo(bytes, fn) {
  const dir = mkdtempSync(join(tmpdir(), "citprint-"));
  try { const f = join(dir, "comanda.bin"); writeFileSync(f, bytes); return await fn(f, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
export function enviarSistema(bytes, { impressora }, plataforma = process.platform) {
  return comArquivo(bytes, async (arquivo, dir) => {
    if (plataforma === "win32") {
      const script = join(dir, "raw.ps1");
      writeFileSync(script, PS_RAW);
      await executar("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Impressora", impressora, "-Arquivo", arquivo]);
    } else await executar("lp", ["-d", impressora, "-o", "raw", arquivo]); // macOS/Linux (CUPS)
  });
}

/** Impressoras instaladas no sistema (nomes). Térmica por USB aparece aqui depois de instalado o driver do fabricante. */
export async function listarImpressoras(plataforma = process.platform) {
  try {
    if (plataforma === "win32") return (await executar("powershell.exe", ["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"])).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return (await executar("lpstat", ["-a"])).split("\n").map((l) => l.split(" ")[0]).filter(Boolean);
  } catch { return []; }
}

/** Envia conforme a configuração: { tipo: "rede", host, porta } ou { tipo: "sistema", impressora }. */
export function enviar(bytes, destino) {
  if (destino?.tipo === "rede") return enviarRede(bytes, destino);
  if (destino?.tipo === "sistema" && destino.impressora) return enviarSistema(bytes, destino);
  return Promise.reject(new Error("Nenhuma impressora configurada"));
}
