/**
 * Segurança num arquivo só: cabeçalhos, senha, sessão em cookie assinado,
 * limitador de tentativas e conferência de origem.
 * Adaptado de lista-convidados/servidor/seguranca.js; aqui a sessão carrega
 * o tipo (loja ou admin) e o id.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PARAMS_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

const CSP = [
  "default-src 'none'",
  "img-src 'self' data: https:", // fotos dos afiliados vêm dos CDNs das lojas
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

export function ehHttps(req) {
  return String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "").split(",")[0].trim() === "https";
}

export function aplicarCabecalhos(req, res) {
  res.removeHeader("X-Powered-By");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), payment=()");
  if (/^\/(painel|admin|api)/.test(req.path)) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (ehHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

/** Formato `scrypt.N.r.p.<sal>.<hash>`: ponto em vez de `$` porque o Coolify interpola `$` em env vars. */
export function gerarHashSenha(senha) {
  const sal = randomBytes(16);
  const hash = scryptSync(String(senha), sal, 32, PARAMS_SCRYPT);
  const { N, r, p } = PARAMS_SCRYPT;
  return `scrypt.${N}.${r}.${p}.${sal.toString("base64url")}.${hash.toString("base64url")}`;
}

export function conferirSenha(senha, guardado) {
  try {
    const partes = String(guardado ?? "").split(".");
    if (partes.length !== 6 || partes[0] !== "scrypt") return false;
    const [, n, r, p, sal64, hash64] = partes;
    const sal = Buffer.from(sal64, "base64url");
    const esperado = Buffer.from(hash64, "base64url");
    if (!sal.length || !esperado.length) return false;
    const calculado = scryptSync(String(senha ?? ""), sal, esperado.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS_SCRYPT.maxmem,
    });
    return timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}

// Hash fixo para gastar o mesmo tempo quando o e-mail não existe.
export const HASH_FALSO = gerarHashSenha(randomBytes(12).toString("hex"));

const assinar = (carga, segredo) => createHmac("sha256", segredo).update(carga).digest("base64url");

export function criarSessao({ segredo, dados, dias = 30, agora = Date.now() }) {
  const carga = Buffer.from(JSON.stringify({ v: 1, e: agora + dias * 86_400_000, ...dados })).toString("base64url");
  return `${carga}.${assinar(carga, segredo)}`;
}

/** Devolve os dados da sessão ou null. */
export function lerSessao(valor, { segredo, agora = Date.now() }) {
  if (typeof valor !== "string") return null;
  const corte = valor.lastIndexOf(".");
  if (corte <= 0) return null;
  const recebida = Buffer.from(valor.slice(corte + 1));
  const esperada = Buffer.from(assinar(valor.slice(0, corte), segredo));
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const dados = JSON.parse(Buffer.from(valor.slice(0, corte), "base64url").toString("utf8"));
    return dados.v === 1 && Number.isFinite(dados.e) && dados.e > agora ? dados : null;
  } catch {
    return null;
  }
}

export function cookie({ nome, valor, caminho, https, dias = 30 }) {
  const partes = [`${nome}=${valor}`, `Path=${caminho}`, "HttpOnly", "SameSite=Lax", `Max-Age=${valor ? dias * 86_400 : 0}`];
  if (https) partes.push("Secure");
  return partes.join("; ");
}

export function lerCookies(cabecalho) {
  const saida = Object.create(null);
  for (const parte of String(cabecalho ?? "").split(";")) {
    const corte = parte.indexOf("=");
    if (corte < 1) continue;
    const nome = parte.slice(0, corte).trim();
    const bruto = parte.slice(corte + 1).trim();
    try { saida[nome] = decodeURIComponent(bruto); } catch { saida[nome] = bruto; }
  }
  return saida;
}

/** Janela deslizante em memória; zera a cada redeploy. */
export class Limitador {
  #janelas = new Map();
  constructor({ maximo, janelaMs }) { this.maximo = maximo; this.janelaMs = janelaMs; }
  registrar(chave, agora = Date.now()) {
    if (this.#janelas.size > 5000) {
      for (const [k, m] of this.#janelas) if (m.every((t) => agora - t >= this.janelaMs)) this.#janelas.delete(k);
    }
    const marcas = (this.#janelas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    if (marcas.length >= this.maximo) { this.#janelas.set(chave, marcas); return { permitido: false }; }
    marcas.push(agora);
    this.#janelas.set(chave, marcas);
    return { permitido: true };
  }
  liberar(chave) { this.#janelas.delete(chave); }
}

/** A escrita veio da própria página? Compara só o hostname e aceita X-Forwarded-Host (Traefik). */
export function origemConfiavel(req) {
  const origem = req.headers.origin;
  if (!origem || origem === "null") return true;
  let vinda;
  try { vinda = new URL(origem).hostname; } catch { return false; }
  return [req.headers["x-forwarded-host"], req.headers.host]
    .filter(Boolean).flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean)
    .some((c) => { try { return new URL(`http://${c}`).hostname === vinda; } catch { return false; } });
}

// IP do cliente pelo req.ip do Express (trust proxy = 1: vale o que o nosso proxy anexou). O primeiro valor de
// X-Forwarded-For vem do próprio cliente e dava para trocar a cada tentativa e burlar os limites.
export function ipDe(req) {
  return req.ip || "desconhecido";
}
