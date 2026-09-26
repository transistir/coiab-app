# #86: `ELOCKED` no deep link do frame 001 (captura Storybook)

**Status:** aplicado nesta branch (`fix/issue-86-elocked-coldstart`): mitigação A — cold start
direto no deep link da 1ª story do manifest — implementada em `e10dee12`; caracterização RED/GREEN
do core em Node (`tests/integration/core-create-get-race.test.ts`) implementada em `22f19ed0`. O
passo 0 em disco reproduziu a janela: 8 `ELOCKED` em 1 projeto, primeiro em ~1066 ms. A issue
upstream (§9) continua **não aberta**.
**Base:** `investigate/86-elocked-deeplink` @ `df7d128b`. Stack: `@comapeo/core` 7.4.0 (a mesma versão
dentro do backend empacotado, `nodejs-project/package.json`) e `@comapeo/core-react-native` 1.0.0-pre.12.
**Evidência de runtime:** run com falha `storybook-captures-21` (`/tmp/oc-cap-artifact/storybook-captures-21`,
efêmero), `001-flows-onboarding--intro.failure-logcat.txt` e `cold-start-provenance.txt`.

## TL;DR

- O `ELOCKED` é um **lock OFD de escrita no arquivo `oplog`** de cada hypercore. Quem pede o lock é o
  `random-access-file`, via `fcntl(F_OFD_SETLK)`. **Não há retry** em camada nenhuma, e a rejeição
  fica sem handler. O backend trata qualquer rejeição sem handler como fatal: o Node sai, o app
  cai em `Server not loading`.
- Os 5 `oplog` travados pertencem aos **5 cores próprios de um mesmo projeto** (auth, config, data,
  blobIndex e blob; o último aparece como `BlobStore error`), e todos falham em 37 ms. Existe **um
  único processo Node** (pid 3766), que subiu uma única vez. A leitura consistente com isso é esta:
  **uma segunda instância de `MapeoProject`, para um projeto cuja primeira instância ainda segura os
  locks, no mesmo processo.** Como locks OFD valem por descrição de arquivo aberto e não por
  processo, isso conflita dentro do mesmo processo.
- Existe uma janela no core que produz exatamente isso. `MapeoManager.createProject()` grava as
  chaves na tabela em `mapeo-manager.js:497`, o que já faz `listProjects()` enxergar o projeto. Só
  depois de dois `await` ele registra a instância em `#activeProjects`, em `:525`. Um `getProject(id)`
  chamado nessa janela erra o cache (`:557`) e constrói uma **segunda** instância (`:583`). O dedupe
  do `@comapeo/ipc` (`server.js:57-73`) só une chamadas `getProject` concorrentes entre si. Ele não
  sabe da instância que o `createProject` está montando.
- **Por que sempre o frame 001.** O cold start do harness é um `MAIN/LAUNCHER` sem URL, e o 1º deep
  link chega antes de o Storybook montar, então se perde. O Storybook sobe então na **story padrão do
  índice (`"*"`)**. Com AsyncStorage vazio, e ele sempre está vazio num AVD novo, essa story começa a
  **semear projetos**. O retry de 5 s do `storybook-capture.sh` troca de story no meio dessa semeadura.
  Depois do frame 001, toda troca só acontece quando o flow-state já assentou, e é por isso que as
  linhas seguintes não sofrem disso.
- **Mitigação recomendada:** (1) agora, no harness (código COIAB, só script, sem rebuild do APK):
  fazer o cold start já no deep link da linha 1, o que elimina a story padrão que semeia. (2) A
  correção de verdade é no upstream `@comapeo/core`: registrar ou deduplicar a instância durante o
  `createProject` e o `getProject`. O rascunho da issue está no fim deste documento e **não foi
  aberto**. Retry com backoff no chamador **não funciona**: o erro nunca chega ao chamador (ver §6).
  Patch local via `patch-package` **não alcança o device**, porque o core roda de um bundle
  pré-compilado (ver §5).

## 1. Linha do tempo medida (run 21, logcat da falha)

