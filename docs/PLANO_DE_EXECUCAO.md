# Plano de execução · CITshop 2.0

Branch de trabalho: `citshop-2.0` · Ponto de restauração: tag `antes-citshop-2.0` (= `main` em `251a442`).
Regra: nada vai para `main` (que publica sozinho no Coolify) sem autorização explícita. Uma tarefa só é marcada quando está implementada **e** validada.

## Fase 0 · Auditoria
- [x] Estrutura, rotas, integrações, tarefas, variáveis e testes mapeados (`docs/AUDITORIA_INICIAL.md`)
- [x] Branch seguro e tag de restauração

## Fase 1 · Preparação
- [x] Skills avaliadas e registradas (`docs/SKILLS_E_FERRAMENTAS.md`)
- [x] Referências avaliadas com licença (`docs/REFERENCIAS_TECNICAS.md`)
- [x] Estrutura de testes existente mantida (`node:test` + Playwright via MCP)
- [x] Plano de execução (este arquivo)

## Fase 2 · Modelo comercial
- [x] Catálogo central de planos (mensal R$ 99,90, parceiro R$ 0 + R$ 1/unidade)
- [x] Preço contratado gravado na loja; assinantes antigos mantêm R$ 49,90
- [x] Cupom FUNDADOR50 (50%, campanha de 90 dias configurável, um por loja, CNPJ/WhatsApp sem duplicidade, não volta após cancelamento definitivo)
- [x] Estado `pausada` separado de `cancelada` (atraso não tira o benefício)
- [x] Telas com o preço vindo do servidor (cadastro, painel, termos)
- [x] Testes: 99,90 · 49,95 · cupom expirado · duplicado · fim da campanha · renovação · cancelamento · recuperação · preço do aparelho ignorado
- [x] Admin → Planos: preço oficial, cupons (criar, prorrogar, ativar, limite, usos), beneficiários, registro de alterações

## Fase 3 · Financeiro
- [x] Livro de lançamentos imutável (mensalidade, comissão, afiliado, reembolso, chargeback, ajuste)
- [x] Snapshot financeiro no pedido (unidades, comissão por unidade, total)
- [x] Webhook idempotente com registro de eventos processados
- [x] Mensalidades pagas registradas (pagamentos autorizados da assinatura)
- [x] Testes: 1/5/10 unidades, zero, recusado, aprovado, reembolso, chargeback, webhook repetido, estoque; loja mensal com 1/100/1000 unidades = comissão zero
- [ ] Validar `authorized_payments` com credenciais de teste do Mercado Pago (depende de conta de teste)

## Fase 4 · Painel administrativo
- [x] Dashboard com dados reais (lojas por situação, MRR pelo preço contratado, receita do mês pelo livro, pedidos de 30 dias, produtos sem estoque, conversão do teste)
- [x] Planos e cupons de assinatura (configurar campanha, beneficiários, usos) — feito na Fase 2
- [x] Financeiro: livro com filtros por tipo e loja e resumo do recorte
- [x] Registro de auditoria de todas as ações do admin (lojas, convites, cupons, planos, produtos)
- [x] Lojas: filtro por situação (inclui fundadoras) e busca
- [ ] Usuários e permissões: **decisão pendente** — hoje há uma senha de admin; múltiplos usuários exigem cadastro de operadores e papéis (proposta em ARQUITETURA.md)

## Fase 5 · Painel do lojista
- [x] Financeiro do mês no Início (vendas, recebido pelo site, aguardando, reembolsado; comissão CIT só para parceiros, lida do livro)
- [x] Status separados: pagamento (Mercado Pago), atendimento e entrega/retirada, com histórico e coluna na planilha
- [x] Produtos: SKU (só da loja), marca, variações reais definidas pela loja (fim das opções genéricas P/M/G, Oversized, cores)
- [x] Perfil: telefone (oculto para parceiros) e Instagram na página da loja
- [x] Testes (`teste/lojista.test.js`) e prévia 375/1280 px sem rolagem horizontal
- [ ] Banner da loja (upload) — adiado: exige novo fluxo de imagem

## Fase 6 · Vitrine e comprador
- [ ] Filtros por marca, loja, disponibilidade e tipo de vendedor; paginação
- [ ] Favoritar lojas
- [ ] Avaliações por link do pedido (só quem comprou, uma por pedido, moderação)
- [ ] Conta do comprador (avaliar: exige login de comprador)

## Fase 7 · Afiliados
- [ ] Auditoria dos adaptadores e regras de qualidade de publicação
- [ ] Histórico de preço e relatório por plataforma

## Fase 8 · Automações
- [ ] Health check (`/saude`)
- [ ] Alerta de falha de tarefas agendadas
- [ ] Confirmação do WhatsApp nos alertas

## Fase 9 · Escalabilidade
- [ ] Backup automático do `citshop.json` com rotação
- [ ] Proposta de PostgreSQL (modelo, migração, backup, rollback) — **migração só com autorização**

## Fase 10 · Homologação
- [ ] Suíte completa, segurança, navegador/responsivo, documentação (README, ARQUITETURA, MODELO_COMERCIAL, FINANCEIRO_E_SPLIT, AFILIADOS, SEGURANCA, TESTES, DEPLOY, CHANGELOG, DESIGN_SYSTEM)
- [ ] Publicação em produção — **só com autorização**
