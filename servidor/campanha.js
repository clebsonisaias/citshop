/**
 * Campanha de data especial (11.11, 12.12...): o nome aparece no selo "Super Oferta", na faixa da home e nas
 * mensagens do radar (WhatsApp/Telegram) até o fim do dia da campanha. Depois some sozinho.
 * Para a próxima data, acrescente uma linha aqui.
 */
const CAMPANHAS = [
  { nome: "12.12", ate: "2026-12-13T03:00:00Z" }, // até 12/12 23:59 (Brasília)
];

export function campanhaAtual(agora = Date.now()) {
  return CAMPANHAS.find((c) => agora < Date.parse(c.ate))?.nome ?? null;
}