| Hora (UTC) | Processo | Evento |
|---|---|---|
| 14:43:17 | harness | `started_utc`. Força parada e `am start` **MAIN/LAUNCHER, sem URL** (`storybook-capture-all.sh:218-227`) |
| ~14:43:24 | app 3736 | `Running "main"` → `ready_utc=14:43:24Z`. É o bundle JS iniciando, **antes** do backend e antes da Activity ser exibida |
| 14:43:24.543 | system | **Deep link nº 1** (`START … VIEW storybook://x/… result code=3`, `storybook-capture.sh:106-115`) |
| 14:43:24.552/.615 | app 3736 | `onPause` e `onResume` → FGS `onStartCommand` USER_BACKGROUND (startId=2) e USER_FOREGROUND (startId=3) |
| 14:43:26.095 | FGS 3766 | `Starting Comapeo Node server...` (**única** vez) |
| 14:43:26.314 | FGS 3766 | `RootKeyStore: generated for first install`, ou seja, instalação nova |
| 14:43:27.254 | FGS 3766 | `received: ready` → `STARTING → STARTED` |
| 14:43:27.855 | system | `Displayed org.coiab.rc/.MainActivity: +10s50ms` |
| 14:43:29.826-.846 | harness | **Deep link nº 2**: o retry de 5 s, porque a identidade não tinha aparecido (`storybook-capture.sh:324-328`) |
| 14:43:29.838/.840 | app 3736 | `onPause` e `onResume` → FGS USER_BACKGROUND (startId=4) e USER_FOREGROUND (startId=5) |
| 14:43:29.857 | app 3736 | `STORYBOOK: Linking event received, navigating to story: flows-onboarding--intro`, a **primeira** vez que esta linha aparece |
| 14:43:30.305-.342 | FGS 3766 | `ELOCKED` em `core-storage/76a5e3…/corestore/cores/{00/68,e4/6c,f8/2f,d1/6f,24/12}/…/oplog`, e em seguida `Fatal during runtime` |
| 14:43:30.319 | FGS 3766 | `STARTED → ERROR`. `node exiting` às 30.414 |
| 14:43:30.437 | app 3736 | `Error: Server not loading` (ErrorBoundary) |

Pontos que a tabela deixa estabelecidos:

- O deep link nº 1 **se perdeu**: nenhuma linha `Linking event received` aparece para ele.
- **Não houve reinício do backend**: um único pid Node e um único `Starting Comapeo Node server`.
- O projeto `76a5e3…` foi **criado neste boot**, entre 27.25 e 30.3, porque a instalação é nova.

## 2. Como o deep link é disparado, quando e quantas vezes (Tarefa 1)

1. `.github/workflows/storybook-capture.yml:147-168`: AVD novo por run (`force-avd-creation`,
   `-no-snapshot`), `adb install` e depois `scripts/storybook-capture-all.sh`.
2. `storybook-capture-all.sh:206-227`: `force-stop`, `logcat -c` e **cold start MAIN/LAUNCHER sem
   `-d`**. Espera `Running "main"` (`:229-245`), o que prova só que o bundle JS rodou. **Não** prova
   que o backend está em STARTED nem que o Storybook montou.
3. Para cada linha do manifest (`:260-280`), `storybook-capture.sh` envia
   `am start -a VIEW -d storybook://x?STORYBOOK_STORY_ID=<id>` (`:106-115`). Se a identidade não
   aparecer, **reenvia a cada 5 s** (`:324-328`) até vê-la.
4. **Por que o nº 1 se perde:** `StorybookRoot` é filho de `<ServerLoading>` (`src/frontend/App.tsx:278-305`).
   O listener `Linking` do Storybook (`node_modules/@storybook/react-native/dist/index.js:1127-1143`)
   só existe depois de o backend chegar a STARTED. Às 24.5 o backend ainda nem tinha iniciado.
5. **Qual story monta no boot:** `getInitialURL()` devolve a intent de lançamento, que não tem URL.
   Com AsyncStorage vazio, `_getInitialStory` devolve `storySpecifier: "*"`, que é a **primeira
   entrada do índice** (`index.js:1016-1029`, com `RN_STORYBOOK_STORAGE_KEY = "lastOpenedStory"` em `:963`).
   Pela ordem dos arquivos de `.rnstorybook/main.ts:4`, a primeira é provavelmente `Flows/CreateObservation`
   (`src/frontend/flows/CreateObservation.stories.tsx:90`: `FLOW_STATES.onboardedWithData`, que semeia
   uma organização com 2 projetos e 5 observações). **A verificar** (§8.1): a ordem exata do índice em
   runtime. A conclusão, porém, não depende dela, porque qualquer story com `project`, `organization`
   ou `organizations` cria projetos no boot.
