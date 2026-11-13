# Design system do app (fonte: dono, 2026-10-31)

Veio de um design system chamado "intelly" (dashboard de agenda para clinicos), colado pelo dono em 2026-10-31 como o design system do praxis.psi. Valores medidos de UMA captura de tela da tela Schedule; nao havia codigo, Figma nem fontes. Este arquivo e a FONTE para o visual do front (substitui a identidade verde-petroleo/papel criada na Fase 1).

Notas de adaptacao do praxis.psi (decididas pelo controlador, nao fazem parte do original):
- ATUALIZACAO 2026-11-13: a fonte do app passou a ser a da marca praxis: Red Hat Text (leitura) e Red Hat Display (titulos e wordmark, pesos 700/900), AUTO-HOSPEDADAS (`@fontsource/red-hat-text` e `@fontsource/red-hat-display`). O texto abaixo sobre DM Sans e o original do documento do dono e vale so como historico. Fonte AUTO-HOSPEDADA (antes: pacote npm `@fontsource/dm-sans`), nunca via Google Fonts: pagina de saude nao deve vazar IP de usuario a terceiro e a CSP do item 49 fica simples.
- Icones Lucide (como no original), sem CDN: pacote npm, so os icones usados.
- O original e uma agenda; o praxis.psi ainda nao tem agenda. Reaproveitar tokens, tipografia, formas e componentes (Button, IconButton, Pill, NavItem, avatar); telas de agenda/artigos ficam para depois.
- Texto sobre cores pastel e rosa precisa passar contraste AA (4.5:1); se um par do original nao passar, use o par escuro do sistema.
- Largura menor que ~832 px: a sidebar vira barra superior (o original nao especifica mobile).

## Content fundamentals
- Friendly, direct, second person: "Stay up to date, Dr.Olivia". Sentence case everywhere ("Add event", "Statistics & reports"); day names in caps (MONDAY) or 2-letter abbreviations (FR, SA, SU).
- Short labels; event titles are nouns ("Emergency visit", "Diagnostic test"). Locations as "West camp, Room 312"; times "07:00 - 07:30"; dates "11/05".
- Article teasers ask a question or describe a benefit, truncated with "…". No emoji.
- (praxis.psi: textos em portugues do Brasil, mesmo tom: direto, segunda pessoa, caixa de frase, sem emoji.)

