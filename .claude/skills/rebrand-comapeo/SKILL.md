---
name: rebrand-comapeo
description: >
  Rebrand (white-label) a fork of digidem/comapeo-mobile (CoMapeo) with the
  minimal possible diff and ship a new Android APK via EAS build on GitHub.
  Use when asked to rebrand, rename, or fork the CoMapeo app, change its
  app name / package ID / deep links, set up EAS env vars, cut a release
  candidate branch, or trigger/build the APK through the existing
  build-release workflow.
---

# Rebrand CoMapeo (fork → APK novo com diff mínimo)

O processo inteiro mora no driver `.claude/skills/rebrand-comapeo/rebrand.mjs`
(Node ≥ 20, sem dependências). Ele aplica as ~40 edições de identidade
(idempotente), verifica sobras, vincula o projeto à conta Expo, cria as env
vars do EAS e corta o release que dispara o build. Todos os caminhos abaixo
são relativos à raiz do repositório.

**Filosofia: diff mínimo.** Só a identidade muda. Para manter o fork
sincronizável com o upstream, NÃO mude:

- dependências `@comapeo/*` e `@mapeo/*` nem URLs `github.com/digidem/*`
- nomes das variáveis `COMAPEO_METRICS_*` (o app lê esses nomes)
- configuração do Sentry (`dsn`, `organization` no `sentry.properties`)
- o workflow `.github/workflows/build-release.yml` — o build dispara ao
  mesclar qualquer PR cujo base é `release/**`; não crie workflow novo

## Pré-requisitos

Node 20+, git, `gh` autenticado (dono do fork) e uma conta no expo.dev.

```bash
npm install --global eas-cli
ln -sf /root/.hermes/node/bin/eas /root/.local/bin/eas   # se o binário global cair fora do PATH
eas whoami      # precisa imprimir o usuário Expo (senão: eas login --no-browser ou EXPO_TOKEN)
```

Depois, na raiz do fork: `npm install`, e prepare o ambiente local de testes:

```bash
cp .env.template .env       # edite e coloque o MAPBOX_ACCESS_TOKEN real (só local)
npm run build:translations && npm run build:intl-polyfills
```

## Pipeline (caminho do agente) — nesta ordem

### 1. apply — aplica o rebrand (idempotente)

```bash
node .claude/skills/rebrand-comapeo/rebrand.mjs apply \
  --app-id org.coiab --app-name Ekanâdyby \
  --domain app.coiab.org --owner joarez
```

Opcionais: `--slug s`, `--scheme s` (deep link), e `--project-id UUID` se o
fork ainda carrega o projectId do upstream em `app.json`/`app.config.js`
(erro `Entity not authorized` no `eas init` é o sintoma).

### 2. verify — sobras + config + testes

```bash
node .claude/skills/rebrand-comapeo/rebrand.mjs verify \
  --app-id org.coiab --app-name Ekanâdyby --domain app.coiab.org
```

Grep por `com.comapeo`/`comapeo://`/`app.comapeo.org` restantes, confere o
`owner`, avalia `APP_VARIANT=production npx expo config --type public` e roda
`npm run test:jest -- app.config.test.ts`. Tem que terminar tudo ✔.

Para inspecionar a config manualmente:

```bash
APP_VARIANT=production npx expo config --type public
```

### 3. link-eas — vincula o projeto à conta Expo

Só se não usou `--project-id` no apply (projeto novo no EAS):

```bash
node .claude/skills/rebrand-comapeo/rebrand.mjs link-eas --owner joarez
```

Remove o projectId antigo do `app.json`, roda `eas init --force` e reescreve
o projectId novo em `app.config.js` e `app.config.test.ts` (o `eas init --force`
foi o comando verificado neste fork; o subcomando automatiza essa sequência).
O dono precisa existir no expo.dev (pessoa ou org — `eas init` falha com conta
inexistente).

### 4. eas-env — variáveis de ambiente no EAS

Builds EAS usam as env vars da plataforma, NÃO os secrets do GitHub:

```bash
node .claude/skills/rebrand-comapeo/rebrand.mjs eas-env
node .claude/skills/rebrand-comapeo/rebrand.mjs eas-env --mapbox-token pk.eyJ...   # se quiser setar via CLI
```

Sem flags, seta placeholders (`COMAPEO_METRICS_URL=https://metrics.invalid`,
`COMAPEO_METRICS_API_KEY=not-configured`) nos três ambientes do plano free
(production/preview/development). **Nunca commite token real** — Mapbox se
cadastra na plataforma ou se passa por flag.

### 5. Commit

```bash
git add -A && git commit -m "feat: rebrand para <Nome> (<app-id>) e configurar EAS"
git push origin develop
```

O husky pre-commit roda extract-messages — ele precisa das translations
geradas (Pré-requisitos) e do patch de caminho não-ASCII que o apply instala.

