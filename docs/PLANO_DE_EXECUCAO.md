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
- [ ] Catálogo central de planos (mensal R$ 99,90, parceiro R$ 0 + R$ 1/unidade)
- [ ] Preço contratado gravado na loja; assinantes antigos mantêm R$ 49,90
- [ ] Cupom FUNDADOR50 (50%, campanha de 90 dias configurável, um por loja, CNPJ/WhatsApp sem duplicidade, não volta após cancelamento definitivo)
- [ ] Estado `pausada` separado de `cancelada` (atraso não tira o benefício)
- [ ] Telas com o preço vindo do servidor (cadastro, painel, termos)
- [ ] Testes: 99,90 · 49,95 · cupom expirado · duplicado · fim da campanha · renovação · cancelamento · recuperação · preço do aparelho ignorado

## Fase 3 · Financeiro
- [ ] Livro de lançamentos imutável (mensalidade, comissão, afiliado, reembolso, chargeback, ajuste)
- [ ] Snapshot financeiro no pedido (unidades, comissão por unidade, total)
- [ ] Webhook idempotente com registro de eventos processados
- [ ] Mensalidades pagas registradas (pagamentos autorizados da assinatura)
- [ ] Testes: 1/5/10 unidades, zero, recusado, aprovado, reembolso, chargeback, webhook repetido, estoque; loja mensal com 1/100/1000 unidades = comissão zero

## Fase 4 · Painel administrativo
- [ ] Dashboard com dados reais (lojas por situação, MRR, comissões, pedidos, produtos sem estoque, conversão do teste)
- [ ] Planos e cupons de assinatura (configurar campanha, beneficiários, usos)
- [ ] Assinaturas e financeiro (livro, filtros)
- [ ] Registro de auditoria das ações do admin
- [ ] Usuários e permissões (avaliar; hoje é senha única)

## Fase 5 · Painel do lojista
- [ ] Aba financeira (vendas, recebimentos, reembolsos, comissões só para parceiros)
- [ ] Status separados: pagamento, atendimento e entrega, com histórico
- [ ] Produtos: SKU, marca, variações reais (substituem as opções genéricas)
- [ ] Perfil: banner, telefone, redes sociais

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
