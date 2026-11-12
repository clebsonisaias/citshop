/**
 * Campanha de data dupla (1.1, 2.2, ..., 12.12): o nome aparece na faixa "Especial" da home, no selo
 * "Super Oferta" e nas mensagens do radar (WhatsApp/Telegram). É sempre a próxima data dupla, contando o
 * próprio dia até 23:59 de Brasília: em 12/11 já mostra 12.12; em 13/12 passa para 1.1.
 */
export function campanhaAtual(agora = Date.now()) {
  const brasilia = new Date(agora - 3 * 60 * 60 * 1000); // UTC-3, sem horário de verão
  const mes = brasilia.getUTCMonth() + 1, dia = brasilia.getUTCDate();
  const alvo = dia <= mes ? mes : (mes % 12) + 1;
  return `${alvo}.${alvo}`;
}
