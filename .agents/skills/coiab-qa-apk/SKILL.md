---
name: coiab-qa-apk
description: Use when producing or checking a COIAB App QA build (APK) and deciding whether a release is testable in the field. Covers secret inventory, dispatch, artifact verification, install and the upgrade-with-data gate that CI does not cover.
---

# QA build do COIAB App: do commit ao aparelho

Objetivo: entregar um APK de QA com procedência provada e dizer, sem enfeite, o
que ele **não** prova.

`transistir/coiab-app` é o repo de trabalho. `transistir/comapeo-mobile-1` é o
trunk; builds de QA saem do fork.

## 1. Inventário antes de gastar runner

```sh
gh secret list -R transistir/coiab-app
gh variable list -R transistir/coiab-app
git grep -n "secrets\." .github/workflows/
```

Cada `secrets.X` no workflow precisa existir na lista, com o **nome exato**.
Nome errado não falha no parsing: falha como erro de autenticação no meio do
build, 30 minutos depois. Caso real: `secrets.EXPO` em vez de `EXPO_TOKEN`.

Secrets conhecidos (revalidar, não confiar nesta lista): `EXPO_TOKEN`,
`MAPBOX_ACCESS_TOKEN`, `COMAPEO_METRICS_API_KEY`, `SENTRY_AUTH_TOKEN`,
`RELEASE_BOT_PRIVATE_KEY`. Variáveis: `COMAPEO_METRICS_URL`, `EAS_PROJECT_URL`,
`RELEASE_BOT_APP_ID`.

Faltando `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY`, o E2E não passa do
upload do APK — o build funciona, o teste em aparelho não roda.

## 2. Disparar

```sh
gh workflow run build-apk.yml -R transistir/coiab-app --ref develop \
  -f profile=release-candidate
```

Depois de 20-30 s, confirme pela API antes de qualquer novo dispatch:

```sh
gh run list -R transistir/coiab-app --workflow build-apk.yml --limit 1 \
  --json databaseId,status,headSha,event
```

Dispatch repetido gera dois builds do mesmo SHA — 40 min de runner cada. Se
acontecer, cancele o excedente com `gh run cancel <id>`.

`build-apk.yml` só tem `workflow_dispatch`: não existe build automático em push.
Perfis disponíveis: `release-candidate`, `pre-release` (os que produzem APK).

## 3. Provar o artifact

```sh
gh api repos/transistir/coiab-app/actions/runs/<RUN>/artifacts \
  --jq '{total_count, artifacts:[.artifacts[]|{name,size_in_bytes,expired}]}'
gh run download <RUN> -R transistir/coiab-app -n coiab-apk -D /tmp/apk
sha256sum /tmp/apk/*.apk
file /tmp/apk/*.apk
```

`total_count >= 1`, artifact não expirado, download concluído, `file` dizendo
`Android package`. Sem isso, o link não vai para o QA.

Reporte: URL do run, SHA do commit, tamanho, SHA-256, package name e
`versionCode`. Package do COIAB: `app.coiab.org`.

## 4. Instalar e olhar

```sh
adb install -r /tmp/apk/*.apk
adb shell pm list packages | grep coiab
adb shell dumpsys package app.coiab.org | grep -E "versionName|versionCode"
```

Abra o app: onboarding, mapa, criar projeto, gravar ponto e track, permissões de
câmera e localização. Tela que abre vazia ou teclado preso não aparece em teste
unitário — só em frame.

## 5. Gate de upgrade com dados — não coberto por CI

Este é o gate que separa "compila" de "instalável em campo". Nunca foi executado
no COIAB até o momento; não declare v14 pronta sem ele.

1. Instale a **versão anterior** (build de QA anterior ou release) em aparelho
   limpo.
2. Crie dados reais: projeto, pelo menos 3 observações com foto, 1 track gravado,
   configuração de idioma alterada.
3. Instale o APK novo **por cima**, sem desinstalar (`adb install -r`).
4. Verifique: app abre, projeto existe, observações e fotos abrem, track aparece,
   idioma mantido, nada duplicado, nenhum crash no `adb logcat`.
5. Exporte um backup/arquivo do projeto antes e depois; compare.

Falha aqui é bloqueio de release, não bug de QA.

## 6. E2E em aparelho

Workflow `e2e-appium-browserstack.yml`: build do APK com perfil `test` e execução
no BrowserStack. Além dos secrets, o step de upload mascara erro (`curl | jq`),
então log de falha pode dizer apenas `jq: parse error` — veja issue #184.

`run-e2e-tests` só executa quando `app_url` existe. `skipped` significa que o
build anterior falhou, nunca "passou".

## 7. iOS

Não configurado. `eas.json` tem imagem macOS e `bundleIdentifier`, mas nenhum
perfil com `ios.simulator: true` e nenhum workflow iOS. Build local é impossível
em Linux. Três caminhos, em ordem de custo: simulador (sem conta Apple, só roda
em Mac), ad-hoc (Apple Developer pago + UDID registrado), TestFlight (conta paga
+ App Store Connect). Sem conta Apple, só o simulador é viável.