### 6. release — corta o RC e dispara o build

```bash
node .claude/skills/rebrand-comapeo/rebrand.mjs release          # dry-run: mostra o plano, sai com exit 1
node .claude/skills/rebrand-comapeo/rebrand.mjs release --yes
```

O `--yes` automatiza exatamente a sequência executada neste projeto (o dry-run
foi validado aqui): ativa Actions do fork, cria `release/vX` ← `develop`,
`rc/vX` ← `release/vX`, tira o sufixo `-pre` da versão, regenera o
package-lock, commita e mescla o PR — o merge em `release/**` é o gatilho do
`build-release.yml`, que dispara o build EAS Android de produção.

Equivalente manual (como foi feito neste fork):

```bash
gh api -X PUT repos/transistir/comapeo-mobile-1/actions/permissions -F enabled=true -F allowed_actions=all
git checkout -b release/v14.0 develop && git push origin release/v14.0 && git checkout -b rc/v14.0 release/v14.0
npm install --package-lock-only --no-audit --no-fund
git add package.json package-lock.json && git commit -m "chore: bump version to 1.14.0 for release candidate"
git push origin rc/v14.0
gh pr create --repo transistir/comapeo-mobile-1 --base release/v14.0 --head rc/v14.0 --title "Release Candidate v14.0"
gh pr merge 1 --repo transistir/comapeo-mobile-1 --merge
```

### 7. Acompanhar o build

```bash
node .claude/skills/rebrand-comapeo/rebrand.mjs build-status
```

Lista os últimos builds com status e link. Fila no plano free é longa
(~1h); o build em si leva minutos.

## Gotchas

- **Forks nascem com GitHub Actions desativado** — `gh api -X PUT` com `-F`
  (booleano de verdade, não `-f` string) antes do primeiro release.
- **Plano free do EAS só tem os ambientes production/preview/development** —
  perfis custom (`release-candidate`, `test`, `pre-release`) precisam de
  `"environment": "preview"` no `eas.json` (o apply já faz).
- **Sem token do Sentry, build de release quebra no Gradle** — o apply insere
  `SENTRY_DISABLE_AUTO_UPLOAD=true` no perfil base do `eas.json`; o env de
  `base` propaga para todos os perfis via `extends`. Quando houver org Sentry
  própria, remova essa linha.
- **`eas secret:create` foi descontinuado** — use `eas env:set`.
- **Caminho com caractere não-ASCII** (`â`) quebra scripts que usam
  `fileURLToPath(...).pathname` (percent-encoding) — o apply corrige os três
  scripts afetados.
- **`requireCommit: true` no `eas.json`** — build EAS só de commit pushado.
- **Jobs de release-bot falham** ("Build Release Candidate", "Check PR to
  Release" e afins) — esperado sem o bot do upstream; inofensivo.
- `eas init` precisa de `node_modules` instalado (usa `semver`).
- **Dívidas para o futuro** (documentadas no próprio repo): o hook
  `eas-build-on-success` está comentado no `package.json` (reativar quando
  houver storage próprio para os artefatos); o owner atual é a conta pessoal
  `joarez` (para migrar para uma org: criar a org no expo.dev, atualizar
  `owner` no `app.json`, rodar `link-eas` de novo).

## Troubleshooting

- **`Execution failed for task ':app:createBundleReleaseJsAndAssets_SentryUpload_...'`
  + `Auth token is required`** no build EAS → upload de source maps do Sentry
  sem token. Corrija com `SENTRY_DISABLE_AUTO_UPLOAD=true` no env do perfil
  `base` do `eas.json`, commit + PR para `release/vX` (o merge re-dispara o
  build). Foi exatamente o erro deste projeto e a correção aplicada.
- **Baixando log de build falho**: `eas build:list --json --non-interactive --limit 1`
  → campo `logFiles[0]` → `curl -sL --compressed "$URL" -o /tmp/eas.log`.
  Se sair binário/corrompido, gere URL nova (rodando `eas build:list` de novo)
  e repita com `--compressed`. O formato é ndjson (`phase`/`level`/`msg`);
  o erro real está na fase `RUN_GRADLEW`.
- **`Entity not authorized: AppEntity[...]` no `eas init`** → projectId do
  upstream hardcoded; rode `link-eas` (ou `apply --project-id` antes).
- **`Cannot find module 'semver/functions/parse'` no `eas init`** → rode
  `npm install` primeiro.
- **Jest: `Missing required environment variable MAPBOX_ACCESS_TOKEN`** →
  falta o `.env` (Pré-requisitos).
- **Jest: `Cannot find ./translations/index`** → `npm run build:translations`.
- **apply reporta `missing`** → o upstream mudou os textos-base; confira o
  diff de `git log` do upstream e adapte o from-string no driver.
