# Pacotes `.comapeocat` embarcados

`assets/categorias/` carrega os DOIS pacotes de categorias embarcados como
assets de produção (todas as variantes EAS alcançam estes bytes). Até a
entrega dos pacotes aprovados da **#30**, os arquivos aqui são fixtures
**interinas** (conteúdo plausível, mas inventado), emitidos por
`node ./scripts/gerar-manifestos-pacotes.mjs --emitir-fixtures` e marcados no
próprio `metadata.version` com o sufixo canônico **`-interino`**
(`0.0.0-interino`).

Esse sufixo fecha duas portas (SPEC B `:313` — nada inventado é entregue;
`:279` — templates não podem ser atualizados numa organização já em uso):

- **Build** (`scripts/verificar-pacotes-entrega.mjs`, ligado em
  `eas-build-post-install` logo depois de `build:manifestos-pacotes`):
  `APP_VARIANT` `production` | `preRelease` + qualquer `-interino` → exit 1.
- **Runtime** (`src/frontend/lib/organization/pacotesInstalados.ts` →
  `prepare`): variantes de entrega recusam com `pacote_nao_aprovado` ANTES de
  qualquer escrita — nada é instalado, nada é escrito, nenhum projeto é
  criado. `development` e `releaseCandidate` são descartáveis e permitidos.

`manifestos.generated.json` é regerado a partir destes arquivos por
`npm run build:manifestos-pacotes` (o `ref.hash` do manifesto é o sha256
deles).

## Troca pelos pacotes aprovados da #30 (procedimento)

1. Sobrescreva os dois arquivos (`monitoramento.comapeocat`,
   `alertas.comapeocat`) pelos pacotes aprovados — a versão deles **não pode
   terminar em `-interino`**.
2. Rode `npm run build:manifestos-pacotes` e **commite assets e manifesto
   juntos** (o manifesto trava o par asset↔manifesto; separá-los quebra o
   `ref.hash`).
3. **No mesmo commit**, volte à versão real (ou pare de citar o marcador
   `0.0.0-interino` via `VERSAO_INTERINA`) nos pins anti-drift de
   `src/frontend/lib/organization/pacotes.test.ts` — os testes
   `extrairManifesto (extração Node — R1 bundling, anti-drift)` e
   `manifestos.generated.json (manifestos embarcados — anti-drift)` fixam a
   versão dos assets embarcados e passam a falhar após a troca. Apague
   também o teste
   `"o manifesto embarcado é interino até os pacotes de #30"` em
   `src/frontend/lib/organization/pacotesInstalados.test.ts` — ele fixa que o
   manifesto é interino e passa a falhar após a troca.

Nenhuma mudança de código é necessária: o gate de runtime e o de build só
recusam o sufixo `-interino`; versão aprovada atravessa os dois.
