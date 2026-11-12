# Financeiro e split

Código: `servidor/financeiro.js` (livro e retrato), `servidor/mercadopago.js` (API), webhook em `servidor/app.js` (`POST /webhook/mercadopago`).

## Livro de lançamentos (`citshop.json` → `lancamentos`)
Registra a **receita do CITshop**, não o volume vendido pelas lojas.

| Tipo | Quando entra | Valor |
|---|---|---|
| `mensalidade` | Cobrança mensal aprovada de uma assinatura (tópico `subscription_authorized_payment`) | valor cobrado (ex.: 99,90 ou 49,95) |
| `comissao` | Venda de parceiro aprovada (primeira vez que o pagamento vira `approved`) | comissão do retrato do pedido |
| `reembolso` | Pagamento de parceiro reembolsado ou cancelado depois de aprovado | − comissão |
| `chargeback` | Contestação (`charged_back`) | − comissão |
| `afiliado` | Reservado: as comissões de afiliados ainda vêm só do relatório da Shopee no admin (estimadas, não confirmadas) | — |
| `ajuste` | Reservado para correções manuais futuras (sempre como novo lançamento) | ± |

Regras: o livro **só cresce** (nada é editado ou apagado); cada lançamento tem uma `chave` única (`comissao:<pedido>`, `estorno:<pedido>`, `mensalidade:<cobrança>`), então o mesmo evento processado várias vezes lança uma vez só.

## Retrato financeiro do pedido (`pedido.financeiro`)
Gravado no momento da venda: `modelo` (parceiro/mensal), `unidades`, `comissaoPorUnidade`, `comissaoTotal`, `valorProdutos`, `frete`, `valorTotal`, `moeda`. A comissão lançada sai do retrato: mudar a comissão da loja depois não recalcula pedidos antigos. Pedidos de antes do 2.0 usam o `taxaMarketplace` gravado neles.

## Comissão
- Parceiro especial: R$ 1,00 × unidades (ou o valor por unidade combinado no admin), calculada no servidor; valores enviados pelo aparelho são ignorados.
- Loja de mensalidade: **sempre zero** (testado com 1, 100 e 1.000 unidades). Lojas de mensalidade nem passam pelo split: vendem pelo WhatsApp.

## Split no Mercado Pago
- A cobrança é criada **com o token da loja** (OAuth): o dinheiro cai na conta dela e a comissão vai para a conta da plataforma como `marketplace_fee` (Checkout Pro) ou `application_fee` (Pix). O frete entra como item da cobrança, sem comissão.
- **Checkout por loja:** cada cobrança tem um único vendedor (um token). Carrinho com várias lojas finaliza uma loja por vez. Checkout multivendedor num pagamento só não é suportado por esse modelo de split e não foi implementado.
- Reembolso parcial: o status do pagamento continua `approved`; hoje não gera lançamento (registrar ajuste manual). Reembolso total, cancelamento e chargeback geram estorno.

## Webhook
1. Assinatura `x-signature` conferida (sem `MP_WEBHOOK_SECRET` tudo é recusado).
2. O corpo nunca é confiado: o pagamento é **relido na API** com o token da loja (vendas) ou da plataforma (assinaturas).
3. Efeitos idempotentes: estoque com `estoqueBaixado`, aviso de venda só na primeira aprovação, livro por chave.
4. Todo evento fica em `eventosMp` (5.000 últimos) para auditoria.

## A validar com credenciais de teste do Mercado Pago (não feito com dinheiro real)
- O retorno de `GET /authorized_payments/{id}` (campos `preapproval_id`, `transaction_amount`, `payment.status`) foi implementado conforme a documentação; confirmar com uma assinatura de teste.
- O estorno do `marketplace_fee` em reembolso total é do Mercado Pago; o livro registra a devolução da comissão.
