# Issue #105: Jest permanece vivo após uma suíte verde

Investigação em `test/issue-105-open-handle`, base
`782e6b31c0eb28b894e3d558cf91a4540c738a5d`. Sem commit e sem `--forceExit`.

## Causa

O recurso encontrado é um **intervalo JavaScript**, não um socket nativo.
`@sentry/react-native@8.15.1` instancia um mapa privado no import de
`dist/js/tracing/timeToDisplayFallback.js`. O construtor de
`dist/js/utils/AsyncExpiringMap.js` chama `startCleanup()`, que cria um
`setInterval` de 5.000 ms, mesmo sem `Sentry.init()`.

No grafo de integração, a stack observada foi:

```text
setupIntegrationTest → helpers/react → AppProviders
→ LocalDiscoveryContext → @sentry/react-native
→ timeToDisplayFallback → AsyncExpiringMap.startCleanup → setInterval
```

O primeiro callback encontra o mapa vazio e cancela o intervalo. Se os
imports/testes acabam pouco antes disso, o intervalo ainda mantém Node vivo
quando dispara o aviso de 1 segundo. Imports frios ou instrumentados podem
demorar o suficiente para o intervalo se cancelar antes do fim da suíte.
Isso explica a dependência do tempo de execução/cache.

`process._getActiveHandles()` não lista esses timers JavaScript; o preload com
`async_hooks` e `process.getActiveResourcesInfo()` encontrou `Timeout` e a stack
de criação. `why-is-node-running` não está instalado.

`--detectOpenHandles` **consegue** detectar este recurso: no import isolado
do Sentry reportou `Timeout` em `AsyncExpiringMap.startCleanup`. A ausência de
relatório nos runs anteriores não demonstra um handle nativo: a coleta ocorre
depois da suíte, e o intervalo pode já ter expirado durante os imports mais
lentos com instrumentação. O preset atual usa um ambiente que estende
`jest-environment-node`, não jsdom.

## Correção

- `scripts/jest/globalTeardown.cjs`: coleta somente intervalos cuja stack de
  criação contém o arquivo `@sentry/react-native/.../utils/AsyncExpiringMap`;
  desabilita o hook e cancela os intervalos coletados. Não enumera/cancela
  outros recursos e não usa `unref` ou saída forçada.
- `scripts/jest/environment.cjs`: estende o mesmo ambiente do preset React
  Native, inicia a coleta antes do setup e chama a limpeza no teardown de cada
  suíte, sempre executando o teardown original. Isso também cobre workers,
  que vivem em processos inacessíveis ao `globalTeardown` principal.
- `jest.config.js`: registra o ambiente e o `globalTeardown`. Ambos carregam
  o coletor pelo cache de módulos do host Node, fora do registro isolado de
  módulos dos testes.
- `tests/jest/sentryImport.test.ts`: fixture barata com import do SDK real.
  Sua asserção verifica o import; a regressão de saída é verificada executando
  Jest como processo separado e examinando código de saída e stderr.

O mapa do Sentry não exporta cleanup. A coleta direcionada permite manter o
SDK real e encerrar o recurso sem alterar `node_modules` nem mockar sua API.
O filtro depende do nome interno `AsyncExpiringMap`; revalidar ao atualizar
Sentry. A fixture de import continua útil para detectar uma mudança nesse
comportamento. O ambiente também limpa por suíte para não carregar timers
cujo callback pertence a um ambiente Jest já destruído.

## Evidência

Taxas abaixo contam avisos, separadamente do resultado dos testes:

| Caso                             | Antes: aviso / runs | Depois: aviso / runs | Suítes verdes                  |
| -------------------------------- | ------------------- | -------------------- | ------------------------------ |
| Import isolado do Sentry         | 10/10               | 0/10                 | 10/10 antes e depois           |
| Import de `setupIntegrationTest` | 10/10               | 0/10                 | 10/10 antes e depois           |
| `SetQADeviceName.test.tsx`       | 10/10               | Não usado como gate  | 0/10: `listen EPERM 127.0.0.1` |

O teste de tela não pode comprovar suíte verde neste sandbox: a abertura de
sockets é bloqueada. Nenhum mock foi adicionado para contornar essa falha.

Controles adicionais:

- Preload independente da correção observou o intervalo real de 5.000 ms
  destruído após **395 ms**; o revisor observou **até 286 ms**. Portanto, a
  ausência do aviso não depende de esperar a expiração natural do timer.
- Duas suítes com `--maxWorkers=2` passaram sem aviso. O revisor confirmou
  criação/destruição nos dois workers, após **839 e 845 ms**.
- Um intervalo de `node:timers` alheio ao Sentry, que se cancela após 1.800 ms,
  continuou produzindo o aviso normal: a correção preserva o diagnóstico de
  outros vazamentos.
