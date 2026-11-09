# Evolução do marketplace CITshop

## Diagnóstico da base atual

O CITshop é um aplicativo Node.js 22 com Express, publicado em Docker/Coolify e com dados persistentes em volume (`DADOS_DIR`). A aplicação atual já mantém cadastros e produtos de lojas locais, sessão de loja e admin, uploads WebP, período de teste e assinatura mensal via Mercado Pago. A vitrine combina esses produtos com ofertas afiliadas da Amazon, Shopee e Mercado Livre; as ofertas externas seguem para a loja de origem e os vendedores locais recebem pedidos pelo WhatsApp.

O catálogo da vitrine é montado de arquivos JSON (`citshop.json`, `afiliados.json`, `amazon.json` e arquivos de coleta). `servidor/dados.js` lê o estado principal em memória e substitui o JSON de forma atômica. Não há entidades ou fluxos de comprador, pedido, carrinho, estoque, avaliação, envio ou devolução. Os detalhes de produto atuais são uma janela sobre a vitrine, com rota `/p/:id` e metadados de compartilhamento gerados no servidor. O README da raiz descreve uma versão estática antiga e não documenta o servidor em uso.

## Fases propostas

1. **Descoberta da vitrine:** busca tolerante a acentos e erros simples, filtros por vendedor/preço, ordenação, contagem e experiência responsiva dos controles.
2. **Páginas, catálogo e ofertas:** concluída a renderização server-side de `/p/:id`, com conteúdo visível sem JavaScript, canonical, Open Graph e dados estruturados Product/Offer. Próximo: modelar ofertas independentes por vendedor, comparação confiável de preço/data/fonte e canonicalização de produtos iguais. Preservar saída externa para afiliados e contato direto para lojas locais até haver checkout local.
3. **Operação de vendedores e administração:** métricas e gestão de catálogo, moderação, estados de produto e rotinas de suporte, mantendo cadastro, assinatura e ferramentas existentes.
4. **Persistência PostgreSQL:** introduzir uma interface de repositório atrás do `Banco`, criar schema e migração idempotente com validação e cópia/backup dos JSON, execução em modo de leitura e plano de rollback antes de qualquer troca de escrita.
5. **Compradores e pedidos locais:** identidade de comprador, favoritos, carrinho e pedidos com estado/auditoria. Esses fluxos devem identificar explicitamente itens de lojas CITshop; afiliados continuam com navegação externa.
6. **Checkout e pós-venda:** integrar pagamentos, comissão, estoque, logística/rastreamento, avaliações e devoluções após confirmar provedor, regras comerciais, responsabilidades fiscais, webhooks e credenciais.

## Dependências e riscos

- Credenciais reais da Creators API/Amazon, Shopee e Mercado Pago são variáveis externas e não devem ser substituídas por pagamentos ou integrações fictícias.
- Checkout multiparticipante e divisão de comissão dependem de provedor compatível, modelo de repasse, regras de estorno e validação dos webhooks.
- Frete, rastreamento e devoluções dependem de operador logístico, cobertura, prazos e política comercial.
- A migração deve preservar todos os registros, senhas hash, assinaturas, identificadores, produtos e referências a fotos; não remover os JSON originais até reconciliação e rollback aprovados.
- O runtime atual é um único processo e arquivos JSON locais. Escalar para múltiplas réplicas requer coordenação de escrita, sessão/limites compartilhados e armazenamento de uploads.
- A suíte usa `node:test`; `package.json` não define typecheck nem build. `npm ci` reporta uma vulnerabilidade alta no conjunto atual de dependências, que deve ser triada separadamente antes de qualquer atualização.

## Etapa 1 entregue

- Busca por nome, descrição, loja, cidade e categoria; ignora acentos e aceita uma diferença simples de digitação em termos com pelo menos cinco caracteres.
- Filtros de vendedor/origem e faixa de preço, ordenação por relevância, preço e desconto, filtro de cidade/subcategoria e contagem de resultados.
- Mantida a prioridade visual das lojas locais em relação às ofertas afiliadas; as opções de origem permitem isolar cada marketplace.
- Cobertura automatizada para normalização, relevância, filtros combinados e ordenação.
- Rota `/p/:id` agora entrega título, preço, vendedor, detalhes e botão de compra no HTML inicial. Dados Product/Offer, canonical e Open Graph são gerados no servidor; afiliados mantêm link externo patrocinado e lojas locais mantêm o WhatsApp.
- Cobertura de integração para renderização e metadados de produto local e afiliado, incluindo verificação do JSON-LD.
- Perfil da loja aceita horário, bairros atendidos e prazo informado; os dados aparecem na página pública e são preservados em atualizações parciais.
- Produtos locais têm disponibilidade declarada pela loja (`disponível`, `sob encomenda` ou `consulte`), com fallback `consulte` para cadastros existentes.
- Redirecionamentos de contato registram total e horário do último clique por loja/produto. Não guardam IP ou identidade; a métrica aparece nos painéis da loja e admin, e a política de dados foi atualizada.

## Validação

Executar `npm run teste`. O projeto não possui scripts de build ou typecheck definidos; os arquivos públicos são servidos diretamente pelo Express e a implantação usa `Dockerfile` sem etapa de compilação.
