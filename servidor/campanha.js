/**
 * Campanhas sazonais e datas duplas (1.1, 2.2, ..., 12.12 + Black Friday até Cyber Monday).
 * Tudo calculado em horário de Brasília (UTC-3, sem horário de verão).
 * Usado na home (faixa Especial / selo Super Oferta), no radar (WhatsApp/Telegram) e em /black-friday.
 */
const BRT_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 86_400_000;

/**
 * Janela oficial da Black Friday de um ano: 4ª sexta-feira de novembro (00:00 BRT)
 * até o fim da Cyber Monday (segunda seguinte às 23:59:59 BRT, ou seja, fim exclusivo = terça 00:00 BRT).
 */
export function janelaBlackFriday(ano) {
  // Dia da semana de 1º de novembro (0 = domingo ... 5 = sexta)
  const dowNov1 = new Date(Date.UTC(ano, 10, 1)).getUTCDay();
  const primeiraSexta = 1 + ((5 - dowNov1 + 7) % 7);
  const quartaSexta = primeiraSexta + 21; // 4ª sexta de novembro (em 2026: dia 27)
  // 00:00 BRT = 03:00 UTC
  const inicio = Date.UTC(ano, 10, quartaSexta, 3, 0, 0);
  const cyberInicio = inicio + 3 * DIA_MS; // segunda-feira 00:00 BRT
  const fim = inicio + 4 * DIA_MS; // terça-feira 00:00 BRT (fim da Cyber Monday)
  return { ano, diaInicio: quartaSexta, inicio, cyberInicio, fim };
}

/** Estado atual da Black Friday em `agora` (ms). */
export function estadoBlackFriday(agora = Date.now()) {
  const b = new Date(agora - BRT_MS);
  const ano = b.getUTCFullYear();
  const j = janelaBlackFriday(ano);
  if (agora < j.inicio) return { ativa: false, fase: "antes", ...j };
  if (agora < j.cyberInicio) return { ativa: true, fase: "ativa", ...j };
  if (agora < j.fim) return { ativa: true, fase: "cyber", ...j };
  return { ativa: false, fase: "encerrada", ...j };
}

/**
 * Campanha especial ativa no dia (horário de Brasília):
 * - Data dupla (1.1, 2.2, ..., 12.12): só no próprio dia, de 00:00 a 23:59 BRT.
 * - Black Friday / Cyber Monday: da 4ª sexta de novembro até segunda 23:59 BRT.
 */
export function campanhaAtual(agora = Date.now()) {
  const brasilia = new Date(agora - BRT_MS);
  const mes = brasilia.getUTCMonth() + 1, dia = brasilia.getUTCDate();
  if (dia === mes) return `${mes}.${mes}`;
  if (estadoBlackFriday(agora).ativa) return "Black Friday";
  return null;
}

/** Próxima data dupla e quantos dias faltam (0 no próprio dia), para a contagem discreta da home. */
export function proximaCampanha(agora = Date.now()) {
  const b = new Date(agora - BRT_MS);
  const dia = b.getUTCDate();
  let ano = b.getUTCFullYear(), mes = b.getUTCMonth() + 1;
  if (dia > mes) { mes = (mes % 12) + 1; if (mes === 1) ano++; }
  const dias = Math.round((Date.UTC(ano, mes - 1, mes) - Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), dia)) / DIA_MS);
  return { nome: `${mes}.${mes}`, dias };
}
