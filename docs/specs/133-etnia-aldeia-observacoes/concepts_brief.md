# #133 — Etnia e aldeia no metadado das observações (Opção B)

- **Autor:** luandro (decisão de produto) / agente orquestrador (levantamento)
- **Data:** 2026-10-30
- **Issue:** transistir/coiab-app#133
- **Status:** brainstorm — decisões de owner em aberto

## Problema

O onboarding do #128 coleta etnia e aldeia e grava **só no aparelho**
(MMKV `CoiabUserProfile`, envelope v2, `{ethnicity, village}` em texto livre).
Nada disso entra no metadado das observações, então não replica e não aparece
para o resto da organização.

`Observation.metadata` do `@comapeo/core` aceita apenas `manualLocation`,
`position`, `lastSavedPosition` e `positionProvider`. O único campo livre é
`tags`, que replica com a observação.

**Decisão já tomada (owner, opção B):** etnia e aldeia viram **campos de
preset** do pacote COIAB (`.comapeocat` → `fields.json` + `categories.json`),
materializados por organização via `OrganizationMaterializerContext` →
`clienteDeCriacao` → `core.$importCategories`.

## O que o código diz hoje (evidência)

1. **Perfil local** — `src/frontend/contexts/UserProfileStoreContext.tsx`:
   `ethnicity`/`village` como `string | null`, trim, `isProfileComplete()`
   exige os dois. **O gate de perfil só vale para documento vazio**
   (`Navigation/Stack/index.tsx:90` e `:113-117`): aparelho que já tem
   organização vai direto para `Home`, com perfil possivelmente vazio. Um
   envelope `version !== 2` também vira perfil vazio
   (`UserProfileStoreContext.tsx:62-64`). Logo, perfil incompleto é o **caso
   normal** de quem já usava o app antes do #128 — D5 não é borda.

2. **Pacotes ainda são fixtures interinas** —
   `assets/categorias/{monitoramento,alertas}.comapeocat` têm
   `metadata.version = 0.0.0-interino`, geradas por
   `scripts/gerar-manifestos-pacotes.mjs` (constante `FIXTURES`). O gate de
   runtime (`pacotesInstalados.ts`) e o de build
   (`verificar-pacotes-entrega.mjs`) recusam `-interino` em `production` e
   `preRelease`. O pacote canônico da #30 **não existe ainda**; hoje,
   Monitoramento = 1 preset de observação (Árvore, campo `especie`) + 1 de
   trilha (Rio); Alertas = 1 + 1. Nenhum campo de etnia/aldeia.

3. **Materialização por organização** — cada organização cria **dois
   projetos** (Monitoramento e Alertas) e importa um pacote em cada um
   (`materializar.ts` → `$importCategories`). A conferência pós-importação
   compara o conteúdo importado com o manifesto canônico (presets, fields,
   refs, seleção padrão). `docs/specs/organizacao/spec-criar-organizacao.md:279`
   declara **fora de escopo** "atualização de templates de organizações já em
   uso".

4. **`$importCategories` recria tudo e só então desliga os antigos** — em
   `digidem/comapeo-core` `src/import-categories.js`, o import enumera os
   docIds existentes, valida o arquivo, **cria** fields e presets novos,
   reconstrói `defaultPresets` com os IDs novos via `$setProjectSettings` e
   **depois** marca os documentos antigos como deletados. O banco é imutável:
   deletar é um tombstone (`deleted: true`), o histórico não some. Portanto
   `defaultPresets` é atualizado, mas nenhuma observação é migrada — os
   `presetRef` antigos continuam apontando para os docs aposentados. A
   exibição sobrevive porque `useObservationWithPreset` resolve preset por
   tags (`matchPreset`), e essa resolução é heurística, por pontuação, sem
   exigir correspondência completa (`utils.ts:128`). Reimportar **não é
   backfill de valores históricos**: só atualiza o template.

5. **Fluxo de criação de observação** — `createDraft()` abre o rascunho
   (câmera) → escolha de preset → `ObservationFields` percorre
   `preset.fieldRefs` **uma pergunta por tela** → save monta `value.tags` e
   chama `createObservation`. Ponto de autofill seguro é **só o ramo sem
   argumento** de `createDraft()` (`DraftObservationStore.ts:313-323`, usado
   por `CameraScreen.tsx:21` e `MapScreen/index.tsx:115`). `createDraft(observation)`
   é o caminho da edição (`Observation/index.tsx:82`) e não pode receber
   autofill. **As perguntas só abrem por botão opcional**
   (`ActionsRow/index.tsx:81-86`); `ObservationCreate` mostra só `notes`.
   Quem salva sem abrir os detalhes grava o autofill **sem ver**.

