# Auditoria inicial · CITshop 2.0 (Fase 0)

Data: 12/11/2026 · Base auditada: `main` em `251a442` (tag de restauração `antes-citshop-2.0`) · Trabalho segue no branch `citshop-2.0`.

## 1. Arquitetura atual

| Camada | Como é hoje |
|---|---|
| Runtime | Node 22, ESM, **um processo** (`servidor/servidor.js`) que sobe o Express (`criarApp` em `servidor/app.js`) e as tarefas periódicas |
| Backend | `servidor/app.js` (1.889 linhas) concentra rotas públicas, painel da loja, admin, pagamentos, webhooks, pedidos, estoque, frete, cupons, alertas e Story. Módulos à parte: `dados.js` (persistência e regras de visibilidade), `seguranca.js` (sessão HMAC, scrypt, CSP, limitador), `mercadopago.js`, `uploads.js`, `afiliados.js`, `amazon.js`, `coletor.js`, `catalogo-loja.js`, `campanha.js`, `integracoes/*`, `motor-ofertas/*`, `tarefas/*` |
| Persistência | Arquivos JSON no volume `DADOS_DIR` (`/app/dados`): `citshop.json` (lojas, produtos, pedidos, cupons, alertas, convites, métricas…) gravado inteiro a cada alteração (escrita atômica com `rename`); `afiliados.json`, `amazon.json` e arquivos de coleta; fotos em `dados/uploads` (WebP) |
| Frontend | HTML + JS puro, sem build: `index.html`+`vitrine.js` (vitrine e janela de produto), `produto.html` (modelo da `/p/:id` renderizado no servidor), `painel.*`, `admin.*`, `carrinho.*`, `cupons.*`, `bio.*`, `comum.js`, `comprar.js`, `alerta.js`, `favoritos.js`, `produto.js`; um CSS único (`estilo.css`, ~890 linhas) |
| Segurança | CSP `script-src 'self'`, cookies de sessão assinados (HMAC, HttpOnly, SameSite=Lax), checagem de Origin em escritas da API, scrypt para senhas, limitadores por IP (`req.ip`, trust proxy 1), sessão da loja ligada à versão da senha |
| Deploy | Dockerfile `node:22-alpine` (`npm ci --omit=dev`), Coolify com **autodeploy a cada push em `main`**, volume persistente em `/app/dados` |
| Testes | `node --test teste/*.test.js` (91 testes, servidor e integrações com `fetch` simulado). Sem build e sem typecheck. Auditoria visual com Playwright via MCP (matriz 20 telas × 14 larguras) |

### Tarefas periódicas (`servidor/servidor.js`)
Robô de afiliados (8 h), coletor de ofertas (4 h, primeira após 60 s), Amazon (50 min), sincronização de assinaturas do Mercado Pago (6 h), alertas de preço/estoque (1 h), Story diário (1 h), agendador do motor de ofertas/radar.

### Integrações externas
Mercado Pago (assinatura `preapproval` com o token da plataforma; OAuth das lojas parceiras; Checkout Pro e Pix com `marketplace_fee`/`application_fee`; webhook com `x-signature`), WAHA (WhatsApp), Instagram Graph (publicação e QUERO), Telegram, Shopee, Mercado Livre, Amazon (Creators API), SHEIN, Nominatim/OpenStreetMap (geocodificação e mapa).

