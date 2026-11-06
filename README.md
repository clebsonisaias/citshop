# CITshop

Vitrine de afiliados: o visitante escolhe aqui e compra no Mercado Livre, na Shopee ou na Amazon.

Sem servidor e sem banco de dados. É um site estático que lê `produtos.json`. Um robô no GitHub Actions atualiza esse arquivo 3 vezes por dia.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | A vitrine (busca, filtros por loja e categoria, ordenação) |
| `produtos.json` | Gerado pelo robô. Não edite à mão |
| `manual.json` | Produtos colados à mão (Mercado Livre e Amazon) |
| `scripts/atualizar.mjs` | O robô: puxa da Shopee, junta com o manual e marca quedas de preço |
| `.github/workflows/atualizar.yml` | Roda o robô às 6h, 12h e 18h |

## Colocar no ar

1. Suba esta pasta num repositório no GitHub.
2. Em **Settings → Secrets → Actions**, crie `SHOPEE_APP_ID` e `SHOPEE_SECRET`, que ficam no painel de afiliados da Shopee em Open API.
3. Conecte o repositório na Cloudflare Pages ou na Vercel (as duas são grátis pra repositório privado). Não precisa de comando de build: a pasta publicada é a raiz.
4. Em **Actions → Atualizar ofertas → Run workflow**, rode a primeira vez.

## Mercado Livre e Amazon

O Mercado Livre não tem API pública pra gerar link de afiliado, então você gera o link no painel de afiliados e cola em `manual.json`:

```json
{ "id": "ml-123", "nome": "…", "loja": "ml", "categoria": "cozinha",
  "preco": 349, "precoAntigo": 499, "nota": 4.8,
  "imagem": "https://…jpg", "link": "https://mercadolivre.com/sec/…" }
```

### Amazon direto no carrinho

Nos produtos da Amazon, coloque `"loja": "amazon"` e o `"asin"`, que é o código depois de `/dp/` no link do produto. Depois crie a variável `AMAZON_TAG` em **Settings → Variables → Actions** com a sua tag de associado, por exemplo `seunome-20`.

Com isso, o botão "Comprar" coloca o produto direto no carrinho da Amazon com a sua tag. O cliente só clica em "Fechar pedido" e cai na tela de finalização. Confirmar o pagamento é sempre com ele, dentro da conta Amazon dele.

No Mercado Livre e na Shopee, o botão leva à página do produto. Link pro carrinho ou pro pagamento não conta comissão no Mercado Livre.

Quando sua conta Amazon tiver acesso à Creators API, dá pra puxar os produtos automaticamente, como na Shopee.

Categorias aceitas: `tec`, `cozinha`, `casa`, `beleza`, `games`, `pets`.

## Rodar no seu computador

```bash
node --test scripts/atualizar.test.mjs
node scripts/atualizar.mjs
python3 -m http.server 8080
```

Depois abra http://localhost:8080. Abrir o `index.html` direto com dois cliques não funciona, porque o navegador bloqueia a leitura do `produtos.json`.