## Visual foundations
- Warm cream page (#F8F2E3) with a solid near-black sidebar (#141414, 18px radius, floating with margin). No gradients, no shadows, no borders on cards.
- Cards: flat fills, 12px radius. Default event = cream-200; team meetings = yellow; group/intern sessions = periwinkle blue. Articles add a small 6px-radius tag (pink or blue) and a photo.
- Black is the primary action (pills, active day, active view toggle, header icon buttons). Pink is the accent: search button, active nav, "In progress" state, weekend label, current-time marker.
- Shapes: pill buttons (999px), circular icon buttons (38px), 24px circular icon chips on cards, 22px initial avatars on pastel fills.
- Type: one sans (DM Sans substitute), 400/500 weights only. Display 38px tight tracking.
- Current time: dashed grey line across the grid with a pink pill label.
- Imagery: warm, natural-light clinical photography of smiling clinicians, rounded 10px.
- Interaction (inferred): hover darkens fills slightly; disabled buttons use #A9A49B with white text. No motion beyond simple fades.

## Iconography
Thin (≈1.5px) outline line icons, rounded caps. Substituted with Lucide (originals unknown). Icons in white on the sidebar, ink on cream, ink inside pastel chips. No emoji, no unicode icons.

## Logo
No logo file supplied: "intelly" is rendered in plain DM Sans 500. (praxis.psi: "praxis.psi" em DM Sans 500, mesmo tratamento, ate haver logo.)

## Tokens

### Fontes
```css
@import url("https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap");
```
(praxis.psi: NAO usar este import; auto-hospedar com `@fontsource/red-hat-text` e `@fontsource/red-hat-display`.)

### ATUALIZACAO 2026-11-13: paleta hibrida da marca praxis (decisao do dono)
Os valores de cor do bloco abaixo sao os do documento ORIGINAL (historico). Valem hoje os de `frontend/src/styles/tokens.scss`:
- Neutros: `cream-50` #FFFFFF, `cream-100` #F4F4F2 (fundo), `cream-200` #E9E9E7, `cream-300` #DDDDDA; `ink-900` #0B0B0C (preto da marca, menu e painel), `ink-700` #2A2A2D, `ink-500` #55555A (texto secundario), `ink-400` #8A8A90, `ink-300` #A9A9AE.
- Azul ceu da marca (`sky-300` #38B6FF, hover `sky-200` #6CC8FF), via `--accent`: SO em acao e destaque (botao em andamento, foco, item ativo do menu, icone de destaque). Texto sobre o azul e sempre preto (branco da 2.3:1 e reprova). Azul como texto so sobre preto.
- Rosa, amarelo e azul pastel: so status e avatar. Fonte: Red Hat Text e Red Hat Display.

### Cores
```css
:root{
  /* base */
  --cream-50:#FCF8EF; --cream-100:#F8F2E3; --cream-200:#EEE6D7; --cream-300:#E4DBCA;
  --ink-900:#141414; --ink-700:#2B2B2B; --ink-500:#6E685D; --ink-400:#8D877C; --ink-300:#A9A49B;
  --white:#FFFFFF;
  --pink-200:#F7CDEA; --pink-300:#F2B3DC; --pink-400:#EC9DD0;
  --yellow-300:#F4D56A; --yellow-200:#EDD47A;
  --blue-300:#A9BFEA; --blue-200:#C3D2F0;
  --olive-300:#AEBB7F;
  /* semantic */
  --bg-page:var(--cream-100);
  --bg-sidebar:var(--ink-900);
  --surface-day:var(--cream-50);
  --surface-day-active:var(--ink-900);
  --surface-event:var(--cream-200);
  --surface-event-team:var(--yellow-300);
  --surface-event-group:var(--blue-300);
  --surface-control:var(--cream-200);
  --accent:var(--pink-300);
  --text-primary:var(--ink-900);
  --text-secondary:var(--ink-500);
  --text-inverse:var(--white);
  --text-nav-active:var(--pink-400);
  --text-weekend:var(--pink-300);
  --text-sidebar-label:var(--ink-400);
  --btn-primary-bg:var(--ink-900);
  --btn-disabled-bg:var(--ink-300);
  --btn-progress-bg:var(--pink-300);
  --border-input:var(--ink-900);
  --line-now:var(--ink-400);
  --avatar-ty:var(--yellow-200); --avatar-ab:var(--olive-300); --avatar-nr:var(--blue-300); --avatar-ss:var(--yellow-300); --avatar-more:var(--white);
}
```

### ATUALIZACAO 2026-11-13: escala tipografica do manual de marca praxis (decisao do dono)
Vale hoje (tokens em `frontend/src/styles/tokens.scss`, regras em `frontend/src/styles.scss`); o bloco abaixo e o original, so historico:
- **Titulo (h1):** Red Hat Display Black 900, 56px, entrelinha 100%, espacamento -4,5% (`--fs-titulo`, com `clamp()` de 36 a 56px para o celular; o manual nao define mobile).
- **Subtitulo (h2):** Red Hat Display Bold 700, 28px, entrelinha 120%, espacamento -2% (`--fs-subtitulo`, `clamp()` de 24 a 28px).
- **Titulo de cartao:** Display Bold 700, 18px (`--fs-card-title`).
- **Corpo:** Red Hat Text Regular 400, 18px, entrelinha 150% (`--fs-corpo`).
- **Legenda, rotulos, botoes, menu e metadados:** Red Hat Text Medium 500, 14px, entrelinha 140% (`--fs-legenda`, que alimenta `--fs-nav`, `--fs-day`, `--fs-body`, `--fs-meta` e `--fs-micro`).
- **Logo (wordmark):** Display Black 900, espacamento justo, com o ponto azul.
- O "Display" de 96px do manual (capa e hero de site) nao tem uso no app; fica para a landing page.
- Pesos carregados: Text 400, 500, 700; Display 700, 900. Nao usar Display 500 nem Text 600 (nao carregados).
- **Largura das telas (decisao do dono, 2026-11-13: usar a largura da tela, cartoes nao ficam mais "enxutos"):** a area de trabalho vai ate `96rem`. A ficha do paciente fica em duas colunas a partir de 60rem de largura (dados e consentimento a esquerda; prontuario, rascunhos e pedidos de IA a direita; baixar e excluir numa faixa embaixo); paciente novo fica em coluna unica de 44rem. A Inicio poe Resumo e Atalhos lado a lado (48rem ou mais). Leitura e novo documento e telas de IA vao ate `72rem` (para o texto continuar legivel). Equipe: formulario em duas colunas de campos entre 44rem e 68rem e ao lado da lista acima disso. Tabelas ja ocupavam a largura toda. Paginas publicas (login, cadastro, seguranca, termo) mantem a largura de leitura.
- **Menu lateral (decisao do dono, 2026-11-13):** de ponta a ponta no desktop: colado no topo, na base e na esquerda, altura da tela inteira (`100dvh`), sempre visivel (`position: sticky`), cantos arredondados so no lado direito e rolagem propria se a tela for muito baixa. No celular (menos de 832 px) continua o cartao flutuante com cantos arredondados.
- **Adaptacao ao app (onde a escala do manual ficaria grande demais):** texto de apoio (datas, 'Criado em', 'Aprovado em', versao do termo, historico, data do pedido de IA, faixas de aviso e prazo de descarte) em legenda 14px; dados das tabelas em 14px e so o nome (primeira coluna) em corpo 18px, com `max-width: 22rem` e quebra de palavra para nome muito longo nao empurrar as colunas; nome da usuaria no menu em 14px Medium. O texto explicativo de cada cartao fica em corpo 18px.

### Tipografia
```css
:root{
  --font-sans:"Red Hat Text", "Helvetica Neue", Arial, sans-serif; --font-display:"Red Hat Display", "Red Hat Text", "Helvetica Neue", Arial, sans-serif;
  --fs-display:38px; --fs-logo:34px; --fs-card-title:14px; --fs-nav:14px; --fs-day:13px;
  --fs-body:12px; --fs-meta:11px; --fs-micro:10px;
  --fw-regular:400; --fw-medium:500; --fw-semibold:600;
  --lh-tight:1.15; --lh-body:1.4;
  --ls-display:-0.025em; --ls-normal:0;
}
```

### Espacamento, raios e tamanhos
```css
:root{
  --space-1:4px; --space-2:6px; --space-3:8px; --space-4:10px; --space-5:12px; --space-6:16px; --space-7:20px; --space-8:24px; --space-9:32px;
  --radius-chip:6px; --radius-card:12px; --radius-panel:18px; --radius-pill:999px;
  --size-avatar:22px; --size-icon-chip:24px; --size-icon-btn:38px; --size-control:40px;
  --sidebar-w:196px; --col-gap:8px;
  --shadow-none:none;
}
```

## Medidas de layout (tela Schedule)
- Pagina: fundo #F8F2E3, padding 22px 24px, gap sidebar→conteudo 36px
- Sidebar: 196px, #141414, raio 18px, padding 22px; logo 34px/500; labels de secao 13px #8D877C; itens 14px, gap 20px, icone 19px; ativo #EC9DD0 com barra 2px a esquerda
- Botao de recolher sidebar: 20px circulo rosa #F2B3DC, borda 2px #141414
- Busca: botao 38px rosa + campo 620×42px, borda 1.5px #2B2B2B, pill; chips de escopo 10px tracejados #6E685D
- Acoes do header: 3 botoes 38px pretos com icone branco 20px
- Titulo: 38px/500, tracking -0.025em
- "Add event": pill 38px preta, 14px; botoes icone secundarios 38px #EEE6D7
- Seletor de semana: pill 30px preta, 11px; toggle Today/Week/Month: 20px, 10px, ativo preto
- Grade: colunas 40px + 7×1fr, gap 8px; cabecalho de dia 58px, raio 12px, #FCF8EF (ativo #141414 branco; domingo texto #F2B3DC)
- Hora: 10px #6E685D; linha "agora" tracejada 1px #8D877C com pill rosa 10px
- Cards de evento: raio 12px, padding 10px 12px 12px; chip de icone 24px (icone 13px); titulo 14px/500; local 11px; tempo 11px #5C574D; "Participants" 10px; avatares 20px, 8px/500, gap 3px; botao 28px pill 13px
- Tags de artigo: 9px, padding 4px 8px, raio 6px (rosa ou azul); imagem raio 10px

## Componentes (assinaturas originais, React; o front do praxis.psi e Angular: recriar como componentes standalone com a mesma API)

- **Button**: pill de acao primaria. `variant?: 'primary'|'disabled'|'progress'|'soft'; full?: boolean`. Ex.: `<Button variant="progress" full>In progress...</Button>`
- **IconButton**: botao circular de icone. `icon: string; tone?: 'dark'|'soft'|'accent'; size?: number`.
- **Pill**: tag de categoria ou chip tracejado de filtro. `tone?: 'pink'|'blue'|'yellow'; dashed?: boolean`.
- **AvatarGroup**: fileira de avatares com iniciais. `people?: string[]; more?: number`.
- **EventCard**: bloco de evento na grade semanal. `title; location?; time?; icon?; tone?: 'default'|'team'|'group'`.
- **NavItem**: linha de navegacao na sidebar escura. `icon: string; label: string; active?: boolean`.
- **SearchBar**: campo de busca pill com chips de escopo tracejados. `scopes?: string[]`.
