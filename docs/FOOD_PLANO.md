# CITshop Food · diagnóstico e plano (branch `citshop-food`)

## O que já existe e será reaproveitado
O sistema atual está descrito em `ARQUITETURA.md` e `AUDITORIA_INICIAL.md`.
- **Conta, sessão e senha:** `lojas`, cookie HMAC, senha provisória, troca de senha que derruba sessões.
- **Assinatura Mercado Pago:**
  - preapproval, webhook e sincronização;
  - preço contratado gravado;
  - benefício de fundador vinculado à loja, à assinatura, ao CNPJ e ao WhatsApp (`planos.js`).
- **Conta MP do estabelecimento (OAuth)** e checkout com o token dele.
- **Pagamento:** webhook idempotente que relê o pagamento na API.
- **Livro financeiro imutável** (`financeiro.js`).
- **Entrega:**
  - frete por raio (faixas em km, Haversine);
  - mapa Leaflet;
  - geocodificação Nominatim com cache.
- **Avisos:** WhatsApp (WAHA) para a loja e para os alertas.
- **Admin:** suspensão, auditoria, dashboard, `/saude`, backup diário.

## Decisões de arquitetura
| Tema | Decisão | Motivo |
|---|---|---|
| Restaurante | É uma conta em `lojas` com `segmento: "food"` | Reaproveita cadastro, sessão, assinatura, OAuth MP, suspensão e auditoria, sem duplicar módulos. Na vitrine de produtos e no painel de lojas, o restaurante não aparece. |
| Cardápio | Coleção própria, `banco.d.cardapio` (itens e grupos de opções) | Não mistura com `produtos` do marketplace |
| Pedido Food | Em `banco.d.pedidos` com `origem: "food"` | Status do pedido separado do pagamento; snapshot de itens e opções; preço sempre recalculado no servidor |
| Mesma pessoa com loja e restaurante | O mesmo e-mail pode ter uma loja e um restaurante (contas separadas por segmento, cookies separados) | Atende "não obrigar contas diferentes" sem migrar a autenticação. Uma conta única de usuário com vários perfis fica para depois, porque exige migrar o login de todas as lojas. |
| Funcionários / KDS / impressora | `banco.d.acessos`: link/token por estabelecimento com papel (`cozinha`, `atendente`, `impressora`). O token guardado é só o hash (sha256). Revogável, com último uso registrado. | Cozinheiro e tablet não precisam de conta. Isolamento: todo acesso é amarrado a um `lojaId`. |
| Tempo real | Server-Sent Events (`EventSource`), sem dependência nova, com consulta periódica de reserva | Funciona atrás do proxy do Coolify e cabe na CSP atual (`connect-src 'self'`) |
| CITshop Print | Aplicativo Node 22 sem dependências (`citshop-print/`), executável único (Node SEA) no Windows. Fila local persistente em JSON; ESC/POS gerado pelo app. Saídas: rede (TCP 9100) e impressora do Windows em modo RAW (spooler). | Mesmo stack do servidor, testável aqui. Electron seria 100 MB+ para uma janela de configuração. |
| Fila de impressão | Trabalho no servidor com chave `pedido:tipo:versao` única. O app confirma `enviado` ou `erro`; reimpressão manual é um trabalho novo, com quem pediu. | Idempotência ponta a ponta. "Enviado" não é tratado como "impresso". |
| Entrega Food | Reaproveita as faixas de km da loja, mais pedido mínimo e prazo | Já existe e está testado |

## Fora da primeira versão (documentado, não fingido)
- Entregadores independentes (cadastro, aceite, rastreamento): o modelo de pedido já separa a situação da entrega.
- Carrinho com vários restaurantes.
- Estações com impressoras separadas: o modelo de trabalho já tem `estacao`.
- Instalador assinado do Windows: exige certificado de assinatura de código da CITmax.

## Referências
As licenças estão avaliadas em `REFERENCIAS_TECNICAS.md`.
- enatega e beepbite servem só como referência visual e de fluxo.
- Nenhum código copiado.

## Situação (branch `citshop-food`)

