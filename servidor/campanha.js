/**
 * Campanha de data dupla (1.1, 2.2, ..., 12.12): só existe no próprio dia, de 00:00 a 23:59 de Brasília.
 * Nesse dia a faixa "Especial" aparece na home e o nome entra no selo "Super Oferta" e nas mensagens do
 * radar (WhatsApp/Telegram). Nos outros dias devolve null e a faixa some.
 */
export function campanhaAtual(agora = Date.now()) {
  const brasilia = new Date(agora - 3 * 60 * 60 * 1000); // UTC-3, sem horário de verão
  const mes = brasilia.getUTCMonth() + 1, dia = brasilia.getUTCDate();
  return dia === mes ? `${mes}.${mes}` : null;
}

/** Próxima data dupla e quantos dias faltam (0 no próprio dia), para a contagem discreta da home. */
export function proximaCampanha(agora = Date.now()) {
  const b = new Date(agora - 3 * 60 * 60 * 1000);
  const dia = b.getUTCDate();
  let ano = b.getUTCFullYear(), mes = b.getUTCMonth() + 1;
  if (dia > mes) { mes = (mes % 12) + 1; if (mes === 1) ano++; }
  const dias = Math.round((Date.UTC(ano, mes - 1, mes) - Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), dia)) / 86_400_000);
  return { nome: `${mes}.${mes}`, dias };
}