6. **Contagem por run:** 1 cold start + 1 deep link por linha + retries de 5 s enquanto a identidade não
   aparece. Na linha 1 são **2 deep links** (o perdido e o retry). Cada um causa `onPause`/`onResume`
   (a Activity é `LAUNCH_SINGLE_TASK`, `result code=3`, ou seja, entregue ao topo e **não** recriada).

## 3. Caminho de inicialização e os pontos de abertura do mesmo storage (Tarefa 2)

**App (processo 3736)**
- `index.js:1-6` → `src/frontend/App.tsx`. Lá ficam `createLocalDiscoveryController(mapeoApi).start()`
  (`:100-101`), `AppState` → `focusManager.setFocused` (`:215-217`) e `<ServerLoading>` →
  `<AppProviders>` → `StorybookRoot` (`:278-311`).
- Com `onPause`/`onResume` o `AppState` do RN vai de `active` para `background` e volta a `active`,
  e então o react-query **refaz os fetches de foco** (`App.tsx:215-217`). Qualquer query de
  `listProjects` ou de organização volta a rodar **exatamente** na troca de story. Isto é hipótese de
  mecanismo e não foi medido.
- Seeds de flow (`.rnstorybook/utils/flowState.ts:339-666`, efeito `apply()`). Mudar qualquer
  dependência reexecuta o `apply()`. `cancelled` só impede continuar **depois** que o RPC em voo
  volta (`:465`, `:479`, `:491`). O RPC em si continua rodando no backend.
  - `seedData.ts:56-64` `useSeedProject`: `listProjects()` e depois `createProject`.
  - `seedData.ts:74-114` `useSeedOrganization`: `listProjects()`, busca por marcador em
    `projectDescription`, e `createProject` ×2.
  - `seedData.ts:238-279` `useSeedOrganizationDocument`: `listProjects()`, busca por marcador (`:248-254`)
    e `createProject` (`:257`) em sequência.
  - `seedData.ts:303` e `:543`: `clientApi.getProject(projectId)`.
- Motores de organização que abrem projetos por id: `useOrganizationActivation.ts:166-167`,
  `lib/organization/activation.ts:166` e `:248`, `materializar.ts:230`, `:272`, `:318` (e
  `listProjects` + `createProject` em `:288-301`), `fanout.ts:627`.

**FGS / Kotlin (processo 3766)**
- `ComapeoCoreReactActivityLifecycleListener.kt:20-30`: `onResume` → USER_FOREGROUND e `onPause` →
  USER_BACKGROUND, via `startForegroundService`.
- `ComapeoCoreService.kt:191-202`: USER_BACKGROUND com o serviço já iniciado **só atualiza a
  notificação**. `:185-188` → `startService` promove ao foreground e **retorna em `:360`** se
  `isServiceStarted`. `ensureBackendInitialized` tem guarda em `:155`. `NodeJSService.start` recusa
  estado ≠ STOPPED (`NodeJSService.kt:452-461`). Nenhum desses caminhos reabre o storage.

**Backend Node (bundle `…/assets/nodejs-project/index.mjs`, fonte `@comapeo/core` 7.4.0)**
- `@comapeo/ipc` `dist/server.js:57-73`: `getProjectInstance` deduplica por projectId com uma
  **promise** em `currentInstanceForProject`. `:79-98` `openProjectInstance` → `manager.getProject(id)`.
- `@comapeo/core/src/mapeo-manager.js`:
  - `:260-263`: `Hypercore.defaultStorage(coreStorage, { pool })`. `:381-388`: subdiretório por
    `projectId`, que é o `76a5e3…` do caminho.
  - `createProject` `:466-549`: **`:497` grava `projectKeys`**, de modo que `listProjects` já enxerga
    o projeto. `:505` cria a instância A. `:512` `await $setProjectSettings`. `:521`
    `await kSetOwnDeviceInfo`. **`:525` `#activeProjects.set`**. `:538` `importConfig`.
  - `getProject` `:555-601`: cache `:557`, chaves `:562-581`, **`:583` nova instância**, `:593` `set`.
    Não há dedupe de promise dentro do manager.
  - `listProjects` `:636-702`: devolve o projeto em criação com status `joining` antes das settings
    serem indexadas, e `joined` com nome e descrição depois.
