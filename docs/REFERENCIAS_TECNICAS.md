# Referências técnicas

Consultadas em 12/11/2026 pela API do GitHub (licença, linguagem, atividade). Nenhum projeto foi copiado para dentro do CITshop: o CITshop é Node + Express + HTML/JS sem build, e todos os projetos abaixo são TypeScript sobre React/Next.js ou frameworks próprios. Usamos **padrões e ideias**, não código.

| Projeto | Licença | Tecnologias | Atividade | Reaproveitamento | Riscos | Benefício para o CITshop |
|---|---|---|---|---|---|---|
| [Mercur](https://github.com/mercurjs/mercur) | MIT | TypeScript, sobre Medusa | ativo (nov/2026) | Ideias: conta de vendedor separada da loja, pedido dividido por vendedor, comissão como regra configurável, painel do vendedor | Exige Medusa + Postgres + Redis; adoção seria reescrever o sistema | Modelo de "subpedido por vendedor" e de regras de comissão guiou o checkout por loja e o snapshot de comissão |
| [Medusa](https://github.com/medusajs/medusa) | MIT, exceto material Enterprise (licença própria) | TypeScript, Postgres | muito ativo | Ideias: módulos (produto, carrinho, pedido, pagamento), idempotência de webhooks, `payment_collection` com estados separados | Arquitetura pesada; não trocar a stack | Separação de estados de pagamento, atendimento e entrega; idempotência por evento |
| [Saleor Storefront](https://github.com/saleor/storefront) | **FSL-1.1-ALv2** (proíbe uso concorrente por 2 anos) | Next.js, GraphQL | ativo | Só referência visual de navegação e página de produto | **Não copiar código**: licença restritiva para uso comercial concorrente | Organização da página de produto e do carrinho |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | React + Tailwind + Radix | muito ativo | Padrões de componentes (diálogo, tabela, abas, formulário, estados) reproduzidos em HTML/CSS puro | Requer React/Tailwind para uso direto; adotar seria trocar o front inteiro | Vocabulário de componentes do design system (ver DESIGN_SYSTEM.md) |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | MIT | CSS utilitário com build | muito ativo | Escala de espaçamento e de breakpoints como tokens CSS | Exige etapa de build, que o projeto não tem | Tokens de espaçamento 4/8 e breakpoints coerentes |
| [Tremor](https://github.com/tremorlabs/tremor) | Apache-2.0 | React | baixa (último push out/2025) | Padrão de cartões de indicadores e gráficos simples | Manutenção baixa; React | Cartões de KPI do dashboard (feitos em HTML/CSS) |
| [Refine](https://github.com/refinedev/refine) | MIT | React | ativo | Padrão de CRUD com lista, filtros, ações e auditoria | Framework de admin novo não se justifica: o admin atual atende | Estrutura de módulos do admin (lista → detalhe → ação com confirmação e registro) |
| [Twenty](https://github.com/twentyhq/twenty) | **AGPLv3** (partes comerciais/MIT) | React, Postgres | muito ativo | Só referência de navegação e filtros de CRM | **Não copiar código** (AGPL obrigaria abrir o CITshop) | Lista de lojas com filtros e linha do tempo de atividades |
| [Next.js](https://github.com/vercel/next.js) | MIT | React/SSR | muito ativo | Não adotado | Migrar o front seria reescrever tudo sem ganho concreto | — (decisão: manter HTML/JS sem build) |

## Decisões
1. **Sem troca de stack.** Nenhuma referência justifica trocar Express + HTML/JS: o ganho viria com custo de reescrever tudo e risco de regressão.
2. **Checkout por loja** (ideia de subpedido do Mercur/Medusa): uma cobrança por vendedor, porque o split do Mercado Pago usa o token de um vendedor por cobrança.
3. **Estados separados no pedido** (Medusa): pagamento, atendimento e entrega.
4. **Componentes no estilo shadcn/ui, em CSS puro**, documentados em DESIGN_SYSTEM.md.
5. **Licenças restritivas (Saleor FSL, Twenty AGPL):** só referência, nenhum trecho de código.
