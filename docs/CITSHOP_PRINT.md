# CITshop Print

Programa que roda no computador do restaurante e imprime sozinho os pedidos do CITshop Food em impressora térmica (ESC/POS).
O código fica em `citshop-print/`, usa Node 22 e não tem dependências.

## Como funciona
1. O cliente faz o pedido. O servidor confirma: pagamento na entrega, ou pagamento online aprovado pelo Mercado Pago.
2. O pedido aparece na tela da cozinha e o servidor cria um **trabalho de impressão**.
   - A chave única é `pedido:tipo:versão`; um evento repetido não cria outro.
   - Só cria se houver um computador vinculado.
3. O app pergunta a cada 5 s, monta a comanda em ESC/POS e manda para a impressora.
4. O app grava no disco que enviou e **depois** avisa o servidor (`enviado`).
   - Se cair entre um passo e outro, ao voltar só avisa: não imprime de novo.
5. Se a impressora falhar (desligada, sem papel, cabo solto):
   - o trabalho volta como `erro` e aparece no painel;
   - o app tenta de novo em 15 s, 30 s, 1 min… até 5 min entre tentativas, por até 20 tentativas;
   - trabalhos com mais de 12 h expiram sem imprimir.

**"Enviado" não é "impresso".** A maioria das térmicas não confirma que o papel saiu. O sistema registra que os bytes foram entregues à impressora ou ao spooler do Windows.

## Instalar (restaurante)
1. No painel do restaurante, abra **Cozinha e impressão → Baixar CITshop Print** e instale.
2. Abra o programa. A configuração aparece no navegador, em `http://127.0.0.1:17777`.
3. No painel, toque em **Gerar código da impressora**. O código vale 15 minutos e uma vez só. Digite-o no programa.
4. Escolha a impressora:
   - **Instalada neste computador** (USB ou compartilhada): precisa do driver do fabricante instalado no Windows;
   - **Na rede**: informe o IP; a porta é 9100.
5. Escolha a largura (58 ou 80 mm) e toque em **Imprimir teste**.
6. Para iniciar junto com o Windows, coloque um atalho do `citshop-print.exe` em `shell:startup`.

## Segurança
- O vínculo usa um código de 15 minutos e uso único. Ele vira um token que vale **só para imprimir pedidos daquele restaurante**: não lê o painel, os clientes nem o financeiro.
- O servidor guarda apenas o hash do token.
- O token é trocado a cada 24 h. O dono ou o admin podem revogá-lo a qualquer momento, e o computador perde o acesso na hora.
- No Windows, o token fica cifrado pelo DPAPI (só aquele usuário daquele computador consegue ler). Em outros sistemas, fica num arquivo com permissão 0600.
- A tela de configuração só responde em `127.0.0.1`. Ela recusa outro `Host` (DNS rebinding) e exige o cabeçalho `X-CIT`, para que um site não consiga mexer nela pelo navegador.

## Comandas
- **Completa:** cliente, telefone, endereço, itens com opções e observações, valores, pagamento.
- **Cozinha:** só itens, opções e observações, sem valores e sem contato.
- **Cliente / expedição:** completa, sem o telefone.
- **Reimpressão:** é sempre manual, pelo painel ou pelo histórico do app, e sai marcada como "REIMPRESSÃO".
- Observações e alergias saem em destaque, com o texto invertido.

## Compatibilidade e limites
| Situação | Suporte |
|---|---|
| Térmica ESC/POS em rede (Epson TM-T20/T88, Elgin i9, Bematech MP-4200, Daruma DR800, Tanca e outras) | Sim, porta RAW 9100 |
| Térmica USB com driver Windows instalado | Sim, RAW pelo spooler (winspool) |
| USB sem driver (só "dispositivo desconhecido") | Não. É preciso instalar o driver do fabricante. |
| Impressora comum (jato de tinta ou laser) | Não. Ela não entende ESC/POS. |
| macOS/Linux | Preparado (CUPS `lp -o raw`), mas não testado |
| Sem papel ou tampa aberta | Detectado só quando o driver recusa o trabalho. Em rede, a maioria aceita os bytes mesmo assim. |
| Acentos | Tabela CP860; o que não existe na tabela sai sem acento |

**Testado:**
- geração ESC/POS;
- envio por TCP para uma impressora simulada;
- fila, anti-duplicidade, impressora desligada, queda de internet, reinício do app, troca e revogação do token (`teste/print.test.js`).

**Não testado com hardware real** (nenhuma impressora física, nenhum Windows):
- a saída USB e o spooler do Windows (PowerShell/winspool);
- o instalador.

Estes três pontos precisam de homologação num computador do restaurante.

## Gerar o executável (Windows)
No Windows, com Node 22: `cd citshop-print && npm run build:win`, que gera `dist/citshop-print.exe` com Node SEA. Antes de distribuir, assine com o certificado de assinatura de código da CITmax; sem assinatura, o Windows mostra o aviso "Editor desconhecido". Depois, publique o arquivo em `<DADOS_DIR>/downloads/citshop-print.exe` na VPS: o painel passa a oferecer o download em `/downloads/citshop-print`.

## Estações (próximo passo)
Cada item do cardápio já tem `estacao` (forno, chapa, bebidas…), e cada trabalho guarda o `tipo`. Para ter uma impressora por estação, faltam duas coisas:
- vincular um app por estação;
- filtrar os trabalhos por estação na rota `/api/print/trabalhos`.
