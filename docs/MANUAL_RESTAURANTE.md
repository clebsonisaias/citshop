# Manual do restaurante · CITshop Food

## 1. Criar a conta
1. Acesse **shop.citmax.com.br/restaurante** e toque em **Cadastrar restaurante**. São 30 dias grátis.
2. Se tiver cupom de fundador (**FOODFUNDADOR50**), coloque no cadastro. A mensalidade cai pela metade enquanto a assinatura estiver ativa.
3. O plano é o **FOOD PRO**: mensalidade fixa, **sem comissão** sobre os pedidos e sem limite de faturamento. Você assina em **Conta e plano**.

## 2. Montar o cardápio (aba Cardápio)
- Cada item tem nome, categoria, descrição, preço, foto e **opções**.
- Escreva as opções uma por linha, no formato `Nome [mínimo-máximo]: Opção=preço, Opção`:
  - `Tamanho [1-1]: Média=40, Grande=55` → o cliente é obrigado a escolher 1;
  - `Sabores [1-2]: Calabresa, Frango=3` → escolhe 1 ou 2 (pizza meio a meio);
  - `Borda [0-1]: Catupiry=8` → opcional;
  - `Adicionais [0-3]: Queijo=4, Bacon=5` → até 3.
- Se o preço depende do tamanho, deixe o preço base em 0.
- **Marcar indisponível** tira o item do cardápio sem apagá-lo.
- **Estação** (forno, chapa, bebidas) ajuda a cozinha a filtrar os itens.

## 3. Funcionamento (aba Funcionamento)
- Marque os dias e os horários. Horário que passa da meia-noite funciona normal, por exemplo das 18:00 às 02:00.
- Feriados fechados, tempo de preparo, pedido mínimo, entrega e retirada.
- **Taxa de entrega:**
  - taxa fixa nesta aba;
  - ou por distância (faixas em km, com mapa) em **dados do estabelecimento → Entrega**.
- **Pausar 20 min** (cozinha cheia) e **Fechar agora** não apagam os horários.

## 4. Receber pedidos
- Os pedidos aparecem na aba **Pedidos** e na **tela da cozinha**. O restaurante também recebe um aviso no WhatsApp.
- **Pagamento:**
  - na entrega (dinheiro, cartão ou Pix);
  - online, depois de conectar o Mercado Pago em **Conta e plano**. O dinheiro cai direto na sua conta, e o pedido só aparece depois de aprovado.
- **Situações:** Novo → Aceito → No preparo → Pronto → Saiu para entrega / Retirado → Entregue → Concluído.
  - O cliente é avisado no WhatsApp quando o pedido é aceito, fica pronto (retirada), sai para entrega ou é cancelado.

## 5. Tela da cozinha
1. Na aba **Cozinha e impressão**, toque em **Novo link da cozinha** e abra o link no tablet ou celular da cozinha.
2. Toque em **Ativar som** para ouvir o aviso de pedido novo, e use **Tela cheia** se quiser.
3. Pela tela da cozinha, a equipe pode **aceitar, preparar e marcar como pronto**. Cancelar e despachar ficam com o atendimento (link do atendimento) ou com o dono.
4. Pedido atrasado (passou do tempo de preparo) fica em vermelho.
5. Perdeu o tablet? Toque em **Revogar** no painel e o link para de funcionar na hora.

## 6. Impressora
Veja o guia completo em `CITSHOP_PRINT.md`. Resumo:
1. Instale o **CITshop Print** no computador do caixa.
2. Gere o código da impressora no painel e digite no programa.
3. Escolha a impressora térmica e imprima o teste.

Sem impressora, tudo funciona pela tela da cozinha. Se o computador desligar, os pedidos continuam na tela, e a impressão volta sozinha quando o programa abrir de novo.
