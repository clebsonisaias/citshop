# CITshop (CIT Shopping) · 2.0

Marketplace da CITmax em https://shop.citmax.com.br, com dois tipos de oferta:
- **Lojas da região**: assinatura de R$ 99,90 por mês, ou parceiras que pagam R$ 1 por unidade vendida.
  - Vendem pelo WhatsApp ou pelo site, com Mercado Pago e split.
  - Têm painel próprio em `/painel`.
- **Ofertas de afiliados**: Shopee, Mercado Livre, Amazon e SHEIN, coletadas automaticamente.

## Rodar
```bash
npm install
npm run senha -- 'senha-do-admin'   # gera ADMIN_SENHA_HASH
npm run dev                          # lê .env, porta 3000
npm run teste                        # node --test teste/*.test.js
```
O mínimo no `.env` é `SESSAO_SEGREDO` (32 caracteres ou mais), `ADMIN_SENHA_HASH`, `URL_PUBLICA` e `DADOS_DIR`. As demais variáveis estão em [docs/DEPLOY.md](docs/DEPLOY.md).

## Páginas
| Rota | O que é |
|---|---|
| `/`, `/<slug-da-loja>`, `/p/<id>` | Vitrine, página da loja e página do produto |
| `/carrinho` | Carrinho (finaliza por loja) |
| `/avaliar?p=&t=` | Avaliação da compra (link assinado enviado pela loja) |
| `/painel` | Painel do lojista |
| `/admin` | Administração |
| `/alimentacao`, `/alimentacao/<slug>` | CITshop Food: restaurantes, cardápio e acompanhamento do pedido |
| `/restaurante` | Painel do restaurante |
| `/cozinha` | Tela da cozinha (KDS) |
| `/saude` | Health check |

## Documentação
- [ARQUITETURA](docs/ARQUITETURA.md)
- [MODELO_COMERCIAL](docs/MODELO_COMERCIAL.md)
- [FINANCEIRO_E_SPLIT](docs/FINANCEIRO_E_SPLIT.md)
- [AFILIADOS](docs/AFILIADOS.md)
- [SEGURANCA](docs/SEGURANCA.md)
- [TESTES](docs/TESTES.md)
- [DEPLOY](docs/DEPLOY.md)
- [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md)
- [CHANGELOG](docs/CHANGELOG.md)
- [PLANO_DE_EXECUCAO](docs/PLANO_DE_EXECUCAO.md)
- [PROPOSTA_POSTGRESQL](docs/PROPOSTA_POSTGRESQL.md)
- [FOOD_PLANO](docs/FOOD_PLANO.md)
- [CITSHOP_PRINT](docs/CITSHOP_PRINT.md)
- [MANUAL_RESTAURANTE](docs/MANUAL_RESTAURANTE.md)
