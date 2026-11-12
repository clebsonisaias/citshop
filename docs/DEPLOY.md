# Deploy

- O **Coolify** publica sozinho cada push em `main`, que é **produção**. O trabalho fica no branch `citshop-2.0` e só entra em `main` com autorização.
- O comando é `npm start`, e `DADOS_DIR` precisa ser um volume persistente.
- Ponto de restauração: a tag `antes-citshop-2.0`. Para voltar, faça redeploy do commit dessa tag, porque o formato dos dados é compatível (só ganhou campos novos).
- Depois de publicar, confira:
  - `/saude`;
  - a vitrine;
  - o `/painel` de uma loja;
  - o `/admin` → Início;
  - a Central de Ofertas.

## Variáveis de ambiente
| Grupo | Variáveis |
|---|---|
| Obrigatórias | `SESSAO_SEGREDO`, `ADMIN_SENHA_HASH`, `URL_PUBLICA`, `DADOS_DIR`, `PORT` |
| Mercado Pago | `MP_ACCESS_TOKEN`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET` |
| WhatsApp (WAHA) | `WAHA_API_URL`, `WAHA_SESSION`, `WAHA_API_KEY` |
| Shopee | `SHOPEE_APP_ID`, `SHOPEE_SECRET`, `SHOPEE_COOKIE` |
| Amazon | `AMAZON_TAG`, `AMAZON_PARTNER_TAG`, `AMAZON_CREDENCIAL_ID`, `AMAZON_CREDENCIAL_SEGREDO`, `AMAZON_CREDENCIAL_VERSAO`, `AMAZON_DESATIVADA`, `DESATIVAR_AMAZON` |
| Mercado Livre | `MERCADO_LIVRE_ACCESS_TOKEN`, `MERCADO_LIVRE_AFFILIATE_TAG` |
| SHEIN | `SHEIN_AFFILIATE_ID` |
| Instagram | `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_PAGE_ACCESS_TOKEN`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Robô | `ROBO_TOKEN` |
