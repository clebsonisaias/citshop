# Arquitetura

- **Servidor:**
  - Node 22 + Express (ESM), sem etapa de build;
  - `servidor/servidor.js` sobe o app e agenda as tarefas;
  - `servidor/app.js` (`criarApp`) tem todas as rotas e recebe `env`, `fetchImpl` e `agora`, que são injetáveis nos testes.
- **Dados:**
  - `servidor/dados.js` (`Banco`): um JSON (`<DADOS_DIR>/citshop.json`) na memória, gravado com escrita atômica a cada mudança;
  - backup diário com 14 dias de rotação em `<DADOS_DIR>/backups`;
  - fotos em `<DADOS_DIR>/uploads`, a única pasta de dados servida ao público.
- **Módulos:**
  | Arquivo | Responsabilidade |
  |---|---|
  | `planos.js` | Preço, cupons de assinatura (FUNDADOR50) e estado da assinatura |
  | `financeiro.js` | Livro de lançamentos imutável e idempotente, retrato financeiro do pedido |
  | `mercadopago.js` | Assinatura (preapproval), OAuth da loja, split (`marketplace_fee`), webhook com assinatura |
  | `seguranca.js` | Senha scrypt, sessão HMAC em cookie, limitador, cabeçalhos/CSP |
  | `uploads.js` | Fotos com sharp (WebP) |
  | `coletor.js`, `afiliados.js`, `motor-ofertas/*`, `integracoes/*` | Afiliados e canais (WhatsApp/WAHA, Instagram, Telegram) |
  | `tarefas/*` | Agendador do motor e status |
- **Front-end:**
  - HTML e JS puro em `publico/`, com uma folha `estilo.css`;
  - a CSP `script-src 'self'` proíbe script inline, então cada página tem o seu `.js`.
- **Sessões:**
  - cookie HMAC para loja e admin;
  - a sessão da loja leva a versão da senha (trocar a senha derruba as outras sessões).
- **Tarefas** (`tarefa(nome, fn)`):
  - afiliados 8 h, coletor 4 h, amazon 50 min, assinaturas 6 h, alertas 1 h, story 1 h, backup 24 h;
  - o estado aparece em `/saude` e `/api/admin/saude`.

## Decisões pendentes
- **Usuários e permissões do admin:** hoje há uma senha só.
- **Conta de comprador:** a avaliação usa o link do pedido.
- **Filtro por loja:** a vitrine é uma loja só.
- **PostgreSQL:** proposta em `PROPOSTA_POSTGRESQL.md`.
