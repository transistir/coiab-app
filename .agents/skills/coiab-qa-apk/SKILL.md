---
name: coiab-qa-apk
description: Use when producing or checking a COIAB App QA build (APK) and deciding whether a release is testable in the field. Covers secret inventory, dispatch, artifact verification, install and the upgrade-with-data gate that CI does not cover.
---

# QA build do COIAB App: do commit ao aparelho

Objetivo: entregar um APK de QA com procedência provada e dizer, sem enfeite, o
que ele **não** prova.

`transistir/coiab-app` é o repo de trabalho. `transistir/comapeo-mobile-1` é o
trunk; builds de QA saem do fork.

## Identidade do pacote

`app.config.js` compõe o applicationId a partir de `APP_ID_BASE = 'org.coiab'`
mais o sufixo do `APP_VARIANT`:

| Variante | Package | Nome |
|---|---|---|
| development | `org.coiab.dev` | CoiabApp Dev |
| releaseCandidate | `org.coiab.rc` | CoiabApp RC |
| preRelease | `org.coiab.pre` | CoiabApp Pre |
| production | `org.coiab` | CoiabApp |

`app.coiab.org` é domínio de deep link, **não** package. Build de QA com perfil
`release-candidate` instala como `org.coiab.rc`; uma release de produção é
`org.coiab` e **não** atualiza por cima do RC — são apps distintos.

## 1. Inventário antes de gastar runner

```sh
gh secret list -R transistir/coiab-app
gh variable list -R transistir/coiab-app
git grep -n "secrets\.\|vars\." .github/workflows/
```

Cada referência precisa existir com o **nome exato**. Nome errado não falha no
parsing: chega vazio e vira erro de autenticação no meio do build, 30 minutos
depois. Caso real: `secrets.EXPO` em vez de `EXPO_TOKEN`.

Referenciados pelos workflows e **ausentes** no repo: `BROWSERSTACK_USERNAME`,
`BROWSERSTACK_ACCESS_KEY`, `RELEASE_BOT_USER_ID`, `PR_BOT_APP_ID`,
`PR_BOT_PRIVATE_KEY`, `LOCKFILE_BOT_*`. `APP_VARIANT` não é secret nem variável
de Actions: vem do `eas.json`.

## 2. Disparar

```sh
gh workflow run build-apk.yml -R transistir/coiab-app --ref develop \
  -f profile=release-candidate -f include_x86_64=false
```

O APK padrão é **somente arm64**. Para emulador x86_64, `include_x86_64=true` —
sem isso o `adb install` falha com `INSTALL_FAILED_NO_MATCHING_ABIS`.

Depois de 20-30 s, confirme pela API antes de qualquer novo dispatch:

```sh
gh run list -R transistir/coiab-app --workflow build-apk.yml --limit 1 \
  --json databaseId,status,headSha,event
```

Dispatch repetido gera dois builds do mesmo SHA — ~40 min de runner cada. Se
acontecer, `gh run cancel <id>` no excedente. `build-apk.yml` só tem
`workflow_dispatch`: não existe build automático em push.

## 3. Provar o artifact

```sh
gh api repos/transistir/coiab-app/actions/runs/<RUN>/artifacts \
  --jq '{total_count, artifacts:[.artifacts[]|{name,size_in_bytes,expired}]}'
gh run download <RUN> -R transistir/coiab-app -n coiab-apk -D /tmp/apk
sha256sum /tmp/apk/*.apk
file /tmp/apk/*.apk
```

`total_count >= 1`, artifact não expirado, download concluído, `file` dizendo
`Android package`. Retenção de artifact é de **30 dias** — passou disso, o link
morre e a baseline precisa ser reconstruída a partir do SHA.

Reporte: URL do run, SHA do commit, tamanho, SHA-256, package e `versionName`.
Para extrair do APK sem `aapt` instalado, use o log do run: o prebuild imprime
`<package>@<versionName>+<versionCode>_<n>`, por exemplo
`org.coiab.rc@14.0-rc+119645e+1_1`.

## 4. Instalar e olhar

```sh
adb install -r /tmp/apk/*.apk
adb shell pm list packages | grep org.coiab
adb shell dumpsys package org.coiab.rc | grep -E "versionName|versionCode"
```

Abra o app e faça um smoke mínimo: onboarding, mapa carrega, criar projeto,
gravar ponto e track, permissões de câmera e localização, idioma. Se o app não
abre, nada depois importa — registre o crash do `adb logcat` e pare.

## 5. Gate de upgrade com dados — não coberto por CI

Risco central do v14: o backend mudou (`src/backend` saiu, entrou
`@comapeo/core-react-native`), então o caminho de migração de storage só é
exercitado aqui.

**Baseline obrigatória:** build do **mesmo perfil** (`release-candidate`,
package `org.coiab.rc`), da **mesma keystore**, feito a partir do commit
imediatamente anterior ao sync (o último commit do fork antes do merge da
release). Release de produção não serve: package diferente instala ao lado.

Reconstruir a baseline, se o artifact expirou:

```sh
git -C /root/dev/worktrees/<baseline> checkout <sha-pre-sync>
gh workflow run build-apk.yml -R transistir/coiab-app --ref <sha-pre-sync> \
  -f profile=release-candidate
```

Procedimento:

1. Instalar a baseline em aparelho limpo (`adb uninstall org.coiab.rc` antes).
2. Criar dados reais: 1 projeto, 3 observações com foto, 1 track gravado,
   idioma alterado, 1 categoria customizada.
3. Anotar o estado: contagens visíveis, nomes, idioma.
4. Instalar o APK novo **por cima**, sem desinstalar: `adb install -r <apk>`.
   O `versionCode` novo precisa ser maior ou igual ao da baseline; se o build
   mantiver `versionCode` 1, o `-r` funciona mas não há como distinguir versões
   no aparelho — registre isso.
5. Verificar, item por item: app abre; projeto existe; as 3 observações abrem
   com foto; track aparece no mapa; idioma mantido; categoria customizada
   preservada; nada duplicado; `adb logcat` sem crash de migração.
6. Critério de aprovação: **todos** os itens acima verdadeiros. Qualquer perda
   de dado é bloqueio de release, não bug de QA.
7. Registrar o resultado em `docs/upstream-sync/<release>-qa-status.md`, com
   aparelho, Android, SHA da baseline, SHA do APK novo e data.

## 6. E2E em aparelho

Workflow `e2e-appium-browserstack.yml`: build do APK com perfil `test` e execução
no BrowserStack. O job `run-e2e-tests` depende de `build-apk` por `needs`; não
existe `if` sobre `app_url`. Se o upload devolver JSON de erro, o `jq` grava
`null` e o job roda com URL nula — o verde não é prova de nada.

Além disso o upload mascara falhas (`curl | jq` → `jq: parse error`). Issue #184.
`skipped` em `run-e2e-tests` significa que o build anterior falhou, nunca
"passou".

## 7. iOS

Não configurado. `eas.json` tem imagem macOS e `bundleIdentifier`, mas nenhum
perfil com `ios.simulator: true` e nenhum workflow iOS. Build local é impossível
em Linux. Três caminhos, em ordem de custo: simulador (sem conta Apple, só roda
em Mac), ad-hoc (Apple Developer pago + UDID registrado), TestFlight (conta paga
+ App Store Connect). Sem conta Apple, só o simulador é viável.
