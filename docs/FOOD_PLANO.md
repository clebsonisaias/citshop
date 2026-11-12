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
