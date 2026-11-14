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

## Comissão por canal (`servidor/afiliados-canal.js`)
- Todo "Comprar" de oferta de afiliado passa por `/ir/<produto>?c=<canal>`. Canais:
  - `site`: janela da vitrine;
  - `produto`: página `/p`;
  - `whatsapp`: Radar;
  - `telegram`;
  - `instagram`;
  - `bio`;
  - `outros`.
- **Cliques:** contados por dia, canal e loja. Robôs de prévia de link (WhatsApp, Telegram, Facebook…) não contam.
- **Gravação:** a cada minuto e ao desligar, em `<DADOS_DIR>/cliques-canal.json` (120 dias).
- **Link por canal, só na Shopee:** gerado com `generateShortLink` e `subIds: ["citshop", canal]`, uma vez por produto+canal, e guardado 30 dias em `links-canal.json`.
  - Usa o `linkOriginal` (productLink) que o motor guarda.
  - Se a Shopee demora mais de 4 s, dá erro ou devolve destino fora das lojas parceiras, o clique vai para o link de afiliado de sempre: nunca fica preso nem sai do domínio das lojas.
- **Vendas por canal:** o `conversionReport` traz `utmContent` com os subIds, e o admin (aba Afiliados → Comissão por canal) mostra:
  - cliques;
  - pedidos;
  - comissão em andamento;
  - comissão confirmada.
  Vendas por links antigos ou diretos aparecem como "sem canal".
- **Livro financeiro:** a tarefa `comissoes-shopee` (a cada 6 h, também em `/saude`) lança como `afiliado` a comissão de cada pedido CONCLUÍDO, uma vez por pedido. Se o pedido for cancelado ou devolvido depois, entra um `ajuste` negativo, também uma vez só.
- **Não usado:** `validatedReport`. A documentação disponível não explica como obter o `validationId`. Hoje o livro usa o pedido concluído do `conversionReport`; dá para trocar quando houver a documentação oficial.

## Campanhas da Shopee na home
- **Atualização:** a tarefa `campanhas-shopee` (a cada 3 h, também em `/saude`) busca as campanhas e coleções da própria Shopee pelo `shopeeOfferV2`, ordenadas por comissão, e grava `<DADOS_DIR>/campanhas.json`.
- **Filtro** (`filtrarCampanhas`), o que entra:
  - tem nome;
  - imagem do CDN da Shopee;
  - link das lojas parceiras;
  - já começou e ainda não terminou;
  - sem repetidas.
  A ordem é das que acabam primeiro; no máximo 16. Vencidas saem na hora da leitura.
- **Home:** faixa "Campanhas Shopee" com imagem, nome e "Termina em…". O link não vai para a página: o clique passa por `/ir/campanha-…?c=site` (conta o clique e marca o canal, se a API devolver `originalLink`).
- **Ressalva:** os nomes dos campos vêm de documentação não oficial. Se a API recusar algum, o conector tenta de novo só com o essencial (nome, imagem, link e período).
- **Limite real da API:** 50 itens por página no `shopeeOfferV2` (a documentação não oficial dizia 500; a API real recusou com o erro 11001).

## Shopee: maior comissão primeiro

- O coletor pede as páginas gerais da Shopee ordenadas por comissão (`productOfferV2` com `sortType: 5`). Se a API recusar, busca sem ordenar.
- No ranking, as ofertas da Shopee ficam em ordem de ganho esperado: comissão em R$ (`comissaoEstimada`) × log10(vendas + 1). Produto caro sem venda nenhuma e comissão de centavos vão para o fim, mas continuam na vitrine.
- No post diário do Instagram, o horário de oferta de afiliado escolhe a de maior comissão. A comissão não aparece na vitrine pública.

## Temporadas (faixas de data na home)

`publico/temporadas.js` define cada data: período, palavras do nome que colocam o produto na faixa e buscas extras na Shopee.
- Decoração de Natal: 1/11 a 24/12.
- Mesa posta, Looks de fim de ano (branco, vermelho, amarelo) e Réveillon: 1/11 a 1/1.
- Volta às aulas: 1/1 a 28/2.

Durante a data, a faixa e o banner aparecem no topo da home, e o ranking dá à temporada uma cota própria de 40 produtos.