### Feito e testado
`teste/food*.test.js` e `teste/print.test.js`, suíte 110/110, mais a prévia em 375 e 1280 px.
- Plano FOOD PRO e FOODFUNDADOR50:
  - configuráveis no admin;
  - cupom separado por segmento;
  - nenhuma comissão.
- Restaurante como conta própria: mesmo e-mail para loja e restaurante; fora da vitrine de produtos.
- Cardápio com grupos de opções (mínimo e máximo), foto, estação e disponibilidade.
- Horários (inclusive depois da meia-noite), feriados, pausa, fechamento, pedido mínimo e limite de pedidos em andamento.
- Pedido:
  - preço do servidor e retrato do pedido;
  - entrega por km ou taxa fixa, ou retirada;
  - pagamento na entrega ou online (Mercado Pago), com webhook idempotente.
- Cozinha (KDS):
  - atualização a cada 4 s e som de pedido novo;
  - atraso destacado, estações, tela cheia;
  - papéis: cozinha não cancela nem vê telefone;
  - isolamento entre restaurantes;
  - links revogáveis.
- Avisos no WhatsApp (uma vez por pedido e situação): restaurante e cliente.
- Acompanhamento do pedido pelo cliente, com link assinado.
- CITshop Print:
  - vínculo por código;
  - token com escopo de impressão, troca diária e revogação;
  - fila local persistente;
  - sem duplicidade, inclusive em queda entre imprimir e avisar;
  - novas tentativas com intervalo crescente;
  - comanda ESC/POS em 58/80 mm, nas vias completa, cozinha e cliente;
  - impressão de teste e reimpressão manual;
  - tela local protegida.
- Admin: aba Food (restaurantes, aparelhos com revogação, falhas de impressão); preço FOOD PRO e cupom por segmento em Planos.

### Precisa de validação real
- Impressora física e Windows: spooler RAW, USB e drivers. Só a rede foi testada, com impressora simulada.
- Executável `.exe` (Node SEA) e assinatura de código: gerar no Windows.
- Pagamento online Food com conta Mercado Pago de teste.

### Não feito nesta etapa
- Pedido agendado.
- Promoções e cupons do restaurante.
- Combos com preço especial: hoje o combo é um item com grupos.
- Clientes e relatórios do restaurante.
- Funcionários com login: hoje são links por papel.
- Entregadores independentes.
- Impressora por estação: o modelo já está pronto.
- Carrinho com vários restaurantes.

## Motor universal de personalização (branch `food-motor`)
- **Cálculo:** um só, em centavos inteiros, em `publico/food-preco.js`. O navegador mostra; o servidor (`food-regras.js`) revalida tudo.
- **Variações:** com preço e regras próprias por grupo (mínimo, máximo, desligar, preço da opção).
- **Grupos:**
  - tipo escolha ou retirar ingrediente;
  - mínimo e máximo contados em unidades;
  - regra de preço soma, maior ou média;
  - escolhas sem custo;
  - estação.
- **Opções:** quantidade máxima por opção, estoque e datas.
- **Item:** estoque, datas (cardápio do dia) e horário.
- **Estoque:** reservado de forma síncrona na criação do pedido (sem corrida). É devolvido em cancelamento, pagamento recusado ou estornado, e em checkout online abandonado (30 min).
- **Modelos reutilizáveis:**
  - aplicar copia os grupos para o produto;
  - editar o modelo só altera produtos publicados quando o lojista pede;
  - os ids de grupos e opções são mantidos.
- **Cardápio do dia:** copiar as datas de um dia para outro.
- **Retrato do pedido:** variação, opções com quantidade, preço-base, adicionais e data do cardápio. A cozinha, a comanda e o painel usam esse retrato.
- **Testes:** `teste/food-motor.test.js` cobre os 27 casos pedidos, incluindo manipulação, concorrência, isolamento, retrato imutável, cozinha e comanda.
- **Compatibilidade:**
  - itens antigos (sem os campos novos) continuam funcionando com os valores padrão;
  - carrinhos antigos (escolhas em lista) são aceitos.
- **Limites técnicos:** 20 grupos por item, 60 opções por grupo, 12 variações e 60 datas.