- `@comapeo/core/src/mapeo-project.js:607-611`: `close()` faz `await #coreManager.close()`, depois
  `sqlite.close()`, e só então `emit('close')`. Portanto fechar e reabrir não abre janela óbvia (H4
  fica baixa).

**Onde duas aberturas do MESMO storage podem concorrer:** entre `mapeo-manager.js:497` e `:525`,
qualquer `getProject(id)` para o id que está sendo criado, seja vindo do IPC (`server.js:82`) ou do
próprio manager, abre uma 2ª instância. Isso exige que o cliente descubra o id por `listProjects()`
antes de o `createProject` retornar. Os seeds do Storybook e o materializador fazem exatamente isso:
descobrem ids por marcador via `listProjects`.

## 4. O lock exato e se há retry (Tarefa 3)

| Camada | Arquivo:linha | O que faz |
|---|---|---|
| hypercore | `node_modules/hypercore/index.js:184`, `:192-194` | `toLock = opts.lock \|\| 'oplog'`. **Só o arquivo `oplog`** é aberto com `lock: true`, e com `pool: null` |
| random-access-file 4.1.2 | `node_modules/random-access-file/index.js:87-99` | `onopen` → `fsext.tryLock(fd, { shared: mode === RDONLY })`. Se falha, `onlock(createLockError(filename))` |
| | `:241-246` | `createLockError` → `Error('ELOCKED: File is locked')` (a `:242` citada no #86) |
| | `:127-132` | `onerrorafteropen` fecha o fd e repassa o erro. **Sem retry** |
| fs-native-extensions (1.4.2 na raiz, 1.5.0 no `.so` do APK) | `src/linux.c:21-33` | `fcntl(fd, F_OFD_SETLK, {F_WRLCK, 0, 0})` sobre o arquivo inteiro. `EAGAIN` → `tryLock` devolve `false` (no bundle: `if(e.code==='EAGAIN')return!1`) |
| bundle do device | `index.mjs:389`, `function m(e){…ELOCKED…}` e `s.tryLock(n.fd,{shared:r})?u(null):u(m(n.filename))` | Confirma que os frames `m` e `c` do stack no logcat são `createLockError` e `onopen` |
| backend | `index.mjs:562` (`Z9`: `console.error('Fatal during ${phase}:')` e broadcast `{type:'error'}`) | A rejeição sem handler vira `Fatal during runtime`, e o processo sai |
| FGS | `NodeJSService.kt:675-685`; `ComapeoCoreService.kt:396-414` | ERROR, e 3 s depois o self-terminate |
| app | `src/frontend/ServerLoading.tsx:16-19` (segundo o handoff) | `throw Error('Server not loading')` → "Something Went Wrong" |

- **É um lock de filesystem**: `F_OFD_SETLK` (open file description lock) sobre
  `…/core-storage/<projectId>/corestore/cores/<aa>/<bb>/<discoveryKey>/oplog`.
- Locks OFD ficam presos à descrição de arquivo aberto, **não ao processo**. Dois `open()` do mesmo
  `oplog` no **mesmo** processo conflitam. Com `F_SETLK` POSIX clássico isso não aconteceria.
- **Retry embutido: nenhum**, nem em random-access-file, nem em hypercore/corestore, nem em
  `@comapeo/core`. O erro nem chega a quem chamou `getProject`: o construtor de `MapeoProject` dispara
  a abertura dos cores sem `await`, então a falha aparece como `unhandledRejection` (o logcat diz
  literalmente "rejecting a promise which was not handled").

## 5. `patch-package` (Tarefa 4)

- **Sim, o repo usa:** `package.json:15` (`"postinstall": "patch-package"`), `:199` (`patch-package` 8.0.1)
  e `patches/` com 7 patches (zeroconf, vision-camera, maplibre, expo-file-system e outros) mais `README.md`.
- **Não serve para este bug.** O core que roda no device é o bundle pré-compilado
  `node_modules/@comapeo/core-react-native/android/src/main/assets/nodejs-project/index.mjs`, com
  rolldown e minificação, e a linha 389 tem mais de 300 KB. `node_modules/@comapeo/core/src/*` na raiz
  só serve para tipos e frontend, e um patch ali **não muda nada no APK**. Um patch local teria que
  editar o bundle minificado, o que é frágil, deixa os sourcemaps de Sentry obsoletos e quebra a cada
  bump. A alternativa seria recompilar o backend, mas o pacote publicado não inclui `backend/`.

## 6. Hipóteses rankeadas

| # | Hipótese | Veredito | Evidência |
|---|---|---|---|
| **H1′** (refina H1) | **`getProject` do mesmo projeto durante a janela do `createProject`** (`mapeo-manager.js:497→525`), gerando uma 2ª instância no mesmo processo | **Mais provável, e é a causa raiz** | 5 `oplog` de um único projeto falham juntos; pid Node único; projeto criado neste boot; janela confirmada no código; o dedupe do IPC não cobre `createProject` (`server.js:57-73`) |
| H1 original | Dois `getProject` antes do cache preencher | **Improvável isoladamente** | O IPC deduplica por promise (`server.js:57-73`). Sobra só a janela de microtask de `getProject` chamado internamente pelo manager (`addProject`, `:787`), que não entra neste fluxo |
| **H3** | O pipeline dispara o deep link antes de o boot terminar | **Verdadeira, mas é o gatilho e não a causa** | O deep link nº 1 às 24.5 foi perdido porque o backend só ficou pronto às 27.25. Isso deixa o Storybook na story `"*"`, que semeia, e o retry às 29.84 troca de story no meio da semeadura (§2) |
| H2 | O app reinicializa o backend no deep link | **Refutada** | `ComapeoCoreService.kt:197-198` e `:360`; um único `Starting Comapeo Node server`; mesmo pid 3766 antes e depois |
| H4 (nova) | Fechar e reabrir o projeto sem soltar os fds | **Baixa** | `mapeo-project.js:607-611` só emite `close` depois de `#coreManager.close()`. Não verifiquei se o corestore aguarda o `fs.close` de cada arquivo |

**Cadeia causal provável (H1′ + H3):**
cold start sem URL (`storybook-capture-all.sh:218-227`) → deep link nº 1 perdido (`App.tsx:278-305`,
`@storybook/react-native/dist/index.js:1127-1143`) → Storybook seleciona `"*"` (`index.js:1016-1029`) →
o flow-state da story padrão chama `listProjects`/`createProject` (`seedData.ts:238-279`, `flowState.ts:488-550`)
→ retry do deep link (`storybook-capture.sh:324-328`) → `onPause`/`onResume` com refetch de foco
(`App.tsx:215-217`) e `SET_CURRENT_STORY` (`index.js:1133-1135`) → algum caminho resolve o id do
projeto em criação via `listProjects` e chama `getProject` (candidatos: `seedData.ts:248-256` →
`useOrganizationActivation.ts:166-167`, `activation.ts:166/248`, `materializar.ts:230/272/318`) →
`server.js:82` → `mapeo-manager.js:557` erra o cache → `:583` 2ª instância → `hypercore/index.js:192-194`
→ `random-access-file/index.js:97-98` → `linux.c:30` `EAGAIN` → `ELOCKED` (`:242`) → sem handler →
`index.mjs:562` fatal → `ServerLoading.tsx:16-19`.

**O que ainda não está provado:** *qual* chamador faz o 2º `getProject`. O logcat não tem logs JS
dos RPCs, e entre o boot e a falha só aparece uma linha `ReactNativeJS`. Os candidatos estão
listados acima, e o §8 traz como fechar essa lacuna.

## 7. Mitigação recomendada

| Opção | Onde | Resolve? | Custo e risco |
|---|---|---|---|
| **A. Cold start direto na linha 1 (recomendada, curto prazo)** | `scripts/storybook-capture-all.sh` (COIAB) | Remove o gatilho no CI: o Storybook monta já na linha 1 (`freshInstall`, **que não cria projetos**) via `getInitialURL` (`index.js:1144-1159`). Nenhuma story semeia no boot, e o retry da linha 1 vira troca para a mesma story | Só script. Não precisa rebuild do APK e vale no próximo "Re-run". Não corrige o core |
| B. `initialSelection` numa story sem seed | `.rnstorybook/index.tsx` | Mesmo efeito que A | Exige rebuild do APK e passar env pelo workflow. Pior que A |
| C. Retry com backoff no chamador (app) | hooks e seeds | **Não.** A falha não é devolvida ao chamador: é uma `unhandledRejection` no backend que **mata o processo Node**. O próprio `getProject` pode ter resolvido com sucesso | O único "retry" possível é reiniciar o backend inteiro, que é o que o "Re-run failed jobs" já faz (orçamento 2) |
| **D. Correção no core (recomendada, definitiva)** | upstream `@comapeo/core` | Sim: `createProject` registra a instância antes dos `await` (ou mantém um mapa de instâncias pendentes), e `getProject` deduplica por promise | Depende do upstream e de um bump de `core-react-native`. **Rascunho de issue abaixo, não aberta** |
| E. Patch local | `patch-package` no bundle | Tecnicamente sim | Frágil (bundle minificado, sourcemaps, cada bump). **Não recomendado** (§5) |

**Justificativa.** A corrige o CI hoje, é barata, é reversível e mexe só em código COIAB. D é a
correção de verdade, porque a janela `:497→:525` também existe fora do Storybook. Em produção, o
materializador descobre ids com `listProjects` (`materializar.ts:288-301`) e abre com `getProject`
(`:230/:272/:318`). **Não verifiquei** se os registros de lock da camada de org (commit `638d63bb`)
serializam ativação contra materialização a ponto de fechar essa janela. Fica como risco em aberto
para produção. C não se aplica, pelas razões da tabela.

### Esboço de patch da opção A (NÃO aplicado)

```diff
--- a/scripts/storybook-capture-all.sh
+++ b/scripts/storybook-capture-all.sh
@@ -122,6 +122,10 @@ while IFS= read -r line || [[ -n $line ]]; do
   labels+=("$label")
 done <"$manifest_path"
 
+if (( ${#story_ids[@]} == 0 )); then
+  fail "manifest has no stories: $manifest_path"
+fi
+
 cd -- "$repo_root"
 node - "$repo_root/.rnstorybook" "${story_ids[@]}" <<'NODE'
@@ -158,7 +162,7 @@ printf '%s\n' \
   "package_id=$package_id" \
   "force_stop_command=adb shell am force-stop $package_id" \
   "log_clear_command=adb logcat -c" \
-  "launcher_command=adb shell am start -n $package_id/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER" \
+  "launcher_command=adb shell am start -n $package_id/.MainActivity -a android.intent.action.VIEW -d storybook://x?STORYBOOK_STORY_ID=${story_ids[0]}" \
   >"$provenance_path"
 
 adb wait-for-device
@@ -215,11 +219,19 @@ fi
 printf 'log_clear_status=passed\n%s\n' "$log_clear_output" >>"$provenance_path"
 
+# Cold-start straight into the first manifest story (#86). A bare launcher
+# start leaves Storybook on its index-default story ("*" with empty
+# AsyncStorage), and that story's flow state seeds projects. The first row's
+# deep link then switched stories while the seed was still inside core's
+# createProject, and a getProject in that window opened a second instance of
+# the same project: ELOCKED on its oplogs, fatal backend. Launching with the
+# URL lets Storybook pick the row through Linking.getInitialURL() instead.
 if ! launcher_output=$(
   adb shell am start \
     -n "$package_id/.MainActivity" \
-    -a android.intent.action.MAIN \
-    -c android.intent.category.LAUNCHER 2>&1
+    -a android.intent.action.VIEW \
+    -d "storybook://x?STORYBOOK_STORY_ID=${story_ids[0]}" 2>&1
 ); then
   printf 'launcher_status=failed\n%s\n' "$launcher_output" >>"$provenance_path"
   fail "could not cold-start Storybook; see $provenance_path"
```

O que conferir no esboço antes de aplicar:
- A checagem de identidade continua igual. O `storybook-capture.sh` da linha 1 ainda envia o deep link
  dele, e é o listener (`index.js:1134`) que registra `Linking event received, navigating to story: <id>`.
  A seleção via `getInitialURL` registra outra linha (`Setting initial story from Linking event`, `:1155`)
  e não conta para a identidade. A linha 1 continua exigindo o deep link do harness, como hoje.
- A expansão de `?` pelo shell do device: o `-d` está entre aspas do mesmo jeito que em
  `storybook-capture.sh:110`, que já funciona.
- O texto `no_hmr_basis` (`:250`) cita "launcher cold start". Ajustar a redação.
- Descarte explícito: esperar STARTED antes do 1º deep link (H3 "pura") **não basta**. O Storybook
  montaria de qualquer forma na story `"*"` e começaria a semear.

## 8. Como fechar as lacunas (antes de aplicar ou de abrir issue)

1. **Story padrão do índice.** Rodar o mesmo `buildIndex` que `storybook-capture-all.sh:125-145` já
   usa e imprimir `Object.keys(index.entries)[0]` para confirmar qual story `"*"` seleciona e o
   `FLOW_STATES` dela.
2. **RED/GREEN do core (Node, sem emulador)**, com `@comapeo/core` 7.4.0 real e diretórios temporários:
   `const p = manager.createProject({name})`; fazer polling de `manager.listProjects()` até o id
   aparecer; chamar `manager.getProject(id)` **antes** de `p` resolver. O resultado esperado no código
   atual é `ELOCKED` via `unhandledRejection` (RED). Com a correção D, deve devolver a mesma instância
   (GREEN). Isso segue a regra de reprodução do `AGENTS.md`.
3. **Identificar o 2º chamador no device** num run instrumentado: sondas `DIAG` temporárias em
   `seedData.ts` (`ensure`, `createProject`, `getProject`) e em `useOrganizationActivation.ts:166`,
   removidas depois. O grep de sondas é gate obrigatório.
4. **Validar A no CI:** N runs (por exemplo 5) do `storybook-capture.yml` com o script alterado, sem
   nenhum `capture:failure` de ELOCKED. Hoje a taxa medida é pelo menos 1 em 2 no `f104c7fd`.

## 9. Rascunho de issue upstream (para revisão humana, NÃO abrir)

> Destino sugerido: `digidem/comapeo-core`. **Não abrir por agente** (`AGENTS.md`: nunca escrever em
> `digidem/*`). Revisar, confirmar a reprodução do §8.2 e só então decidir.

**Title:** `getProject()` can open a second `MapeoProject` for a project that `createProject()` is still initializing (ELOCKED, fatal on mobile)

**Body:**

> `MapeoManager.createProject()` persists the project keys (`mapeo-manager.js:497` in 7.4.0), which
> makes the project visible to `listProjects()` right away. It only registers the instance in
> `#activeProjects` after `await project.$setProjectSettings()` and
> `await project[kSetOwnDeviceInfo]()` (`:525`). A `getProject(projectPublicId)` call in that window
> misses the cache (`:557`) and constructs a second `MapeoProject` over the same storage (`:583`).
>
> Hypercore's default storage opens every core's `oplog` with an exclusive
> `fcntl(F_OFD_SETLK)` lock (random-access-file → fs-native-extensions). OFD locks conflict between
> two open file descriptions even within one process, so every own core of the second instance fails
> with `ELOCKED: File is locked`. The failure happens during core open, which the constructor does not
> await, so it surfaces as an unhandled rejection. In `@comapeo/core-react-native` that is fatal to the
> whole backend (`Fatal during runtime`, then `process.exit`).
>
> `@comapeo/ipc`'s `currentInstanceForProject` dedupes concurrent `assertProjectExists` calls. It
> cannot see an instance that `createProject()` is still building.
>
> **Repro (Node):** start `createProject()` without awaiting it, poll `listProjects()` until the new id
> appears, then call `getProject(id)` before `createProject()` resolves. You get `ELOCKED` on each own
> core's `oplog`.
>
> **Possible fix:** register the instance (or a pending promise) in `#activeProjects` immediately after
> `#createProjectInstance()` in `createProject()`, and evict it if a later step throws. Dedupe
> `getProject()` by caching the in-flight promise, so concurrent calls, including internal ones like
> `addProject()` → `getProject()`, share one instance.
>
> Observed with `@comapeo/core` 7.4.0 through `@comapeo/core-react-native` 1.0.0-pre.12, on a fresh
> Android install: a client that discovers project ids through `listProjects()` opened one of them
> while it was still being created.

Nota separada, também para revisão humana, sobre `digidem/comapeo-core-react-native`: uma rejeição sem
handler vinda da abertura de **um** projeto derruba o backend inteiro. Vale discutir se falhas por
projeto deveriam ser isoladas. É uma questão de design, não um bug óbvio.