## Histórico de preço na página do produto

`GET /api/preco/:id` devolve até 30 dias de preço (`[dia, preço]`), tirados do `historico.json` da coleta. O `publico/historico-preco.js` desenha o gráfico em SVG no modal da home e na página `/p/<id>`. Com menos de 2 dias de histórico, o gráfico não aparece. Produto de loja local não tem histórico.

## Busca ao vivo

`GET /api/busca-ao-vivo?q=` completa a busca do site com o que o catálogo não tem:
- **Shopee:** busca o termo na hora pela API oficial (`buscarPorTermo`) e mostra até 12 produtos com o link de afiliado (`offerLink`).
- **Amazon:** botão para a busca da Amazon com a tag (`/s?k=<termo>&tag=`). Preço da Amazon só pode vir da API oficial, então não é mostrado.

Nada é gravado: cada termo fica 1 h na memória (até 500 termos), com limite de 30 consultas por IP a cada 10 min.

## Mercado Livre: atribuição

O link oficial do Gerador de links traz `matt_word=<etiqueta>&matt_tool=70471590`. `comAtribuicaoML` põe esses dois parâmetros nos links gerados e corrige, na hora de servir a vitrine, os links já gravados com `matt_tool=citshop`. Para trocar o número, use a variável `MERCADO_LIVRE_MATT_TOOL`.

## Mercado Livre: busca automática

A busca pública do Mercado Livre agora recusa quem não está logado. Por isso o robô busca com o token de uma conta conectada.

Passo a passo para ligar:

1. Crie um app em developers.mercadolivre.com.br.
   - Endereço de retorno (redirect URI): `https://shop.citmax.com.br/mercadolivre/retorno`.
   - Permissões: leitura e acesso offline (`offline_access`, que é o que gera o refresh token).
2. No Coolify, defina `MERCADO_LIVRE_CLIENT_ID` (o App ID) e `MERCADO_LIVRE_CLIENT_SECRET` (a chave secreta) e faça o Redeploy.
3. No admin, em "Mercado Livre Afiliados", clique em "Conectar conta do Mercado Livre" e autorize.

Como funciona depois de conectado:

- **Token:** fica cifrado em `banco.d.mercadoLivre` e vale 6 h. É renovado sozinho quando faltam 10 min, e o refresh token novo substitui o antigo.
- **Busca:** primeiro tenta `sites/MLB/search`. Se ela responder 403, usa `products/search` e escolhe o melhor anúncio de cada produto: mais vendido, frete grátis, desconto, preço.
- **Volume baixo:** 3 termos por rodada, em rodízio, e no máximo 150 consultas por dia (`limiteDiario`). Apps que consultam demais são bloqueados pelo Mercado Livre.
- **Falha:** se todos os termos falharem, a rodada lança erro e o motor mantém os produtos anteriores do Mercado Livre.
- **Etiqueta:** os links saem com `matt_word` (`MERCADO_LIVRE_AFFILIATE_TAG`) e `matt_tool`.

## Preço sempre atualizado (Shopee)

- **Coleta:** a da Shopee roda de hora em hora (`agendador.js`).
- **Preço na hora:** ao abrir um produto da Shopee (página `/p/<id>` ou modal da home), o site consulta o preço atual na API (`productOfferV2(itemId)`).
  - O resultado vale 30 min para novas consultas e entra na vitrine por até 6 h, ou até a próxima coleta trazer um preço mais novo.
  - Se a API não responder em 2,5 s, a página mostra o último preço conhecido.
  - Só consulta produtos que estão na vitrine.
- **Amazon:** continua no rodízio da coleta das páginas (o catálogo todo gira em cerca de 16 h).

## Temporada: foco em Shopee e SHEIN

- **Faixas:** nas faixas de temporada, Shopee e SHEIN vêm primeiro (`FOCO_TEMPORADA`).
- **Looks:** toda roupa da SHEIN entra em "Looks de fim de ano" (`porLoja`).
- **Vagas:** a cota por temporada é de 60 vagas por loja.
- **Post diário:** o horário de oferta escolhe produto de temporada da Shopee ou da SHEIN, alternando a loja que postou há mais tempo.
