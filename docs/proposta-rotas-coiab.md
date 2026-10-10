# Mapeamento de rotas COIAB — lógica do Figma (2026-10-10)

## Lógica de navegação extraída do Figma (Kutary App V2, página `2668:4449`)

Tab bar global de 5 posições, presente em TODAS as telas pós-login:

| # | Ícone | Aba | Papel |
|---|-------|-----|-------|
| 1 | Traços coloridos empilhados (laranja/verde/ocre/vermelho) | **Entroncamento** (home/hub) | módulos da organização |
| 2 | Funil | **Filtros** | filtro global (categorias/camadas) |
| 3 | Mapa dobrado, círculo destacado | **Mapa** (central) | mapa + captura (FAB `+`) |
| 4 | Sino | **Notificações** | lista de notificações |
| 5 | Foto do usuário | **Paneiro** → configurações/perfil | observações da comunidade + config |

Indicador de estado: pontinho verde sob o ícone da aba com pendência (visto no Entroncamento e no funil).

### Substituições vs. app atual (CoMapeo)

| CoMapeo hoje | Figma COIAB | Observação |
|---|---|---|
| Drawer (gaveta) com projetos | **Entroncamento** como aba home | hub de módulos substitui o drawer |
| `ObservationsList` como aba | **Paneiro** = caderno de observações da comunidade (`2812:2616`: "Observações registradas pela comunidade", filtro por categoria) | renomear/reposicionar |
| Tabs: ObservationsList / Map / Camera | Tabs: Entroncamento / Filtros / Mapa / Notificações / Paneiro+Config | câmera vira ação do `+` no mapa |
| Settings via drawer | **Página própria**: Configurações (Organização / Aplicativo / Equipe) — substitui o ícone de engrenagem do canto superior | Hiure: "menu de cima ganha página própria" |
| Sem notificações | **Notificações** com lista (`2718:3165`) | integra com #49 pós-MVP |

### Stack proposta (React Navigation)

```
RootStack
├─ Onboarding (AuthScreen → IntroToCoMapeo → DataPrivacy → Success)   [já existe]
├─ Entroncamento (TAB 1, initial route pós-login)
│   ├─ cartões de módulo: Monitoramento Territorial (#FF9500),
│   │   Cadeias Produtivas (#458000), Censo Demográfico (#A06829), Alertas (#B90B0B)
│   ├─ → PáginaInicial[modulo] (mapa dedicado por módulo, `2668:5453`/`2668:5490`)
│   ├─ → TrocarOrganizacao (bottom sheet global, `2741:2535`)
│   └─ → Convidar (`2741:7361`)
├─ Filtros (TAB 2)                                    [NOVO - simples]
├─ Mapa (TAB 3, central)                              [existe: MapScreen]
├─ Notificacoes (TAB 4)                               [NOVO - lista estática 1ª fase]
└─ Paneiro (TAB 5)                                    [existe: ObservationsList renomeada]
    ├─ lista com filtro por categoria (`2812:2616`)
    └─ → Configuracoes (Organizacao/Aplicativo/Equipe, `2715:3069`)
```

## Ajuste às dependências (o que NÃO acoplar agora)

| Tela/feature do Figma | Dependência | Decisão no mapeamento |
|---|---|---|
| Cartões Cadeias Produtivas / Censo / Alertas funcionais | fluxo completo por módulo (#30): categoria→form→revisar→concluído | 1ª fase: só Monitoramento Territorial clicável; outros 3 cartões **visíveis e desabilitados** ("em breve") |
| Notificações com conteúdo real | pipeline de notificações (#49, pós-MVP) | aba existe com lista vazia/estática |
| Filtros globais | categorias por módulo (#30) | 1ª fase: esqueleto, sem lógica |
| Trocar Organização (múltiplas orgs) | org-layer: #93 feita, multi-org real ainda não | sheet pronta mas com 1 org (escondida se só uma? — decidir) |
| Paneiro com filtro por categoria | PresetChooser existe | reaproveitar ObservationsList + filtro |
| Configurações→Equipe | YourTeam existe | reempacotar |

## PRs (ordem de acoplamento seguro)

1. **PR A — esqueleto de navegação**: Tab bar 5-abas (Entroncamento/Filtros/Mapa/Notificações/Paneiro) com telas existentes remapeadas (Mapa, Paneiro=ObservationsList). Sem tela nova de conteúdo. Módulos não-MT: cartões desabilitados.
2. **PR B — Entroncamento**: tela hub com cartões (1 ativo + 3 desabilitados), header org+projeto. TrocarOrganizacao sheet estática (1 org).
3. **PR C — Configurações própria**: página com 3 entradas reaproveitando ProjectSettings/YourTeam existentes.
4. **PR D+ — acoplamento progressivo**: cada módulo do #30 entra ativando seu cartão; notificações conecta na #49.

Regra: nada depende de tela inacabada — cada PR deixa o app navegável com o que já existe.
