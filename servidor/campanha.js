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
