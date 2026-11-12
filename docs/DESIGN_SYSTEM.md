# Design system

Tudo fica em `publico/estilo.css`, uma folha só, com tokens em `:root`.
- **Cores:**
  | Token | Valor |
  |---|---|
  | `--brand` | `#008B87` |
  | `--deep` | `#036271` |
  | `--top` | `#024E5A` |
  | `--ink` | `#0B2E35` |
  | `--muted` | `#4B6A6F` |
  | `--line` | `#DAE7E5` |
  | `--surface` / `--bg` | `#FFFFFF` |

  `--hot` marca alertas e preços. A loja pode ter cor própria (`--loja`), e o texto sobre ela é calculado (`textoSobre`).
- **Tipografia:** Montserrat 400–800. Campos com 16px no celular, para o iOS não dar zoom.
- **Toque e layout:**
  - alvos de toque de no mínimo 44 px;
  - testado em 375 e 1280 px, sem rolagem horizontal;
  - grades com `minmax(min(Npx,100%),1fr)`.
- **Navegação:**
  - painel do lojista com barra de abas embaixo no celular (`#abas`, ícones SVG com rótulo);
  - admin em abas no topo;
  - tabelas viram cartões no celular (`.pg-admin`).
- **Componentes:**
  - `.btn` e `.btn.sec`;
  - `.chip`;
  - cartões de produto `.card`;
  - cabeçalho de loja `.loja-vitrine` (`comum.js` `cabecalhoLoja`);
  - `.filtros-adm`, `.item-adm`, `.hist-pedido`;
  - estrelas `.estrelas` (radios acessíveis);
  - `.lv-avaliacoes`.
- **Ícones:** SVG em linha, sem emoji como ícone de interface.
