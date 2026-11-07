/**
 * Assinatura mensal das lojas via Mercado Pago (preapproval), com fetch puro.
 * Baseado em atendehub/apps/api/src/services/mercadoPagoService.ts.
 * Sem MP_ACCESS_TOKEN o cliente fica "não configurado" e o painel avisa em vez de quebrar.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://api.mercadopago.com";

export function criarMercadoPago({ token, fetchImpl = fetch }) {
  async function mp(caminho, init = {}) {
    const res = await fetchImpl(`${BASE}${caminho}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) throw new Error(corpo?.message ?? `Mercado Pago respondeu ${res.status}`);
    return corpo;
  }
  return {
    configurado: Boolean(token),
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