### Variáveis de ambiente usadas
`SESSAO_SEGREDO`, `DADOS_DIR`, `URL_PUBLICA`, `PORT`, `ADMIN_SENHA_HASH`, `ROBO_TOKEN`, `MP_ACCESS_TOKEN`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `INSTAGRAM_*` (5), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SHOPEE_APP_ID`, `SHOPEE_SECRET`, `SHOPEE_COOKIE`, `MERCADO_LIVRE_ACCESS_TOKEN`, `MERCADO_LIVRE_AFFILIATE_TAG`, `AMAZON_*` (6), `SHEIN_AFFILIATE_ID`.

## 2. Funcionalidades existentes (em produção)

- **Vitrine:** busca tolerante a acentos, filtros de origem/preço/cidade, ordenação, departamentos, banners, lojas da região, faixa de campanha nas datas duplas, contagem regressiva, favoritos (no aparelho), cupons do dia, alertas de queda de preço e de volta ao estoque.
- **Produto `/p/:id`:** renderização no servidor, Open Graph, JSON-LD, opções de cor/tamanho, compra.
- **Lojas locais:** cadastro aberto com 30 dias de teste, assinatura mensal (R$ 49,90) no Mercado Pago, página pública `/:slug`, painel em abas (Início, Pedidos, Produtos, Entrega, Loja), produtos com até 4 fotos, estoque simples ou por quantidade, entrega por km com mapa (pino privado, endereço opcional), cupons da loja, planilha de pedidos.
- **Parceiras (R$ 1 por unidade):** por convite de uso único gerado no admin, venda só pelo Mercado Pago com split (`marketplace_fee` = R$ 1 × unidades), conexão OAuth da conta da loja, aviso de venda no WhatsApp.
- **Pedidos:** compra direta ou carrinho por loja; pedido pelo WhatsApp registrado com código; frete recalculado no servidor; estoque baixado na venda paga ou no "vendido" e devolvido no cancelamento/estorno, sem baixar duas vezes (`estoqueBaixado`).
- **Admin:** abas Lojas, Convites, Cupons, Afiliados, Canais e Conta; senha provisória e acesso provisório com troca obrigatória; suspensão; ocultar produto; modelo de cobrança.
- **Afiliados e canais:** Shopee, Mercado Livre, Amazon, SHEIN, motor de ofertas com validador, radar no WhatsApp, Instagram (feed, Story, QUERO), Telegram.

## 3. Funcionalidades incompletas ou ausentes (frente ao CITshop 2.0)

1. **Planos:** preço fixo `PRECO_PLANO = 49.9` em `app.js`; não há entidade de plano, preço contratado por loja nem cupom de assinatura (FUNDADOR50).
2. **Estados de assinatura:** `statusDoMp` transforma `paused` em `cancelada`, o que apagaria o benefício de fundador num atraso temporário.
3. **Financeiro:** não existe livro de lançamentos. A comissão fica só em `pedido.taxaMarketplace`; mensalidades pagas não são registradas (só o status do preapproval); estorno e chargeback não geram lançamento.
4. **Idempotência de webhook:** o estoque já é protegido (`estoqueBaixado`), mas não há registro de eventos processados nem snapshot financeiro completo no pedido.
5. **Admin:** senha única, sem usuários/permissões nem registro de auditoria; sem dashboard de receita (MRR, comissões).
6. **Lojista:** sem aba financeira; sem SKU/marca/variações reais (as opções de cor/tamanho da página são genéricas); status de pagamento, atendimento e entrega misturados.
7. **Comprador:** sem conta; favoritos só no aparelho; sem avaliações.
8. **Documentação:** README descreve a versão estática antiga.

## 4. Problemas e riscos encontrados

| # | Risco | Impacto | Tratamento proposto |
|---|---|---|---|
| R1 | JSON único regravado inteiro a cada alteração, um processo só | Escala limitada; arquivo corrompido derruba tudo; não permite réplicas | Fase 9: backup automático diário com retenção + avaliação documentada de PostgreSQL (migração só com autorização) |
| R2 | Sem backup automático do volume | Perda de dados se o volume falhar | Fase 8/9: cópia diária com rotação dentro do volume + instrução de cópia externa |
| R3 | Preço do plano espalhado (constante + textos de tela) | Mudança de preço altera assinantes antigos ou deixa telas erradas | Fase 2: catálogo de planos central + `precoContratado` gravado na loja |
| R4 | `paused` tratado como cancelada | Fundador perderia o desconto num atraso | Fase 2: estado `pausada` distinto |
| R5 | Sem livro financeiro | Não dá para separar mensalidade, comissão e estorno, nem auditar | Fase 3 |
| R6 | Admin com senha única e sem trilha | Sem responsabilização por ações | Fase 4: registro de auditoria das ações do admin (usuários múltiplos ficam para depois, ver plano) |
| R7 | `app.js` monolítico | Manutenção difícil | Extrair módulos novos (planos, financeiro) sem reescrever o que funciona |
| R8 | Alertas aceitam qualquer WhatsApp | Abuso (mensagens não pedidas) | Fase 8: confirmação por código (registrado como pendente) |
| R9 | `npm audit` acusa vulnerabilidade herdada | Depende do pacote | Fase 10: triagem sem atualização às cegas |
| R10 | Checkout multiloja num pagamento só | O split do Mercado Pago é por vendedor (um token por cobrança) | Manter checkout por loja (decisão documentada em FINANCEIRO_E_SPLIT.md) |

## 5. Dependências

Express 4, multer 2, sharp 0.34, leaflet 1.9.4 (servido em `/vendor/leaflet`). Nenhum framework de front. Fontes Montserrat (Google Fonts).

## 6. Oportunidades

Planos e cupons centralizados; livro financeiro imutável; dashboards com dados reais; variações reais por produto; avaliações por link do pedido (sem exigir conta); backup automático; README e documentação operacional.

## 7. Plano de implementação e arquivos

Ver `docs/PLANO_DE_EXECUCAO.md`. Módulos novos: `servidor/planos.js` (catálogo de planos, campanha e cupom de assinatura), `servidor/financeiro.js` (livro de lançamentos e snapshots). Arquivos alterados com mais frequência: `servidor/app.js`, `servidor/mercadopago.js`, `servidor/dados.js`, `publico/admin.*`, `publico/painel.*`, `publico/estilo.css`, testes em `teste/`.

## 8. O que não muda sem autorização

Banco de dados (JSON → PostgreSQL), infraestrutura/Coolify, framework, regras de split além do que o briefing define, credenciais, pagamentos reais e **qualquer publicação em produção** (o merge em `main` publica automaticamente).