6. **Exibição** — a tela `Observation` renderiza somente campos do preset
   (`FieldDetails`); `ObservationMetadata` mostra só metadados de posição. Os
   rótulos do Figma ("Dados sobre Grupo ou Etnia" / "Dados sobre Aldeia
   Atual") exigem ou campos com esses labels no pacote, ou uma seção dedicada.

7. **API de core para docs** — `src/datatype/index.js` expõe
   `create/update/delete/getMany` para `field` e `preset`. O app **já usa**
   `project.preset.getMany()`/`field.getMany()` pela RPC real
   (`pacotes.ts:383-384`), e `pacotes.ts:368-369` registra que o
   rpc-reflector expõe toda propriedade do projeto como proxy.
   **INFERÊNCIA forte:** `field.create`/`preset.update` respondem pela mesma
   superfície. Falta provar com chamada real (ou com caso em
   `tests/integration/cliente-superficie.test.ts`).

8. **Convite entre versões diferentes quebra** — no aceite de convite,
   `entrada.ts:101,120-123` confere o projeto de quem convidou contra o
   pacote **embarcado no aparelho do convidado**; `conferirImportacao` exige
   conjunto de campos exatamente igual (`pacotes.ts:321-324`, `:400-407`) e
   refs uma a uma (`:494-513`). Convidado com pacote v2 numa organização criada
   com v1 (ou o contrário) recebe `categories-not-synced`. Qualquer mudança de
   conteúdo do pacote cria dependência de ordem de atualização entre membros.

## Objetivos

- Toda observação criada numa organização COIAB carrega etnia e aldeia em
  `tags`, replicando com a observação.
- Autofill a partir do perfil local, visível e editável antes de salvar.
- Os dois valores aparecem na visualização da observação.
- Organização nova nasce com os campos nos dois projetos.
- Comportamento definido quando o perfil está incompleto.

## Não-objetivos

- Replicar identidade do autor (deviceId/`createdBy` já existe; não há doc de
  perfil de dispositivo no core).
- Atravessar organizações (cada organização é um conjunto de projetos).
- Mexer no onboarding do #128.
- Permitir que usuário crie/edite categorias.

## Decisões de owner em aberto

**D1 — Origem do conteúdo do pacote**
- (a) Adicionar etnia/aldeia às fixtures interinas agora e fixar contrato com
  a #30 para que os pacotes aprovados já tragam os dois campos. Entrega
  funciona em `development`/`releaseCandidate`; produção continua bloqueada
  pelo sufixo `-interino` até a #30.
- (b) Esperar a #30 e só então especificar/implementar.
- (c) Não tocar no pacote: criar os docs de field em runtime (core suporta;
  IPC não verificado). Elimina dependência da #30, mas foge da opção B
  escolhida e do modelo "pacote é a fonte da verdade".

**D2 — Quais presets recebem os campos**
- (a) Todos os presets de observação dos dois pacotes (hoje: Árvore e Fogo) —
  toda observação pergunta os dois valores.
- (b) Todos os presets, inclusive de trilha.
- (c) Não anexar aos presets: gravar as tags no save e exibir numa seção
  própria. Não muda o formulário; edição exige UI dedicada.

**D3 — Backfill de organizações existentes** (o item 4 da issue contradiz o
spec atual)
- (a) Sem backfill: só organizações novas. Simples; organizações em uso nunca
  ganham os campos.
- (b) Reimportar pacote v2 nos projetos existentes: apaga e recria todos os
  presets/fields (ver evidência 4). Precisa de plano de migração para
  `presetRef`/`defaultPresets`.
- (c) Criar/anexar docs em runtime sem reimportar (core suporta; IPC não
  verificado). Menor blast radius, mas é atualização de template — hoje fora
  de escopo declarado.

**D4 — Chaves, rótulos e tipo**
- `tagKey`: `etnia` / `aldeia`? O mapa de tags é único e indexado por chave;
  gravar a mesma chave sobrescreve o valor (`DraftObservationStore.ts:366`).
  Se o campo representa o **observador**, reservar namespace estável (ex.:
  `coiab:observer:ethnicity`) para não colidir com campo genérico futuro do
  pacote. Validar o formato aceito de `tagKey` no `@comapeo/schema` antes.
- tipo: `text` singleline livre, ou `selectOne` com dataset de etnias/aldeias?
- rótulos do Figma literais ("Grupo ou Etnia", "Aldeia Atual")? Rótulo pode
  mudar sem mudar a chave; a chave é contrato.

**D5 — Perfil incompleto**
- (a) perguntas aparecem vazias e o usuário pode pular.
- (b) tag vazia não é gravada.
- (c) bloqueia salvar até preencher.

**D6 — Sujeito do dado: observador ou comunidade observada?**
Os rótulos do Figma ("Dados sobre Grupo ou Etnia", "Dados sobre Aldeia Atual")
são ambíguos. O #128 guarda o perfil **de quem usa o aparelho**; a observação
pode ser sobre outra aldeia. Se o campo é do observador, o autofill do perfil
faz sentido. Se é da comunidade observada, o perfil não é a fonte certa e o
preenchimento precisa ser manual (ou um segundo par de campos).

**D7 — Autofill em edição de observação antiga**
Aplicar autofill só na **criação**. Em edição, preencher o perfil de quem
edita atribuiria a etnia/aldeia do editor a um registro histórico de outra
pessoa. Observações antigas devem mostrar "sem resposta" e só ganhar valor se
alguém digitar explicitamente.

## Achados do Goldfish — rodada 1 (contexto zero)

**gpt-6.1-sol:**

- **Correção aceita:** a ordem do import estava descrita errada (evidência 4
  já corrigida). Reimportação não inviabiliza D3(b) por causa de
  `defaultPresets`, mas também não é backfill de valores.
- **IPC:** evidência forte (não executada) de que `field.create`/
  `preset.update` atravessam a superfície genérica `ClientApi<MapeoProject>`
  do `@comapeo/ipc` 9.0.1 — o servidor entrega o projeto inteiro. D3(c) é
  viável, mas exige prova real antes de virar plano.
- **Autofill em edição:** risco real de atribuir o perfil do editor a
  registro histórico → virou D7.
- **Namespace:** chave de tag é contrato permanente, não rótulo → virou D4.
- **Privacidade:** o brief trata replicação como "já aceito", mas não define
  retenção, correção nem remoção. Corrigir o perfil local não corrige cópias
  já sincronizadas.

**claude-opus-5-5:**

- **Evidência 1 estava errada** e foi corrigida: o gate de perfil só vale
  para documento vazio. Perfil incompleto é o caso normal de quem já tinha
  organização antes do #128.
- **Autofill:** `createDraft(observation)` é o caminho da edição; autofill só
  no ramo sem argumento (`DraftObservationStore.ts:313-323`).
- **Import não é atômico** e não tem rollback; dois coordenadores offline
  podem duplicar presets/fields.
- **Convite entre versões** quebra por `categories-not-synced`
  (`entrada.ts:120-123`) — dependência de ordem de atualização entre membros.
- **Permissão:** MEMBER tem `writeOthers: false`; migração só por criador ou
  coordenador.
- **Visibilidade:** as perguntas ficam atrás de botão opcional; o autofill
  pode ser salvo sem o usuário ver.
- **Opção C tem precedente** (`notes`) e resolve replicação, exibição,
  organizações existentes e #30 de uma vez.

## Alternativas descartadas

- **A — escrever em `Observation.metadata`:** core aceita só 4 chaves; não
  existe campo livre. Descartada antes da opção B.
- **C — só tags, sem field docs + UI própria (precedente real: `notes`):**
  `notes` já é tag editada fora dos presets (`ObservationCreate/index.tsx:109-114`)
  e exibida fora do `FieldDetails` (`Observation/index.tsx:131-135`). O mesmo
  serve para etnia/aldeia: preencher no `createDraft()` sem argumento, mostrar
  dois campos editáveis na própria `ObservationCreate` e uma seção na tela
  `Observation` lendo `observation.tags`.
  - Replica igual: tags viajam com a observação.
  - Trocar de categoria não apaga: `updatePreset` mantém tags que não vieram
    do preset (`DraftObservationStore.ts:395-402`).
  - Não mexe em pacote, em `conferirImportacao` nem no convite entre versões.
  - Funciona em organização existente sem backfill (D3 desaparece).
  - Sem dependência da #30.
  - Custo: rótulos ficam nas traduções do app, não no pacote; outros clientes
    (ex.: CoMapeo desktop) exibem a tag sem rótulo. **INFERÊNCIA.**
- **B vs C:** B entrega campo nativo do pacote, editável pelo editor padrão e
  visível em qualquer cliente CoMapeo; paga com dependência da #30, risco de
  convite entre versões, backfill caro e autofill invisível. C entrega a
  replicação e a exibição no app com uma fração do risco, mas o dado fica
  "só COIAB" em clientes genéricos. A decisão é de produto, não técnica.
- **D — observação separada / anotação por pessoa:** duplica dados e não é
  atributo da observação.

## Riscos

- **Dependência #30:** o conteúdo canônico é externo; mexer só nas fixtures
  pode não sobreviver à entrega real.
- **Import não é atômico:** falha entre criar e apagar deixa presets/fields
  duplicados (o próprio core tem TODO sobre isso, `import-categories.js:37-40`).
  Dois coordenadores reimportando offline produzem dois conjuntos e
  `defaultPresets` bifurcado depois do sync.
- **Sem rollback:** voltar atrás exige outro reimport, que gera docIds novos;
  as deleções já replicaram.
- **Convite entre versões:** mudança de conteúdo do pacote faz
  `categories-not-synced` entre app antigo e novo (evidência 8).
- **Permissão de migração:** MEMBER tem `writeOthers: false` (`roles.js:172-180`);
  D3(b)/(c) só funcionam para criador ou coordenador.
- **Autofill invisível:** as perguntas ficam atrás de botão opcional; salvar
  sem abrir grava os valores sem o usuário ver.
- **Backfill destrutivo:** reimportar apaga presets/fields e troca docIds.
- **UX:** duas telas extras por observação (uma por campo). Com autofill, o
  usuário só confirma; sem autofill, vira formulário obrigatório.
- **Qualidade de dado:** texto livre gera variantes ("Kaxuyana" vs
  "kaxuyana"); relatórios agregados ficam frágeis.
- **Privacidade:** etnia/aldeia passam a ser atributo visível a todos os
  membros do projeto (já aceito na issue), mas sem decisão de retenção,
  correção ou remoção. Corrigir o perfil local não corrige cópias já
  sincronizadas.
- **Duplicidade:** o mesmo campo precisa existir nos dois projetos da
  organização (Monitoramento e Alertas).

## Sugestão dos seniors (Opus 5.5 + GPT-6.1-Sol, contexto zero)

Pergunta do owner: "todas as informações do dispositivo — nome, etnia e aldeia".

**Convergência:** os três dados têm semânticas diferentes e não cabem no mesmo
lugar.

- **Nome do dispositivo** já replica: `deviceInfo` é doc por projeto e aparece
  em `YourTeam` (`CollaboratorInfo.tsx:72,90`). Não copiar para tags.
- **Etnia/aldeia** são retrato do momento do registro → `observation.tags`.
  Perfil local vira só preferência de autofill.
- **Estender `deviceInfo` (upstream) está descartado:**
  - schema fechado (`additionalProperties: false`, sem campo livre);
  - `setDeviceInfo` grava em **todos** os projetos do aparelho
    (`mapeo-manager.js:1038-1058`) → etnia vazaria para qualquer outra
    organização do device;
  - e faz broadcast para **todos** os peers conectados na rede local, não só
    membros (`mapeo-manager.js:1059-1075`);
  - cadeia de PRs em `comapeo-schema` → `comapeo-core` → `@comapeo/ipc` →
    `core-react-native`, e `AGENTS.md` proíbe escrever em `digidem/*`.
- **Embutir no nome do device ("Maria · Kaxuyana · Aldeia X") está
  descartado:** o nome é anunciado na LAN para qualquer aparelho CoMapeo,
  inclusive não membro, e o seletor de convite lista esses aparelhos
  (`SelectInviteDevice.tsx:74,133`). Vaza etnia sem consentimento.

**Recomendação:** opção C agora — tags com namespace (`coiab:etnia` /
`coiab:aldeia`; `tagKey` aceita qualquer string ≥1 char no schema), autofill
só no `createDraft()` sem argumento, dois inputs visíveis em
`ObservationCreate` (precedente: `notes`) e seção na tela `Observation`.
Opção B fica como dívida, junto com o pacote canônico da #30, reusando as
**mesmas** chaves de tag — a #30 já troca o pacote, então não cria quebra de
versão extra.

**Pré-requisito descoberto:** quem já tinha organização nunca passa pelo gate
de perfil (`Navigation/Stack/index.tsx:113-117`). Sem uma tela de edição de
perfil fora do onboarding (Configurações), essas pessoas nunca teriam
autofill.

**Riscos de produto:** origem étnica é dado pessoal sensível (LGPD art. 5º,
II) — exige consentimento explícito; banco é append-only com tombstone, então
correção/remoção não apaga cópias já sincronizadas; definir se trilhas também
recebem as tags.

## Próximos passos

1. Owner decide D1–D5.
2. Goldfish review (contexto zero) sobre este brief + código.
3. `/egm-draft`: design doc em `docs/specs/133-etnia-aldeia-observacoes/`.
4. `/egm-review`: estágios de compreensão, crítica e prontidão de
   implementação.
