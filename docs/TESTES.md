# Testes

```bash
npm run teste        # node --test teste/*.test.js — 102 testes
```
- Cada teste sobe o app numa porta livre com dados num diretório temporário e um `fetchImpl` falso (sem Mercado Pago, WhatsApp ou internet de verdade).
- Senhas e segredos de teste são gerados na hora (`randomBytes`).
- Principais arquivos:
  | Arquivo | O que cobre |
  |---|---|
  | `planos` | Preço, FUNDADOR50, cancelamento, recuperação |
  | `financeiro` | Comissão por unidade, webhook repetido, estorno, chargeback, mensalidade |
  | `mercadopago-split`, `pedidos`, `frete`, `estoque` | Venda |
  | `lojista` | Painel |
  | `admin-painel` | Admin |
  | `avaliacoes` | Avaliações |
  | `saude` | Saúde e backup |
  | `coletor`, `motor-ofertas`, `radar`, `integracoes-*` | Afiliados |
- **Navegador:** prévia local com dados fictícios. Playwright passa pelas abas em 375 e 1280 px conferindo a rolagem horizontal e tira capturas.
- **Sem cobertura automática:** cobrança real do Mercado Pago (`authorized_payments`), que precisa de conta de teste.
