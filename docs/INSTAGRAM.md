# Instagram @citshopping

## Postagem diária (`servidor/instagram-diario.js`)
- **Quando:** vem ligada por padrão, às 11:00 e às 19:00 (Brasília). Os horários mudam no admin, em Canais → Configurações da Meta → Postagem diária.
- **Como:** a tarefa `instagram` confere a cada 10 min. No horário da vez (até 3 h depois dele), sai 1 post no Feed e, se ligado, também no Story. Cada horário posta uma vez só.
- **Escolha:**
  1. Primeiro, o **mais buscado da semana** no site, com 2 ou mais buscas e sem post nos últimos 3 dias. Entra o produto que melhor responde: loja da cidade primeiro, senão a melhor oferta. Há sinônimos para coisas de criança: "roupinha de menina" acha os laços infantis.
  2. Sem busca suficiente, rodízio: um horário vai para loja da cidade (a que postou há mais tempo), o outro para a melhor oferta de afiliado (desconto, queda de preço, menor preço em 30 dias, vendas, nota).
  3. O mesmo produto não volta em 14 dias. Se tudo já saiu, repete o postado há mais tempo, porque todo dia tem post, com ou sem promoção.
- **Falhas:** cada horário tenta até 3 vezes. A falha aparece em `/saude` e no alerta do WhatsApp. O histórico, com o motivo de cada post, fica no admin.
- **Buscas do site:** `POST /api/busca` guarda só o texto buscado (sem dado de quem buscou; telefone e CPF são descartados). Os totais ficam por dia em `<DADOS_DIR>/buscas.json` (60 dias).

## Token da Meta
- **O que aconteceu em 12/11/2026:** o token venceu às 08h e as postagens pararam.
- **Ao colar um token novo no admin:** o servidor confere na Meta. Se for token de usuário que vence, troca por token longo (com `INSTAGRAM_APP_SECRET`) e pega o **token da Página** ligada à conta, que não vence. Token inválido não é salvo.
- **Prioridade:** o token salvo no admin vale mais que a variável `INSTAGRAM_ACCESS_TOKEN`, que pode estar velha.
- **Campo vazio:** salvar a configuração com o campo de token vazio não apaga o token guardado.
- **Conferência diária:** uma vez por dia o token é testado. Se vencer, aparece em `/saude` e chega o alerta no WhatsApp.
- **Navegador:** o admin nunca recebe os tokens (`••••1234`).

## QUERO no comentário
- Quem comenta QUERO ou LINK num post publicado pelo sistema recebe no direct o nome, o preço e o link do produto.
- O link passa por `/ir/<produto>?c=instagram&p=<post>`:
  - o clique conta para o canal Instagram e para aquele post (robôs de prévia não contam);
  - na Shopee, o código do post vai como subId e a venda volta marcada com o post;
  - produto de loja da cidade abre a página do produto no site.
- Depois do direct, o @citshopping responde em público no comentário ("Te mandei o link no direct 💌", com variações). Dá para desligar no admin. Se a resposta pública falhar, o direct não é desfeito.
- **Admin → Resultados por post:** QUERO recebidos, directs enviados (e respostas públicas), cliques e pedidos/comissão Shopee por post.
- **Registro do webhook:** os últimos avisos da Meta (chegou, ignorado e por quê, direct enviado ou erro, qual post) aparecem no admin. Ficam na memória e somem a cada reinício do site.
- **Lado da Meta:**
  - webhook `https://shop.citmax.com.br/api/webhook/instagram` com o token de verificação igual a `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, e o campo `comments` assinado;
  - "Permitir acesso às mensagens" ligado no @citshopping;
  - em modo Desenvolvimento, só funciona para testadores do app; para qualquer cliente, o app precisa da Análise da Meta (`instagram_manage_comments`, `instagram_manage_messages`) e ficar Ativo.
