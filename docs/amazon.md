# Amazon Afiliados (Creators API)

Integração oficial com a Amazon Brasil (`www.amazon.com.br`) pela **Creators API**, que substitui a PA-API 5 (descontinuada). Sem scraping.

## Como funciona

| Peça | Arquivo | O que faz |
|---|---|---|
| Cliente da API | `servidor/amazon.js` | Token OAuth2 (cacheado), `searchItems`, `getItems` (lotes de 10 ASIN), conversão para o catálogo e garantia da tag de afiliado no link. |
| Sincronização | `atualizarAmazon` em `servidor/afiliados.js` | Roda na subida e **a cada 50 minutos**. Grava `dados/amazon.json` e `dados/amazon-status.json`. Separada do robô da Shopee (8 em 8 horas). |
| Vitrine | `afiliados()` em `servidor/app.js` | Junta a Amazon da API ao catálogo **só enquanto tiver menos de 1 hora**. Depois disso some, em vez de mostrar preço vencido. Se o mesmo ASIN estiver em `manual.json`, vale o dado da API. |
| Admin | `/admin` → "Amazon Afiliados" | Mostra se está configurada, tag, marketplace, última sincronização, total e último erro. Testa a conexão com um ASIN. |

O que é buscado: as palavras de `BUSCAS_AMAZON` (`servidor/amazon.js`) e os ASIN dos itens `loja: "amazon"` de `manual.json`.

Regras seguidas:
- Preço, preço de lista e disponibilidade só quando a API devolve. Sem preço, o produto não aparece.
- O preço "de" só aparece se a própria API informar (`savingBasis`).
- O modal mostra a hora da consulta ("Preço consultado em … e pode mudar").
- Cache: oferta por no máximo 1 hora (regra da Creators API para Offers).
- Clique não é venda: o CITshop não registra vendas, só manda o visitante para a Amazon com a tag.

## Variáveis de ambiente (Coolify)

| Variável | Obrigatória | Exemplo | Uso |
|---|---|---|---|
| `AMAZON_CREDENCIAL_ID` | sim | — | Credential ID da Creators API |
| `AMAZON_CREDENCIAL_SEGREDO` | sim | — | Credential Secret (a Amazon mostra uma vez só) |
| `AMAZON_PARTNER_TAG` | sim | `citshop0e-20` | Store/Tracking ID do marketplace brasileiro |
| `AMAZON_CREDENCIAL_VERSAO` | não | `3.1` | Versão da credencial mostrada na Amazon (3.1 NA, 3.2 EU, 3.3 FE) |
| `AMAZON_TAG` | já existe | `citshop0e-20` | Links de carrinho dos itens manuais (não muda) |

Sem as três obrigatórias, a integração fica desligada e o resto do site funciona normalmente.

## Como conseguir as credenciais

1. A conta de Associados precisa estar **aprovada (final acceptance)** e ter **pelo menos 10 vendas qualificadas nos últimos 30 dias**. Sem vendas por 30 dias seguidos, o acesso é suspenso.
2. Só o **dono principal** da conta cria credenciais: Associates Central → Tools → Creators API.
3. Copie Credential ID, Credential Secret e a versão, e cadastre no Coolify (app citshop → Environment Variables). Depois, faça redeploy.
4. Em `/admin` → "Amazon Afiliados", teste com um ASIN (ex.: `B0H3Q1RHD7`).

Cota inicial: 1 requisição por segundo e 8.640 por dia nos primeiros 30 dias. Depois, depende da receita. Cada rodada usa 3 buscas + 1 lote de ASIN.

## A confirmar com a conta real

A documentação lida não deixa claro, então o primeiro teste no admin vai confirmar:
- O endpoint `https://creatorsapi.amazon/catalog/v1/...` e o de token (`api.amazon.com`) para credenciais do Brasil.
- Qual versão da credencial vale para o Brasil.
- Os nomes de recursos pedidos (`offersV2.listings.savingBasis` principalmente). Se a Amazon recusar algum, o erro aparece no admin.
- Se o preço volta em BRL.

## Prioridade por comissão

Na vitrine e no post diário do Instagram, os produtos da Amazon são ordenados pela comissão da categoria. A tabela fica em `COMISSAO_AMAZON`, em `servidor/afiliados.js`:

| Comissão | Categorias |
|---|---|
| 13% | Beleza, saúde, bebê e mercado |
| 11% | Moda e pets |
| 10% | Livros |
| 8% | Eletrônicos, casa e a maioria das categorias |
| 7% | Calçados, automotivo e outras |

No empate, vem primeiro quem rende mais R$ por venda.