- O import isolado com `--detectOpenHandles` após a correção passou sem
  relatório de recursos abertos.
- Prettier dos arquivos alterados, ESLint e `git diff --check` passaram.
  `npm run lint` chegou ao TypeScript e falhou com
  `.rnstorybook/index.tsx(1,20): TS2307: Cannot find module './storybook.requires'`:
  falta um arquivo gerado ignorado pelo Git, referenciado também no baseline.
  Nenhum arquivo de Storybook foi alterado. ESLint completo teve somente três
  warnings em arquivos existentes; nenhum erro.

Uma tentativa adicional do loop do helper atingiu o limite externo de 90 s
durante saturação de memória/swap causada por verificações concorrentes.
Ela não conta como sucesso nem como reprodução do aviso; a medição final do
helper foi reiniciada separadamente. Um diagnóstico extra do helper com
`--detectOpenHandles` foi interrompido nessa mesma situação e não contribui
evidência.

## Comandos e artefatos

Executados no worktree, sempre sem `--forceExit`:

```sh
npx dotenv -- jest --runInBand src/frontend/screens/SetQADeviceName.test.tsx
npx dotenv -- jest --runInBand tests/tmp/probe.test.ts
npx dotenv -- jest --runInBand tests/tmp/sentry.test.ts
npx dotenv -- jest --runInBand --detectOpenHandles tests/tmp/sentry.test.ts
npx dotenv -- jest --runInBand tests/jest/sentryImport.test.ts
npx dotenv -- jest --runInBand --detectOpenHandles tests/jest/sentryImport.test.ts
npx dotenv -- jest --maxWorkers=2 tests/jest/sentryImport.test.ts tests/tmp/sentry.test.ts
NODE_OPTIONS='--require=/tmp/issue105/trace.cjs' npx dotenv -- jest --runInBand tests/tmp/probe.test.ts
NODE_OPTIONS='--require=/tmp/issue105/sentry-events.cjs' npx dotenv -- jest --runInBand tests/jest/sentryImport.test.ts
npm run lint
npx prettier --check jest.config.js scripts/jest/environment.cjs scripts/jest/globalTeardown.cjs tests/jest/sentryImport.test.ts
```

O probe original importa somente `../integration/helpers/setupIntegrationTest`
e executa uma asserção trivial; `sentry.test.ts` importa somente
`@sentry/react-native` e executa uma asserção trivial. Os probes temporários
foram preservados fora do worktree em `/tmp/issue105/original-probes/`.

Cada loop executou o comando correspondente dez vezes por `subprocess`,
salvando stdout/stderr completo, duração, código de saída e presença de
`Jest did not exit`. Exemplo do loop final do helper:

```python
import subprocess, time, json, os, signal
results = []
for i in range(1, 11):
    t = time.monotonic()
    p = subprocess.Popen(
        ['npx', 'dotenv', '--', 'jest', '--runInBand', 'tests/tmp/probe.test.ts'],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        start_new_session=True,
    )
    try:
        out = p.communicate(timeout=120)[0]
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out = p.communicate()[0]
    open(f'/tmp/issue105/import-after-{i}.log', 'w').write(out)
    r = dict(run=i, seconds=round(time.monotonic()-t, 2),
             code=p.returncode, warning='Jest did not exit' in out)
    results.append(r)
    print(json.dumps(r), flush=True)
    open('/tmp/issue105/import-after.json', 'w').write(json.dumps(results, indent=2))
    if p.returncode:
        break
```

Logs e JSON por run ficam em `/tmp/issue105/`: `before-*` (tela),
`import-before-*`, `import-after-*`, `sentry-before-*`, `sentry-after-*`,
`sentry-detect.log`, `sentry-detect-after.log`, `sentry-events.jsonl`,
`workers.log` e `unrelated.log`.

## Revisão independente

Agente com contexto novo `verify_change`, baseline SHA acima: **nenhum achado
acionável**. Verificou fonte instalada, cache do host, herança do ambiente,
destruição do timer real antes de 5 s, workers e preservação do aviso para
timer alheio. A fixture de import sozinha não assegura saída limpa; os loops
externos e a telemetria do recurso fornecem essa evidência.

SHA-256 dos arquivos de implementação revisados:

```text
jest.config.js
7500dec47b09b2b055b45bc8a2b954d49233d3ae1da3aff7cb0c99026a91ac30
scripts/jest/environment.cjs
bf31b5fd8f2539e751f27a1b453d739f8ad91f9e1336e664442ec8c79e7673b8
scripts/jest/globalTeardown.cjs
d7dd9613cfc7f54a0ac1eb37bfbbe5866cdf43f231813be1a13b473ea351b6ff
tests/jest/sentryImport.test.ts
b7f88f4123bb36cd0f3c9a89f7493b8a95bccbc5c8d86b9f5d910e6e03c37ab9
```
