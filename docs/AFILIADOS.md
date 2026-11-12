# Afiliados · auditoria (CITshop 2.0, Fase 7)

## Como funciona hoje
- **Coleta**:
  - `servidor/afiliados.js` roda o robô a cada 8 h;
  - `servidor/coletor.js` coleta a Shopee pelo cookie do painel e a Amazon pelas páginas públicas a cada 4 h;
  - a Amazon Creators API roda a cada 50 min, porque o preço só pode ficar guardado por 1 h;
  - o motor (`servidor/motor-ofertas/`, agendado por `tarefas/agendador.js`) coleta por marketplace.
- **Adaptadores** (`servidor/integracoes/`): amazon, shopee, mercado-livre, shein, mais os canais whatsapp, instagram e telegram. Todos herdam de `base.js`, que padroniza status e contagem de sucesso e erro.
- **Publicação** (`motor-ofertas/publicador.js`), em ordem:
  1. normaliza;
  2. preserva o último catálogo válido do marketplace que falhou;
  3. remove duplicados;
  4. aplica o **validador**;
  5. aplica o histórico de preço;
  6. ranqueia (25 por categoria, 400 no total);
  7. grava de forma atômica.

## Regras de qualidade (validador.js)
Um produto só é publicado se tiver:
- identificador externo;
- preço maior que zero;
- imagem http(s) ou `/fotos/`;
- disponibilidade (não esgotado);
- categoria;
- **link com atribuição de afiliado conferida por marketplace**:
  - Amazon: `tag`;
  - Shopee: `s.shopee` ou `utm_source=an_`;
  - Mercado Livre: `/sec/` ou `matt_tool`;
  - SHEIN: `shein.top` ou `aff_id`.

Os rejeitados aparecem no admin (Central de Ofertas), com o motivo.

## Histórico de preço (coletor.js `aplicarHistorico`)
- Guarda um preço por produto por dia, por 30 dias, em `historico.json`.
- O selo **queda** aparece quando o preço caiu mais de 3% em relação ao maior preço dos 7 dias anteriores.
- O selo **menor30** marca o menor preço dos 30 dias, quando o produto já esteve pelo menos 3% mais caro.
- Sem histórico, o produto não ganha selo: o desconto só aparece com histórico de verdade.

## Relatório por plataforma
O `motor-status.json` guarda:
- `porMarketplace` (publicados por loja);
- `statusPorLoja` (ok ou erro);
- `desativadosRecentes`.

O admin mostra esses dados na Central de Ofertas, e a Shopee tem relatório próprio (`/api/admin/shopee`).

## Achados (sem mudança de código nesta fase)
1. **Marketplace desconhecido passa na regra do link.** `validarLinkAfiliado` devolve `true` para lojas fora das 4 conhecidas, então um item manual sem `marketplace` é publicado com qualquer link. O risco é baixo, porque os manuais são escritos pela CIT. Correção sugerida: recusar quando o marketplace não for reconhecido.
2. **O "de/por" vem do marketplace.** O `precoAntigo` exibido como "X% OFF" não é conferido com o histórico. Sugestão: só mostrar o OFF quando `precoAntigo` for no máximo o maior preço dos 30 dias.
3. **Duas rotinas coletam Amazon e Shopee** (robô/coletor em `servidor.js` e o motor em `agendador.js`). Funciona, porque o publicador consolida, mas é trabalho repetido. Unificar exige decisão, já que muda a infraestrutura de coleta.

As duas primeiras correções mudam o que é publicado. Por isso ficam para aprovação.
