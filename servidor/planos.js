// Regras comerciais do CITshop num lugar só (docs/MODELO_COMERCIAL.md).
// - Loja convencional: mensalidade, 30 dias de teste, NUNCA paga comissão por venda.
// - Loja fundadora: cupom FUNDADOR50 (50%) aplicado durante a campanha; o preço contratado fica gravado na loja
//   e vale em todas as renovações enquanto a assinatura não for cancelada de vez.
// - Parceiro especial (convite): sem mensalidade, R$ 1 por unidade vendida pelo checkout do CITshop.
// Os valores configuráveis (preço oficial, campanha) ficam em banco.d.comercial; o preço já contratado nunca muda.

export const PRECO_MENSAL_PADRAO = 99.9;
export const PRECO_LEGADO = 49.9; // assinaturas feitas antes do CITshop 2.0 seguem com este valor no Mercado Pago
export const COMISSAO_PARCEIRO_POR_UNIDADE = 1.0;
const DIA = 24 * 60 * 60 * 1000;

export const reais2 = (n) => Math.round(Number(n) * 100) / 100;
/** 99,90 com 50% = 49,95 (arredonda no centavo, sem erro de ponto flutuante). */
export const precoComDesconto = (preco, percentual) => Math.round(Number(preco) * (100 - Number(percentual))) / 100;

/** CNPJ com 14 dígitos e dígitos verificadores corretos, ou null. */
export function cnpjNormalizado(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return null;
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]) ? d : null;
}

/** Cria a configuração comercial na primeira subida do 2.0: preço oficial e a campanha FUNDADOR50 por 90 dias a partir de hoje. */
export function garantirComercial(banco, agora) {
  if (banco.d.comercial) return false;
  banco.d.comercial = {
    precoMensal: PRECO_MENSAL_PADRAO,
    cupons: [{
      codigo: "FUNDADOR50", percentual: 50, recorrente: true, permanente: true, ativo: true, limite: null,
      inicio: new Date(agora).toISOString(), fim: new Date(agora + 90 * DIA).toISOString(),
      criadoEm: new Date(agora).toISOString(), usos: [],
    }],
  };
  // Quem já assinava antes do 2.0 mantém o preço que contratou (o valor da assinatura no Mercado Pago não muda).
  for (const l of banco.lojas) {
    if (l.assinatura?.preapprovalId && !l.plano) l.plano = { codigo: "mensal", precoContratado: PRECO_LEGADO, legado: true };
  }
  return true;
}

export const precoMensalOficial = (banco) => reais2(banco.d.comercial?.precoMensal ?? PRECO_MENSAL_PADRAO);
const cupomPorCodigo = (banco, codigo) => (banco.d.comercial?.cupons ?? []).find((c) => c.codigo === String(codigo ?? "").trim().toUpperCase());
export const cupomValendo = (c, agora) => Boolean(c?.ativo && agora >= Date.parse(c.inicio) && agora <= Date.parse(c.fim) && (c.limite == null || c.usos.length < c.limite));

/** Benefício em vigor da loja (aplicado e não encerrado por cancelamento definitivo), ou null. */
export const beneficioAtivo = (loja) => (loja.beneficio && !loja.beneficio.encerradoEm ? loja.beneficio : null);

/** Quanto a loja pagaria se assinasse agora: preço oficial com o benefício, se tiver. */
export function precoParaAssinar(banco, loja) {
  const oficial = precoMensalOficial(banco);
  const b = beneficioAtivo(loja);
  return b ? precoComDesconto(oficial, b.percentual) : oficial;
}

/**
 * Valida um cupom de assinatura para a loja. Regras: campanha valendo, um benefício por loja, não cumulativo,
 * não volta depois de cancelamento definitivo, sem duplicidade de CNPJ ou WhatsApp entre lojas, parceiro não usa.
 */
export function validarCupomAssinatura(banco, loja, codigo, agora) {
  const c = cupomPorCodigo(banco, codigo);
  if (!c) return { erro: "Cupom não encontrado." };
  if (loja.modeloCobranca === "comissao_fixa") return { erro: "Parceiros especiais não pagam mensalidade: o cupom não se aplica." };
  if (loja.beneficio?.encerradoEm) return { erro: "O benefício desta loja foi encerrado com o cancelamento da assinatura e não pode ser aplicado de novo." };
  if (loja.beneficio) return loja.beneficio.codigo === c.codigo ? { cupom: c, jaAplicado: true } : { erro: "A loja já tem um benefício. Os cupons não se acumulam." };
  if (!cupomValendo(c, agora)) return { erro: Date.parse(c.fim) < agora ? "A campanha deste cupom já terminou." : "Este cupom não está valendo agora." };
  const duplicada = banco.lojas.find((o) => o.id !== loja.id && o.beneficio?.codigo === c.codigo
    && ((loja.cnpj && o.cnpj === loja.cnpj) || (loja.whatsapp && o.whatsapp === loja.whatsapp)));
  if (duplicada) return { erro: "Este CNPJ ou WhatsApp já usou este cupom em outra loja." };
  return { cupom: c };
}

/** Aplica o cupom (já validado) à loja e registra o uso. O desconto vale a partir da primeira cobrança, depois do teste. */
export function aplicarCupomAssinatura(loja, cupom, agora) {
  const em = new Date(agora).toISOString();
  loja.beneficio = { codigo: cupom.codigo, percentual: cupom.percentual, aplicadoEm: em };
  cupom.usos.push({ lojaId: loja.id, em });
}

/** Estado da assinatura no Mercado Pago → estado no CITshop. "paused" (atraso) é diferente de cancelado. */
export function estadoAssinatura(statusMp) {
  return { authorized: "authorized", pending: "pendente", paused: "pausada", cancelled: "cancelada" }[statusMp] ?? "cancelada";
}

/**
 * Grava a mudança de estado da assinatura (um lugar só para webhook, sincronização e volta do checkout).
 * Cancelamento definitivo de uma assinatura que chegou a ser autorizada encerra o benefício de fundador;
 * pausa/atraso não encerra. Devolve true se algo mudou.
 */
export function registrarEstadoAssinatura(loja, estado, { preapprovalId, agora }) {
  const antes = loja.assinatura?.status;
  const em = new Date(agora).toISOString();
  loja.assinatura = { ...loja.assinatura, status: estado, ...(preapprovalId && { preapprovalId }), atualizadaEm: em };
  if (estado === "authorized") loja.assinatura.jaAutorizada = true;
  if (estado === "cancelada" && loja.assinatura.jaAutorizada && loja.beneficio && !loja.beneficio.encerradoEm) loja.beneficio.encerradoEm = em;
  return antes !== estado;
}
