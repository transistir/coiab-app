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

O APK é **arm64-v8a + armeabi-v7a**: 42 libs em cada, fixadas por
`expo-config-plugins/targetArmArchsOnly.js`. Aparelho 32-bit está coberto. A
única ABI ausente é **x86_64**, que serve emulador e sai com
`include_x86_64=true`; sem isso o `adb install` falha com
`INSTALL_FAILED_NO_MATCHING_ABIS`.

Depois de 20-30 s, confirme pela API antes de qualquer novo dispatch:

```sh
gh run list -R transistir/coiab-app --workflow build-apk.yml --limit 1 \
  --json databaseId,status,headSha,event
```

Dispatch repetido gera dois builds do mesmo SHA — ~40 min de runner cada. Se
acontecer, `gh run cancel <id> -R transistir/coiab-app` no excedente.
`build-apk.yml` só tem `workflow_dispatch`: não existe build automático em push.

Perfis e comando de build estão em `docs/ApkBuild.md`. Assinatura/keystore
**não** estão documentados lá: prove a identidade do certificado com
`apksigner verify --print-certs` (ver §5) em vez de confiar no perfil.

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
`org.coiab.rc@14.0-rc+119645e+1_1` — ou seja, `versionName`
`14.0-rc+119645e` mais o sufixo `+<versionCode>_<n>` do Expo.

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
package `org.coiab.rc`) e do **mesmo certificado de assinatura**, feito a partir
do commit imediatamente anterior ao sync — no v14, `c1b0c949`, primeiro pai do
merge `436513f0`. Release de produção não serve: package diferente instala ao
lado.

Reconstruir a baseline, se o artifact expirou. `workflow_dispatch` aceita
branch ou tag, **não SHA**, então crie uma branch no commit:

```sh
git push origin c1b0c949:refs/heads/qa-baseline-pre-v14
gh workflow run build-apk.yml -R transistir/coiab-app \
  --ref qa-baseline-pre-v14 -f profile=release-candidate
```

Depois do gate, apague a ref — ela existe só para servir de `--ref`:

```sh
git push origin --delete qa-baseline-pre-v14
```

Provar que os dois APKs têm o mesmo certificado:

```sh
apksigner verify --print-certs baseline.apk | grep SHA-256
apksigner verify --print-certs novo.apk | grep SHA-256
```

Procedimento:

1. Instalar a baseline em aparelho limpo (`adb uninstall org.coiab.rc` antes).
2. Criar dados reais: 1 projeto, 3 observações com foto, 1 track gravado,
   idioma alterado, 1 categoria customizada.
3. Anotar o estado: contagens visíveis, nomes, idioma.
4. Instalar o APK novo **por cima**, sem desinstalar: `adb install -r <apk>`.
   O `versionCode` novo precisa ser maior ou igual ao da baseline. Build
   não-produção carrega o SHA curto no `versionName` (`app.config.js`), então
   confirme com `adb shell dumpsys package org.coiab.rc | grep versionName` qual
   versão está instalada.
5. Verificar, item por item: app abre; projeto existe; as 3 observações abrem
   com foto; track aparece no mapa; idioma mantido; categoria customizada
   preservada; nada duplicado; `adb logcat` sem crash de migração.
6. Critério de aprovação: **todos** os itens acima verdadeiros. Qualquer perda
   de dado é bloqueio de release, não bug de QA.
7. **Atualize uma vez pelo instalador de pacotes**, como o usuário faz
   (toque no APK, "abrir com" o instalador), não só por `adb install -r`. É o
   caminho que descobre bloqueio de "instalar de fontes desconhecidas" e
   downgrade recusado.
8. **Sync entre versões mistas**: com um aparelho ainda na baseline e outro no
   v14, crie um projeto num e sincronize com o outro. Se o v14 trocou o schema,
   isso aparece aqui e não em teste unitário.
9. **Rollback**: assuma que voltar de versão após a migração **não é possível**
   sem perda. Registre essa expectativa; se o time exigir rollback, ele precisa
   ser desenhado antes da release, não testado depois.
10. **ABI**: o APK cobre arm64-v8a e armeabi-v7a. Falta só x86_64, e só para
    emulador. Nenhum aparelho Android comum fica de fora.
11. Registre o resultado em `docs/upstream-sync/<release>-qa-status.md` como
    `PASS` ou `FAIL`, com aparelho, versão do Android, SHA-256 da baseline,
    SHA-256 do APK novo, data e a evidência de cada item (screenshot ou log).

## 6. E2E em aparelho

Workflow `e2e-appium-browserstack.yml`: build do APK com perfil `test` e execução
no BrowserStack. Ele **não** é nightly: o cron `0-3` roda domingo a quarta, e o
workflow também dispara em PR contra `release/**`. Não é required check de
`develop`.

O job `run-e2e-tests` depende de `build-apk` por `needs`; não existe `if` sobre
`app_url`. Se o upload devolver JSON de erro, o `jq` grava `null` e o job roda
com URL nula — o verde não é prova de nada.

Além disso o upload mascara falhas (`curl | jq` → `jq: parse error`). Issue #184.
`skipped` em `run-e2e-tests` significa que o build anterior falhou, nunca
"passou".

## 7. iOS

Não configurado. `eas.json` tem imagem macOS e `bundleIdentifier`, mas nenhum
perfil com `ios.simulator: true` e nenhum workflow iOS. Build local é impossível
em Linux. Três caminhos, em ordem de custo: simulador (sem conta Apple, só roda
em Mac), ad-hoc (Apple Developer pago + UDID registrado), TestFlight (conta paga
+ App Store Connect). Sem conta Apple, só o simulador é viável.
