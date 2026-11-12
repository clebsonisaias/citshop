# Skills e ferramentas

Levantamento feito no ambiente do Claude Code em 12/11/2026. **Nenhuma skill nova foi instalada**: as disponíveis cobrem todas as funções pedidas, e instalar skills de repositórios de terceiros traria risco (scripts e permissões) sem ganho.

| Função pedida | Skill/ferramenta | Origem | Situação | Uso no CITshop |
|---|---|---|---|---|
| Frontend design | `frontend-design`, `impeccable` | já instaladas (usuário/plugin) | usadas | Hierarquia visual, componentes, revisão de design (o `impeccable` também roda verificações automáticas após cada sessão) |
| UI/UX | `ui-ux-pro-max`, `vectorlab-ux-skills` (forms, viewports, icon-buttons, typography, reduced-motion) | já instaladas | usadas | Regras de toque (44 px), campos sem zoom no iPhone, navegação inferior, estados vazios |
| Code review | `code-review`, `code-review-lite`, `simplify` | já instaladas | usadas | Revisão antes/depois das fases; a revisão de 12/11 achou 10 defeitos, todos corrigidos |
| Security audit | `security-review` | já instalada | usada | Auditoria do painel (12/11): isolamento entre lojas, sessões, XSS, SSRF, CSV |
| Test-driven development | `test-driven-development` + `node:test` | já instalada / Node | usada | Testes das regras financeiras e de plano escritos junto com o código |
| Database design | — (sem skill dedicada) | procedimento manual | equivalente | Modelagem documentada em ARQUITETURA.md e na proposta de PostgreSQL |
| Browser testing | Playwright (MCP `mcp__playwright__*`) + navegador embutido | já conectados | usados | Matriz de rotas × larguras, cliques e capturas; sem adicionar o pacote `playwright` ao projeto |
| Documentation | `anthropic-skills:docx` (não necessária) | — | não usada | Documentos em Markdown dentro de `docs/` |
| Performance | `ui-ux-pro-max` (seção de performance) | já instalada | usada | Imagens WebP com dimensões, carregamento sob demanda do mapa |
| Refactoring safely | `ponytail`, `systematic-debugging`, `verification-before-completion` | já instaladas | usadas | Menor alteração possível, evidência antes de declarar pronto |

## Ferramentas de teste
- `node --test` (framework atual do projeto; Vitest não foi adotado para não manter dois frameworks).
- Playwright via MCP para navegador (sem dependência nova no `package.json`).
- Dados de teste locais na prévia (pasta temporária da sessão), nunca dados de produção.

## Limitações registradas
- Não há MCP de banco (PostgreSQL) porque o projeto ainda usa JSON.
- O MCP do Mercado Pago exige autenticação interativa; os fluxos de pagamento são testados com `fetch` simulado e, em produção, só com autorização.
