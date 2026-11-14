/** Ponto de entrada: sobe o app e agenda as tarefas (cada uma registrada por tarefa(): /saude e alerta de falha). */
import { join } from "node:path";
import { RAIZ, criarApp } from "./app.js";
import { atualizarAfiliados, atualizarAmazon } from "./afiliados.js";
import { rodarColeta } from "./coletor.js";

const PORTA = Number(process.env.PORT ?? 3000);

let app, banco, dadosDir, sincronizarAssinaturas, verificarAlertas, publicarStoryDoDia, agendadorOfertas, tarefa, canais, sincronizarComissoesShopee, atualizarCampanhasShopee, postarInstagramDoDia, postarAgendados, buscas;
try {
  ({ app, banco, dadosDir, sincronizarAssinaturas, verificarAlertas, publicarStoryDoDia, agendadorOfertas, tarefa, canais, sincronizarComissoesShopee, atualizarCampanhasShopee, postarInstagramDoDia, postarAgendados, buscas } = criarApp({ log: { info: console.log, warn: console.warn, error: console.error } }));
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

// Backup do banco (citshop.json): na subida e a cada 24 h, guarda 14 dias em <DADOS_DIR>/backups.
const backup = tarefa("backup", async () => console.log(`[backup] ${banco.backup().arquivo}`));
backup();
setInterval(backup, 24 * 60 * 60 * 1000).unref();

// Comissão de afiliado: cliques por canal gravados a cada minuto; comissões da Shopee lançadas no livro a cada 6 h.
setInterval(() => { try { canais.descarregar(); buscas.descarregar(); } catch (e) { console.error(`[canal] ${e.message}`); } }, 60_000).unref();
const comissoes = tarefa("comissoes-shopee", async () => { const n = await sincronizarComissoesShopee(); if (n) console.log(`[comissoes] ${n} lançamento(s) da Shopee`); });
setTimeout(comissoes, 3 * 60_000).unref();
setInterval(comissoes, 6 * 60 * 60 * 1000).unref();
const campanhas = tarefa("campanhas-shopee", async () => console.log(`[campanhas] ${await atualizarCampanhasShopee()} campanha(s) da Shopee`));
setTimeout(campanhas, 2 * 60_000).unref();
setInterval(campanhas, 3 * 60 * 60 * 1000).unref();
// Instagram: postagem diária nos horários do admin (confere a cada 10 min; falha e token vencido aparecem em /saude).
const instagramDiario = tarefa("instagram", () => postarInstagramDoDia());
setTimeout(instagramDiario, 90_000).unref();
setInterval(instagramDiario, 10 * 60_000).unref();
// Postagens programadas (agenda-posts.json): confere a cada 5 min; cada post sai no Instagram e nos canais do WhatsApp da lista.
const agendados = tarefa("agenda", () => postarAgendados());
setTimeout(agendados, 60_000).unref();
setInterval(agendados, 5 * 60_000).unref();

const servidor = app.listen(PORTA, () => console.log(`[citshop] ouvindo na porta ${PORTA}`));
const encerrar = () => { try { canais.descarregar(); buscas.descarregar(); } catch { /* sem disco */ } servidor.close(() => process.exit(0)); };
process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
