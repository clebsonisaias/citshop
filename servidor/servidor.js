/** Ponto de entrada: sobe o app e agenda as tarefas (cada uma registrada por tarefa(): /saude e alerta de falha). */
import { join } from "node:path";
import { RAIZ, criarApp } from "./app.js";
import { atualizarAfiliados, atualizarAmazon } from "./afiliados.js";
import { rodarColeta } from "./coletor.js";

const PORTA = Number(process.env.PORT ?? 3000);

let app, dadosDir, sincronizarAssinaturas, verificarAlertas, publicarStoryDoDia, agendadorOfertas, tarefa;
try {
  ({ app, dadosDir, sincronizarAssinaturas, verificarAlertas, publicarStoryDoDia, agendadorOfertas, tarefa } = criarApp({ log: { info: console.log, warn: console.warn, error: console.error } }));
} catch (e) {
  console.error(`[fatal] ${e.message}`);
  process.exit(1);
}

// Inicia a central de agendamentos automatizada e coordenada
if (agendadorOfertas) {
  agendadorOfertas.iniciarAgendamentos();
}

const rodarRobo = tarefa("afiliados", () => atualizarAfiliados({ env: process.env, dadosDir, manual: join(RAIZ, "manual.json") })
  .then((r) => console.log(`[afiliados] ${r.total} produtos (${r.shopee} Shopee, ${r.manuais} manuais)`)));
rodarRobo();
setInterval(rodarRobo, 8 * 60 * 60 * 1000).unref();

// Coletor sem API (Shopee pelo cookie do painel, Amazon pelas páginas públicas): 1 min após subir e a cada 4 horas.
// A Amazon vai em rodízio (um pedaço do catálogo por rodada, ver coletor.js), então o catálogo todo gira em ~16h.
const rodarColetor = tarefa("coletor", () => rodarColeta({ env: process.env, dadosDir, manual: join(RAIZ, "manual.json") })
  .then((s) => console.log(`[coletor] shopee=${s.shopee} amazon=${s.amazon} total=${s.total ?? "-"} ${s.erros.join(" | ")}`)));
setTimeout(rodarColetor, 60_000).unref();
setInterval(rodarColetor, 4 * 60 * 60 * 1000).unref();

// Amazon separada: a Creators API só permite guardar preço e oferta por 1 hora.
const rodarAmazon = tarefa("amazon", () => atualizarAmazon({ env: process.env, dadosDir, manual: join(RAIZ, "manual.json") })
  .then((s) => s && console.log(`[amazon] ${s.total} produtos${s.erro ? ` · erro: ${s.erro}` : ""}`)));
rodarAmazon();
setInterval(rodarAmazon, 50 * 60 * 1000).unref();

const sincronizar = tarefa("assinaturas", () => sincronizarAssinaturas()
  .then((n) => n && console.log(`[mp] ${n} assinatura(s) mudaram de status`)));
setInterval(sincronizar, 6 * 60 * 60 * 1000).unref();

// Alerta "baixou de preço": confere a cada hora (os preços mudam com o robô e o coletor).
const conferirAlertas = tarefa("alertas", () => verificarAlertas());
setInterval(conferirAlertas, 60 * 60 * 1000).unref();

// Story diário da loja local (se ligado no /admin): confere a cada hora; publica 1 por dia a partir das 10h.
const storyDoDia = tarefa("story", () => publicarStoryDoDia());
setInterval(storyDoDia, 60 * 60 * 1000).unref();

const servidor = app.listen(PORTA, () => console.log(`[citshop] ouvindo na porta ${PORTA}`));
const encerrar = () => servidor.close(() => process.exit(0));
process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
