# Proposta: PostgreSQL (Fase 9) · **só proposta, nada migrado**

## Hoje
- Tudo fica num arquivo, `citshop.json` (`servidor/dados.js`, classe `Banco`).
- O arquivo é carregado na memória e regravado por inteiro a cada mudança, com escrita atômica (tmp + rename).
- Há um backup diário com 14 dias de rotação em `<DADOS_DIR>/backups`.
- Coleções: `lojas`, `produtos`, `pedidos`, `cupons`, `alertas`, `avaliacoes`, `lancamentos` (livro financeiro), `auditoria`, `eventosMp`, `metricasContato`, `comercial`, `catalogos`.

## Quando migrar (gatilhos)
Hoje o JSON aguenta: são poucas lojas e uma instância só. Vale migrar quando acontecer qualquer um destes:
- mais de ~5 mil pedidos por mês, ou o arquivo passar de ~20 MB, porque cada `salvar()` regrava tudo;
- precisar de **mais de uma instância** do app, já que o arquivo não é compartilhado com segurança;
- relatórios financeiros com filtros pesados por período.

## Modelo sugerido
| Tabela | Chave | Observações |
|---|---|---|
| lojas | id (texto) | `slug` único, `email` único; plano, assinatura e benefício em `jsonb` |
| produtos | id | `loja_id` FK, índice (`loja_id`, `ativo`); `variacoes` em `jsonb` |
| pedidos | id | `loja_id` FK, índice (`loja_id`, `criado_em`); `itens`, `comprador`, `financeiro` e `historico` em `jsonb` |
| lancamentos | id | `chave` **única** (idempotência garantida pelo banco), sem UPDATE/DELETE para o usuário do app |
| avaliacoes | id | `pedido_id` **único** (uma por pedido) |
| cupons, alertas, auditoria, eventos_mp | id | índices por loja e data |

Regras que hoje ficam no código e passariam para o banco: chave única do livro, uma avaliação por pedido, slug e e-mail únicos.

## Migração (sem parar a loja)
1. Criar o banco no Coolify. É **mudança de infraestrutura e exige autorização**.
2. Escrever um script de importação idempotente (JSON → tabelas), testado com uma cópia de `backups/`.
3. Trocar a classe `Banco` por uma camada com a mesma interface (`lojas`, `produtos`, `salvar`...), assim as rotas não mudam.
4. Rodar as duas em paralelo na prévia: comparar as contagens e a suíte de testes.
5. Janela curta: congelar escrita, importar o último estado, apontar o app para o PostgreSQL.

## Backup e volta atrás
- **Backup:** `pg_dump` diário com 14 dias de rotação, e o JSON continua sendo gerado por 30 dias depois da migração.
- **Rollback:** voltar a imagem anterior do app, que lê o JSON, e importar o último backup. Os pedidos feitos depois da migração vêm do `pg_dump` pelo script inverso.

## Custo
- PostgreSQL no próprio Coolify, sem custo extra de licença.
- Estimativa de 2 a 3 dias de trabalho, mais a validação.
