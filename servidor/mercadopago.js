/**
 * Assinatura mensal das lojas via Mercado Pago (preapproval), com fetch puro.
 * Baseado em atendehub/apps/api/src/services/mercadoPagoService.ts.
 * Sem MP_ACCESS_TOKEN o cliente fica "não configurado" e o painel avisa em vez de quebrar.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE = "https://api.mercadopago.com";

/** Tokens das lojas ficam cifrados no JSON (AES-256-GCM, chave derivada do SESSAO_SEGREDO). */
const chave = (segredo) => createHash("sha256").update(`mp-oauth|${segredo}`).digest();
export function cifrar(texto, segredo) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(segredo), iv);
  const dados = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64url")).join(".");
}
export function decifrar(guardado, segredo) {
  const [iv, tag, dados] = String(guardado).split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", chave(segredo), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}

/**
 * token: da CIT (assinaturas). clientId/clientSecret: aplicativo de marketplace da CIT no Mercado Pago, usado
 * para a loja autorizar (OAuth) e para cobrar em nome dela. O split só existe quando o pagamento é criado com
 * o token da loja: o valor cai na conta dela e o marketplace_fee/application_fee vai para a CIT.
 */
export function criarMercadoPago({ token, clientId = null, clientSecret = null, fetchImpl = fetch }) {
  async function mp(caminho, init = {}, tokenUso = token) {
    const res = await fetchImpl(`${BASE}${caminho}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(tokenUso ? { Authorization: `Bearer ${tokenUso}` } : {}), ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) throw new Error(corpo?.message ?? `Mercado Pago respondeu ${res.status}`);
    return corpo;
  }
  const oauth = (corpo) => mp("/oauth/token", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...corpo }),
  }, null).then((d) => ({ userId: String(d.user_id), accessToken: d.access_token, refreshToken: d.refresh_token, expiraEmSeg: Number(d.expires_in) || 0 }));
  return {
    configurado: Boolean(token),
    oauthConfigurado: Boolean(clientId && clientSecret),
    urlAutorizacao({ state, redirectUri }) {
      const q = new URLSearchParams({ client_id: clientId, response_type: "code", platform_id: "mp", state, redirect_uri: redirectUri });
      return `https://auth.mercadopago.com.br/authorization?${q}`;
    },
    trocarCodigo: ({ code, redirectUri }) => oauth({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    renovarToken: (refreshToken) => oauth({ grant_type: "refresh_token", refresh_token: refreshToken }),
    async consultarPagamento(id, tokenVendedor) {
      const d = await mp(`/v1/payments/${encodeURIComponent(id)}`, {}, tokenVendedor);
      return { id: String(d.id), status: d.status, externalReference: d.external_reference ?? null };
    },
    async criarPreapproval({ referencia, email, motivo, valor, inicio, retorno }) {
      const d = await mp("/preapproval", {
        method: "POST",
        body: JSON.stringify({
          reason: motivo,
          external_reference: referencia, // ancora na loja sem depender do corpo do webhook
          payer_email: email,
          back_url: retorno,
          auto_recurring: { frequency: 1, frequency_type: "months", start_date: inicio, transaction_amount: valor, currency_id: "BRL" },
        }),
      });
      return { id: d.id, initPoint: d.init_point };
    },
    async consultarPreapproval(id) {
      const d = await mp(`/preapproval/${encodeURIComponent(id)}`);
      return { id: d.id, status: d.status, externalReference: d.external_reference ?? null };
    },
    /** Checkout Pro em nome da loja (tokenVendedor): a CIT fica com marketplace_fee, o resto vai para a loja. */
    async criarPreferenciaSplit({ tokenVendedor, titulo, valor, referencia, taxaMarketplace, retorno, webhookUrl }) {
      const d = await mp("/checkout/preferences", {
        method: "POST",
        body: JSON.stringify({
          items: [{ title: titulo, quantity: 1, currency_id: "BRL", unit_price: Number(valor) }],
          marketplace_fee: Number(taxaMarketplace),
          external_reference: referencia,
          back_urls: retorno ? { success: retorno, failure: retorno, pending: retorno } : undefined,
          auto_return: retorno ? "approved" : undefined,
          notification_url: webhookUrl,
        }),
      }, tokenVendedor);
      return { id: d.id, initPoint: d.init_point };
    },
    /** Pix em nome da loja. A chave de idempotência evita dois Pix para a mesma compra se o cliente tocar de novo. */
    async criarPixSplit({ tokenVendedor, titulo, valor, referencia, taxaMarketplace, emailComprador, webhookUrl }) {
      const d = await mp("/v1/payments", {
        method: "POST",
        headers: { "X-Idempotency-Key": referencia },
        body: JSON.stringify({
          transaction_amount: Number(valor),
          description: titulo,
          payment_method_id: "pix",
          payer: { email: emailComprador },
          application_fee: Number(taxaMarketplace),
          external_reference: referencia,
          notification_url: webhookUrl,
        }),
      }, tokenVendedor);
      return {
        id: String(d.id),
        status: d.status,
        qrCode: d.point_of_interaction?.transaction_data?.qr_code,
        qrCodeBase64: d.point_of_interaction?.transaction_data?.qr_code_base64,
        ticketUrl: d.point_of_interaction?.transaction_data?.ticket_url,
      };
    },
  };
}

/** authorized | pending | paused | cancelled do MP para o nosso status. Só "authorized" libera a vitrine. */
export function statusDoMp(s) {
  return s === "authorized" ? "authorized" : s === "pending" ? "pendente" : "cancelada";
}

/**
 * O MP não assina o corpo: assina o manifest "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
 * Ver atendehub/apps/api/src/routes/billing.ts.
 */
export function webhookValido({ segredo, assinatura, requestId, dataId }) {
  const partes = Object.fromEntries(String(assinatura ?? "").split(",").map((p) => p.trim().split("=")));
  if (!partes.ts || !partes.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId ?? ""};ts:${partes.ts};`;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(manifest).digest("hex"));
  const recebido = Buffer.from(String(partes.v1));
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
