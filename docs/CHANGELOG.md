# Changelog

## Black Friday (27/11/2026)

- **Campanha Black Friday automática (`servidor/campanha.js`)**: vale só na 4ª sexta-feira de novembro, de 00:00 a 23:59 (horário de Brasília); no sábado o site, o radar e o Instagram voltam ao normal, ativando selos `Especial Black Friday`, radar WhatsApp/Telegram e banner principal na home.
- **Ofertas Relâmpago por hora (`publico/black-friday.js`)**: seleção determinística por hora (Brasília) com contagem regressiva até a próxima rodada, exibida na home e em `/black-friday`.
- **Central `/black-friday` remodelada**: contagem regressiva em tempo real (dias/horas/min/seg), métricas reais do catálogo, compartilhamento no WhatsApp, faixa de Ofertas Relâmpago e filtros/kits rápidos (40%+ OFF, Menor preço 30d, Lojas da cidade, Frete grátis, Até R$ 50/100, Kits Casa, Tech, Moda e Presentes), além de SEO/OpenGraph próprios no servidor.
- **Desconto progressivo no carrinho para lojas locais**: configuração de até 3 faixas no `/painel` (`PUT /api/painel/desconto-progressivo`), barra de progresso no `/carrinho` e página da loja, e recálculo seguro no servidor em `/api/pedidos/whatsapp`, `/api/pagamento/split` e `/api/frete`.

## CITshop Food (branch `citshop-food`, ainda não publicado)

### Food
- Plano FOOD PRO (R$ 299,90) e cupom FOODFUNDADOR50.
- Praça `/alimentacao`.
- Painel `/restaurante`.
- Tela da cozinha `/cozinha`.
- Fila de impressão.

### CITshop Print
- App Windows em `citshop-print/`.

### Admin
- Aba Food.
- Preço FOOD PRO e cupom por segmento.

## 2.0 (branch `citshop-2.0`, ainda não publicado)

### Fase 2 · Modelo comercial
- Plano mensal de R$ 99,90.
- Quem já assina mantém o preço contratado.
- Cupom FUNDADOR50: 50% por 90 dias de campanha, um por loja, com checagem de CNPJ e WhatsApp.
- Assinatura pausada é tratada separada da cancelada.
- Admin → Planos.

### Fase 3 · Financeiro
- Livro de lançamentos imutável e idempotente.
- Retrato financeiro gravado no pedido.
- Comissão de R$ 1 por unidade só para parceiras.
- Estorno e chargeback.
- Mensalidades no livro.
- Registro dos eventos do Mercado Pago.

### Fase 4 · Admin
- Dashboard com números reais.
- Financeiro com filtros.
- Auditoria das ações.
- Filtros de lojas.

### Fase 5 · Painel do lojista
- Financeiro do mês.
- Entrega e retirada separadas do atendimento, com histórico.
- SKU, marca e variações reais.
- Instagram e telefone da loja.

### Fase 6 · Vitrine
- Avaliações pelo link do pedido, com moderação.
- Lojas favoritas.
- Filtro por marca.
- "Ver mais produtos".

### Fase 7 · Afiliados
- Auditoria documentada.

### Fase 8 · Automações
- `/saude`.
- Registro das tarefas.
- Aviso de falha pelo WhatsApp conectado.

### Fase 9 · Escalabilidade
- Backup diário com 14 dias.
- Proposta de PostgreSQL.
