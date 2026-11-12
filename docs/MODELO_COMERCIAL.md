# Modelo comercial

As regras ficam em `servidor/planos.js` e a configuração editável em `citshop.json` → `comercial` (preço oficial e cupons de assinatura). Nada de preço escrito em tela: o painel lê `GET /api/planos`.

| Modalidade | Como entra | Cobrança | Comissão por venda |
|---|---|---|---|
| Loja convencional | cadastro aberto em `/painel` | 30 dias de teste, depois **R$ 99,90/mês** (assinatura recorrente no Mercado Pago) | **nunca** |
| Loja fundadora | cupom **FUNDADOR50** no cadastro ou no painel, durante a campanha | **R$ 49,95/mês** (50% sobre R$ 99,90) desde a primeira cobrança, em todas as renovações enquanto a assinatura existir | nunca |
| Parceiro especial | só por convite de uso único (admin → Convites) | sem mensalidade e sem teste | **R$ 1,00 por unidade** vendida pelo checkout do CITshop (split Mercado Pago) |

## Preço contratado
Ao assinar, o servidor calcula o valor (preço oficial, com o benefício da loja se houver) e grava em `loja.plano.precoContratado`. Esse é o valor do `preapproval` no Mercado Pago, então as renovações seguem com ele. **Mudar o preço oficial no admin só vale para assinaturas novas.** Lojas que assinavam antes do 2.0 ficaram com `precoContratado: 49,90` e `legado: true`.

## FUNDADOR50
- Criado na primeira subida do 2.0, valendo por **90 dias**; o admin muda a data de fim (prorroga ou encerra) e ativa/desativa em **Admin → Planos** (tudo vai para o registro de alterações).
- Um benefício por loja, não cumulativo, não transferível.
- Sem duplicidade: o mesmo **CNPJ** (quando informado) ou o mesmo **WhatsApp** não usa o cupom em outra loja.
- Atraso (assinatura `pausada` no Mercado Pago) **não** tira o benefício; a recuperação do pagamento volta a `authorized` com o mesmo preço.
- Cancelamento definitivo de uma assinatura que chegou a ser autorizada encerra o benefício (`beneficio.encerradoEm`); ele não pode ser aplicado de novo e uma nova assinatura sai pelo preço oficial.
- O preço enviado pelo aparelho é ignorado: o valor sai do servidor.

## Estados da assinatura
`pendente` (criada, aguardando pagamento) · `authorized` (ativa) · `pausada` (cobrança em atraso) · `cancelada`. Um único ponto grava as mudanças (`registrarEstadoAssinatura`), usado pelo webhook, pela sincronização a cada 6 h e pela volta do checkout.

## Testes
`teste/planos.test.js`: 99,90 · 49,95 · preço do aparelho ignorado · cupom inexistente · CNPJ inválido · CNPJ e WhatsApp duplicados · não cumulativo · fim da campanha e prorrogação · preço oficial alterado sem afetar contratos · pausa, recuperação e cancelamento · assinante legado em 49,90 · parceiro sem mensalidade.
