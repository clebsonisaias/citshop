# Central de Automação de Afiliados - CITshop

Documentação técnica da esteira automatizada multi-afiliados para **Amazon Brasil**, **Shopee Brasil** e **Mercado Livre**.

---

## 1. Arquitetura Implementada

A esteira foi construída em módulos desacoplados no backend (`servidor/`):

```text
servidor/
├── integracoes/
│   ├── base.js                     # Classes ConectorMarketplace, ProvedorLinkAfiliado e ErroConector
│   ├── amazon/
│   │   └── conector.js             # Creators API oficial (OAuth2, searchItems, getItems e partnerTag)
│   ├── shopee/
│   │   └── conector.js             # Affiliate Open API (GraphQL SHA256, productOfferV2 e generateShortLink)
│   └── mercado-livre/
│       └── conector.js             # Catálogo público MLB e ProvedorLinkMercadoLivre
│
├── motor-ofertas/
│   ├── coletor.js                  # Orquestração paralela com isolamento de falhas
│   ├── normalizador.js             # Mapeamento canônico e padronização com DEPTS
│   ├── deduplicador.js             # Identificação de duplicidades por ID e similaridade
│   ├── validador.js                # Regras de qualidade e conferência obrigatória de afiliação
│   ├── ranking.js                  # Algoritmo de score (desconto real, comissão, nota, vendas, histórico)
│   └── publicador.js               # Gravação atômica da vitrine mantendo último catálogo válido
│
└── tarefas/
    ├── agendador.js                # Mutex para concorrência e timers independentes
    └── monitoramento.js            # Auditoria sem segredos, métricas de cliques e configurações dinâmicas
```

---

## 2. Garantias e Regras Fundamentais

1. **Prioridade Visual Intocada:** Produtos cadastrados pelas lojas locais (em teste ou pagantes) continuam com precedência absoluta no topo da vitrine via `ordenarVitrine()`.
2. **Sem Links Inválidos ou Falsos:** Nenhum produto é publicado como afiliado sem link devidamente validado e atribuído com tag oficial.
3. **Resiliência a Falhas Externas:** Se uma API responder com erro (ex: 429 ou 500), a rodada **não** apaga as ofertas anteriores válidas daquele marketplace.
4. **Segurança de Credenciais:** Tokens, chaves e segredos vivem exclusivamente no backend e são sanitizados de qualquer log de erro.

---

## 3. Variáveis de Ambiente no Coolify

Configure no painel do Coolify (**Projects** → **CITmax - CITshop** → **production** → **citshop** → **Environment Variables**):

| Marketplace | Variável | Obrigatória | Descrição |
|---|---|---|---|
| **Amazon** | `AMAZON_CREDENCIAL_ID` | Sim (p/ Creators API) | Credential ID gerado no Associates Central |
| **Amazon** | `AMAZON_CREDENCIAL_SEGREDO` | Sim (p/ Creators API) | Credential Secret da Creators API |
| **Amazon** | `AMAZON_PARTNER_TAG` | Sim | Tag de afiliado (ex: `citshop-20`) |
| **Amazon** | `AMAZON_TAG` | Sim (fallback) | Tag de afiliado para links manuais de carrinho |
| **Shopee** | `SHOPEE_APP_ID` | Sim (p/ Open API) | App ID da Shopee Affiliate Open API |
| **Shopee** | `SHOPEE_SECRET` | Sim (p/ Open API) | Secret da Shopee Affiliate Open API |
| **Mercado Livre** | `MERCADO_LIVRE_AFFILIATE_TAG` | Opcional | Tag/Tracking ID de afiliado do Mercado Livre |

---

## 4. Gestão pelo Painel Administrativo

Acesse `/admin` com a senha de administrador:
* **Métricas em Tempo Real:** Veja a contagem de ofertas publicadas por loja (Amazon, Shopee, Mercado Livre).
* **Cliques em Afiliados:** Total de cliques computados de forma anônima e agregada.
* **Configuração Dinâmica:** Altere palavras-chave, limites por categoria e limite total de ofertas sem precisar reiniciar a aplicação.
* **Executar Coleta Agora:** Dispare manualmente a coleta e publicação com feedback visual imediato.
* **Ofertas Desativadas:** Auditoria dos produtos rejeitados e o motivo exato (preço zero, link sem afiliação, sem estoque, etc.).

---

## 5. Procedimento de Implantação e Rollback

### Implantação
1. Comitar e enviar as alterações para a branch `main`:
   ```bash
   git add .
   git commit -m "feat: central de automacao multi-afiliados (Amazon, Shopee, Mercado Livre)"
   git push origin main
   ```
2. No Coolify, clicar em **Redeploy**.

### Rollback (Se necessário)
Caso haja qualquer imprevisto:
1. Reverter o commit na branch `main`:
   ```bash
   git revert HEAD -m 1
   git push origin main
   ```
2. Disparar o **Redeploy** no Coolify.
3. Os dados das lojas locais (`citshop.json`) e fotos de uploads permanecem 100% seguros no volume persistente `/app/dados`.
