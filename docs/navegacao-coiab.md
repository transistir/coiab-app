# Navegação COIAB — mapeamento CoMapeo → COIAB (v3, issue #32)

Documento de mapeamento da reorganização da navegação: cada rota de origem no
CoMapeo e seu destino na COIAB. Substitui o entendimento anterior registrado em
[`proposta-rotas-coiab.md`](./proposta-rotas-coiab.md), que lia o funil como
"Filtros" e tratava o Paneiro como o 5º item — leitura **errada** do Figma.

Design aprovado: Figma "Kutary App V2", frame `footer-menu`
(`https://www.figma.com/design/lfGdmeMSB7PoJGIvE0NtTM/Kutary-App---V2`).

## Tab bar v3 — 5 itens, esquerda → direita

| # | Ícone (Figma) | Item COIAB | Destino | Rota de origem no CoMapeo |
|---|---------------|-----------|---------|---------------------------|
| 1 | "bars" — 4 traços empilhados (laranja/verde/ocre/vermelho) + bolinha teal quando ativo | **Menu** (hub/dashboard da organização) | Rota de aba `Menu` → `MenuScreen` (renderiza o conteúdo do `DrawerMenu`) | **Drawer/hamburger** aberta pelo botão no header, ao lado do nome da org |
| 2 | **Funil** | **Paneiro** (observações da comunidade — o antigo caderno). **Funil ≠ filtro.** | Rota de aba `ObservationsList` | `ObservationsList` (era aba no CoMapeo) |
| 3 | **Mapa dobrado**, círculo central destacado (fundo `#284D45`) | **Map** | Rota de aba `Map` → `MapScreen` | `Map`/`MapScreen` (aba central no CoMapeo). A trilha/GPS e o `+` de captura vivem DENTRO do mapa |
| 4 | **Sino** | **Notificações** | Rota de aba `Notificacoes` → placeholder `Notificacoes` | — (novo; integra com o pipeline de notificações, #49, pós-MVP) |
| 5 | **Engrenagem** | **Configurações** | Navega para `AppSettings` na **root stack** (não é aba) | `AppSettings` (`ComapeoSettings`), antes alcançada pela entrada "Ekanâdyby Settings" dentro da drawer |

Notas de leitura:

- **Sem rótulo de texto** na barra — só ícones, como no Figma.
- **Sem ícone de perfil** — nunca existe na barra.
- **Trilha/GPS e download não vivem na barra**: a trilha é ação DENTRO do mapa;
  o download de observações é `headerRight` da aba Paneiro, não um item da barra.
- O nome/ícone da **organização ativa** permanece no **header** (topo), como no
  Figma (`HomeHeader`).

## Telas que migram (CoMapeo → COIAB)

| Tela/feature CoMapeo | Para onde vai na COIAB |
|---|---|
| Conteúdo da drawer (cartão da organização, Equipe, Mapa de fundo, Ekanâdyby Settings, Trocar/Criar organização, botão Exchange/Sync) | **Página de Menu** (`MenuScreen`), aberta pelo item 1 da barra. Fase 3: reaproveita `DrawerMenu` inteiro como página. Remodelagem visual (cartões de módulo do Figma "Página Entroncamento") fica para fase seguinte |
| `ObservationsList` (aba) | **Paneiro** — item 2 (funil). Mesma rota `ObservationsList`, mesmo componente |
| `MapScreen` (aba) | **Map** — item 3 (central). Inalterado |
| `AppSettings` / `ComapeoSettings` (via drawer) | **Configurações** — item 5 (engrenagem). Navega para a tela `AppSettings` já existente na root stack |
| `CameraScreen` | Continua **registrada** nas home tabs (sem botão na barra); o acesso vive no fluxo de criação de observação (`+` do mapa) |

## O que fica fora da tab bar v3

| Removido da barra | Motivo |
|---|---|
| Aba **Entroncamento** (hub de módulos como aba própria, v2) | O hub da organização passou a ser a **Página de Menu** (item 1). O conteúdo rico de módulos é fase seguinte |
| Aba **Filtros** (v2) | Leitura errada: o funil é o **Paneiro**, não um filtro. Filtro global por categorias/camadas, quando existir, entra em outra superfície (#30) |
| Botão **Tracking** (trilha) na barra (v2) | A trilha é ação DENTRO do mapa, nunca item da barra |
| Ícone de **perfil** | Não existe na barra (decisão do usuário) |

## Detalhes de implementação (fase 3)

- `Navigation/Tab/index.tsx`: `initialRouteName="Menu"`; abas registradas
  `Menu` (inicial), `ObservationsList`, `Map`, `Notificacoes`, `Camera`
  (sem botão). `backBehavior="initialRoute"` recai no `Menu`.
- `Navigation/Tab/TabBar.tsx`: 5 botões; o 5º (Configurações) usa
  `navigation.getParent()?.navigate('AppSettings')` para alcançar a root stack.
- `Navigation/Tab/TabBarIcons.tsx`: `TabIconMenu` (bars), `TabIconPaneiro`
  (funil), `TabIconMapa`, `TabIconNotificacoes` (sino), `TabIconConfiguracoes`
  (engrenagem — `images/TabIconEngrenagem.svg`, novo).
- `screens/MenuScreen.tsx`: renderiza `DrawerMenu` como página. Carrega o
  testID `ENTRONCAMENTO.scrn` (continuidade dos testes de navigator do #32, que
  localizam a Home pós-login por esse id) e `MENU.scrn`.

### Continuidade: por que `MenuScreen` carrega `ENTRONCAMENTO.scrn`

Os testes de navigator do #32 (`Navigation/Stack/*.navigator.test.tsx` e
`.rnstorybook/utils/FlowStateScope.test.tsx`) afirmam que a Home pós-login
monta `ENTRONCAMENTO.scrn` e que o `backBehavior="initialRoute"` recai nela. No
v3 a rota inicial é `Menu`; para não reescrever a semântica desses testes
(reset de contexto, poda de rota, cold start), a `MenuScreen` mantém o testID
`ENTRONCAMENTO.scrn` no container além do `MENU.scrn`.

## Follow-ups (fases seguintes)

1. **Remodelar a Página de Menu** com os cartões de módulo do Figma "Página
   Entroncamento" (hoje a página reaproveita o `DrawerMenu` cru).
2. **Tirar o botão de menu do header**: ✓ concluído neste diff (#118, ciclo
   1) — o `HomeHeader` não abre mais a drawer; a gaveta saiu e o conteúdo
   virou a Página de Menu, acessível só pela tab bar. O nome/ícone da
   organização permanece no header.
3. **Retematizar as telas de Settings** do CoMapeo sob o item Configurações.
4. **Conteúdo real de Notificações** (#49) e **filtro global** quando o #30
   trouxer as categorias por módulo.
