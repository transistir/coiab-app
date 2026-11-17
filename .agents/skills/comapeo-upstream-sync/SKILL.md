---
name: comapeo-upstream-sync
description: Use when bringing an official CoMapeo release into the neutral trunk and then into a fork (coiab-app). Pins the release tag, keeps merge ancestry, forces every changed path through the customization contract, and records a ledger with real verification.
---

# Sync de release oficial do CoMapeo para o trunk e para os forks

Objetivo: trazer uma release oficial do CoMapeo sem perder o trabalho dos forks e
sem inventar evidência. A ancestry precisa sobreviver — é ela que faz o próximo
sync calcular a merge-base certa em vez de reaplicar conflitos antigos.

## Ordem obrigatória

1. **Release oficial**, nunca a ponta da branch. `git ls-remote --tags` e confirme
   o SHA completo da tag. Registre também a versão do `package.json`.
2. **Trunk** (`transistir/comapeo-mobile-1`): merge de `digidem/<tag>` em
   `develop`, push direto permitido.
3. **Fork** (`transistir/coiab-app`): branch `sync/...` a partir de `develop`, PR
   contra `develop`. `develop` é protegida.

`digidem/*` é read-only por política. Fetch, diff e leitura de CI são permitidos;
qualquer escrita não é.

## Merge commits, sempre

Squash e rebase destroem a merge-base e transformam o próximo sync em arqueologia
manual. Use `--merge` no PR e `merge --no-edit` localmente. Nunca `-X ours` ou
`-X theirs` globais: resolução em bloco esconde perda de trabalho.

## Antes de pushar o merge

1. **Grep nos arquivos do fork** por scripts e dependências que a release removeu.
   Um merge textualmente limpo pode quebrar `package.json` e workflows do fork —
   caso real: `build:backend` e `src/backend` desapareceram sem conflito.
2. `npx tsc --noEmit` e `npm run lint` locais.
3. Rode o contrato de customizações (abaixo) e feche `uncovered` e `ambiguous` em
   zero.

## Contrato de customizações

```
node scripts/sync/check-customizations.mjs --parent <fork-base> --head HEAD
```

O checker falha fechado: caminho mudado sem regra, ambiguidade, id duplicado ou
manifesto inválido derrubam. Manifesto: `.sync/customizations.json`.

Regras que não se negocia:

- **`upstream-wins`** só é honesto quando o caminho é byte-idêntico ao trunk **e**
  o fork não o editou desde a merge-base. Verifique os dois com `git diff` por
  caminho. Sem isso, a regra está escondendo perda de fork.
- **`fork-only`** significa "existe no fork e não no trunk" — confirme com
  `git cat-file -e <trunk>:<path>`, que precisa falhar. `fork-only` **não** é
  status `A`: só `D` representa perda. Exigir `A` faz o gate reprovar qualquer
  arquivo do fork tocado por conflito no sync seguinte.
- Regra com `intent` que contradiz a própria `policy` é bug de classificação, não
  detalhe de redação.
- À medida que o fork cresce, caminho novo sem regra derruba o gate no próximo
  sync. Ao adicionar diretório próprio do fork (skills, workflows, docs), adicione
  a regra **no mesmo PR** — o gate só roda em branch `sync/*`, então o erro
  aparece semanas depois, no pior momento.

## Ledger

`docs/upstream-sync/<release>-ledger.md` mais a evidência bruta ao lado.

- `verified_at` é o último commit que muda **código**. Commit docs-only não pode
  validar a si mesmo; declare isso no arquivo.
- Cada linha cita `git log`/`git diff` que a sustenta. Sem prova: `unverified`.
- Descreva a ancestralidade real (`<sha> trunk merge`, `<sha>` head do PR), não a
  versão que parece mais arrumada.

## Revisão independente

- Dois revisores de contexto fresco, no **SHA congelado**, com o diff e o
  contrato — nunca com as conclusões de quem implementou.
- Qualquer commit novo invalida a aprovação. Para commit que só toca CI,
  pergunte explicitamente se o delta mantém o APPROVE.
- BLOCK com prova vence APPROVE sem prova, mesmo em minoria.
- Merge só com required checks verdes e zero threads unresolved.

## Armadilhas de CI que já custaram rodadas

- `--testPathIgnorePatterns` na linha de comando **substitui** o array do
  `jest.config.js`. Editar o config não resolve nada quando o step passa flags.
- Suítes que estouram heap rodam em processos próprios, com descoberta via
  `git ls-files` e falha explícita se a lista vier vazia.
- Teste de `node:test` com nome `*.test.mjs` é coletado pelo `testMatch` do Jest e
  derruba o job com todos os testes verdes. Exclua o diretório no ponto onde o
  Jest realmente lê a configuração.
- O CI pós-merge é a única prova do commit de merge. Verde de PR prova o head do
  PR, nada mais.
- Marcar PR em draft como "ready for review" dispara nova rodada de CI pelo
  trigger `ready_for_review`. O verde anterior fica velho; espere `pending=0` da
  rodada nova. A API devolve checks antigos e novos juntos no mesmo SHA.

## Workflow quebrado não é regressão da release

Antes de atribuir falha de CI ao sync:

1. `gh run list --workflow <file> --limit 10` e compare as datas com a data do
   merge. Falha que já existia antes não foi causada pela release.
2. Leia o **step que falhou**, não o fim do log. `gh run view <id> --log-failed`
   e `--json jobs --jq '.jobs[].steps[]|select(.conclusion=="failure")'`.
3. Nome de secret errado parece erro de autenticação: `secrets.EXPO` quando o
   secret real é `EXPO_TOKEN` produz `An Expo user account is required`. Confira
   com `gh secret list` e `git grep -n "secrets\\." .github/workflows/`.
4. Deploy preview de terceiro (Netlify) falhando gera **vários** check-runs a
   partir de **um** deploy — `Redirect rules`, `Header rules`, `Pages changed` são
   consequência, não problemas distintos. Se não é required na branch protegida,
   não bloqueia merge; registre como dívida de configuração em vez de caçar.

## Disparar build e provar artifact

1. `workflow_dispatch` pode demorar a aparecer na listagem. **Confirme pela API
   antes de disparar de novo** — dispatch repetido cria dois builds do mesmo SHA,
   queimando ~40 min de runner cada. Se duplicou, `gh run cancel` no excedente.
2. Artifact só existe quando a API diz `total_count >= 1`. Log de upload bem
   sucedido não prova nada.
3. Baixe e inspecione: `gh run download <run> -n <artifact> -D <dir>`, `file`,
   `sha256sum`, contagem de `classes*.dex`/`lib/`. Reporte o SHA-256.
4. Em workflow com steps encadeados, `curl ... | jq` esconde o erro HTTP: credencial
   vazia vira `jq: parse error`. Achado real do E2E — issue #184.

## O que nunca foi provado por este processo

Build nativo, APK, upgrade sobre instalação com dados e E2E em aparelho não são
cobertos por CI de unidade. Declare isso como não verificado em vez de inferir.
O run que produz o APK prova que compila e empacota; **não** prova que atualiza
sobre uma instalação existente sem perder dados. São gates diferentes.

Procedimento de QA e checklist de upgrade: skill `coiab-qa-apk`.
