/** Ponto de entrada: sobe o app e agenda o robô de afiliados (na subida e a cada 8 horas). */
import { join } from "node:path";
import { RAIZ, criarApp } from "./app.js";
import { atualizarAfiliados } from "./afiliados.js";

const PORTA = Number(process.env.PORT ?? 3000);

let app, dadosDir, sincronizarAssinaturas;
try {
  ({ app, dadosDir, sincronizarAssinaturas } = criarApp({ log: { info: console.log, warn: console.warn, error: console.error } }));
} catch (e) {
  console.error(`[fatal] ${e.message}`);
  process.exit(1);
}

const rodarRobo = () => atualizarAfiliados({ env: process.env, dadosDir, manual: join(RAIZ, "manual.json") })
  .then((r) => console.log(`[afiliados] ${r.total} produtos (${r.shopee} Shopee, ${r.manuais} manuais)`))
  .catch((e) => console.error(`[afiliados] falhou, mantendo a lista anterior: ${e.message}`));
rodarRobo();
setInterval(rodarRobo, 8 * 60 * 60 * 1000).unref();

const sincronizar = () => sincronizarAssinaturas()
  .then((n) => n && console.log(`[mp] ${n} assinatura(s) mudaram de status`))
  .catch((e) => console.error(`[mp] sincronização falhou: ${e.message}`));
setInterval(sincronizar, 6 * 60 * 60 * 1000).unref();

const servidor = app.listen(PORTA, () => console.log(`[citshop] ouvindo na porta ${PORTA}`));
const encerrar = () => servidor.close(() => process.exit(0));
process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
