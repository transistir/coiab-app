# #133 — Etnia e aldeia do observador nas observações (Opção C)

- **Autor:** luandro (decisão de produto) / agente orquestrador (redação)
- **Data:** 2026-10-30
- **Issue:** transistir/coiab-app#133
- **Brief:** [concepts_brief.md](./concepts_brief.md)
- **Status:** design revisado por Goldfish (Opus 5.5 + GPT-6.1-Sol); P1/P2 aplicados

**Atualização (2026-11-04):** etnia e aldeia deixaram de ser exibidas e editáveis na #136 (PR #137, merge `ecaac7dd`); as tags continuam automáticas.

## Decisões fechadas pelo owner

- **D6:** o dado é **só do observador** (quem usa o aparelho), nunca da
  comunidade observada.
- **D5:** não existem usuários pré-#128. Perfil incompleto só ocorre por
  estado corrompido; campo vazio não bloqueia e não grava tag.
- **Opção C confirmada:** etnia e aldeia como **tags da observação**, com UI
  própria no app, sem tocar no pacote `.comapeocat`. _(Revista em 2026-11-04:
  a UI foi removida; ver seção de atualização abaixo.)_

## Atualização (2026-11-04) — decisão revista pelo owner

O owner reviu a Opção C: o dado deve existir sem o usuário perceber, então não
é campo de formulário. Etnia e aldeia continuam nas tags, semeadas do perfil
local na criação do rascunho, mas deixaram de ser exibidas e editáveis na UI
(#136, PR #137). As seções abaixo registram o desenho original e onde ele foi
ajustado.

## Problema

O onboarding do #128 coleta etnia e aldeia, mas grava só no aparelho
(`CoiabUserProfile`, MMKV v2). Nenhuma observação carrega esses dados, então
eles não replicam e não aparecem para o resto da organização.

## Objetivos

1. Toda observação nova carrega etnia e aldeia do observador em `tags`.
2. Os valores vêm automaticamente do perfil local, sem campo visível nem
   edição: o rascunho nasce com as tags e o usuário não percebe.
3. A visualização da observação mostra apenas "Registrado por" (nome do
   aparelho que registrou); etnia e aldeia não aparecem na tela.
4. Funciona em organização existente, sem migração e sem reimportar pacote.

## Não-objetivos

- Alterar `.comapeocat`, manifestos ou `conferirImportacao`.
- Backfill de observações antigas.
- Documento de perfil de pessoa no core.
- Mudar o onboarding do #128.
- Trilhas (tracks) no MVP.

## Modelo de dados

| Chave          | Valor                                     | Origem                   |
| -------------- | ----------------------------------------- | ------------------------ |
| `coiab:etnia`  | string, sem espaços nas pontas, não vazia | perfil local `ethnicity` |
| `coiab:aldeia` | string, sem espaços nas pontas, não vazia | perfil local `village`   |

- `@comapeo/schema` aceita qualquer chave em `tags` (sem `propertyNames`) e
  valor string; `field.tagKey` exige só `minLength: 1`, então `coiab:*`
  continua válido se um dia virar campo de pacote.
- **Vazio não vira chave**: nem `''`, nem `null`.
- A tag é retrato do momento da criação. Mudar o perfil depois **não**
  reescreve observações existentes.
- Observações antigas não têm as chaves e continuam válidas.

### Normalização (P1 do review)

Não há mais texto digitado na UI: os valores do perfil já entram aparados por
`observerTags`, e o rascunho nasce com eles. A limpeza continua no **save**, nos
dois botões, através de uma função pura, para garantir o contrato do payload em
qualquer rascunho (retomada, edição, teste):

```ts
// observerProfile.ts
export function normalizeObserverTags(tags: Observation['tags']) {
  // trim nos dois valores; chave vazia é REMOVIDA; demais tags intactas
}
```

- `ObservationCreateSaveButton` e `ObservationEditSaveButton` passam
  `tags: normalizeObserverTags(value.tags)` antes de `createObservation` /
  `updateObservation`.
- Espelha o padrão do onboarding: texto local + normalização no commit
  (`VillageEntry`, `UserProfileStoreContext`).
- Não é criada action nova no store; o save nunca persiste `''` nem chave
  vazia.

## Frontend

### Criação (`ObservationCreate`)

- **Não há campos** de etnia/aldeia: nem em `ObservationCreate`, nem em
  `ObservationEdit` (`ObserverFields` foi removido com o teste).
- O rascunho nasce com as tags do perfil: `useNewObservationDraft()` chama
  `createDraft(undefined, observerTags(profile))` num único `setState`.
- O usuário não vê nem edita os valores; a tela segue só com a descrição e os
  campos do preset.

### Edição (`ObservationEdit`)

- Editar **não aplica o perfil atual nem adiciona** tags do perfil; não há
  preenchimento manual. A normalização no save (`normalizeObserverTags`) continua
  rodando e pode aparar valores existentes e remover chaves vazias.
- Editar uma observação antiga não pode atribuir a etnia de quem edita ao
  registro de outra pessoa.
- Coordenador edita a observação; a normalização no save vale igualmente para
  as tags `coiab:*` já existentes.

### Visualização (`Observation`)

- `ObserverSection` recebe só `createdBy` e renderiza `<Divider />` +
  `ObserverDetails` **apenas quando** o membro tem nome; sem autor (ou sem
  nome), retorna `null` e a seção inteira não aparece.
- `ObserverDetails` recebe só `authorName` e mostra "Registrado por"; etnia e
  aldeia não são lidas nem exibidas a partir das tags.
- A consulta do membro usa `useSingleMember` (com suspense) e fica isolada num
  `ObserverErrorBoundary` local + `<React.Suspense fallback={null}>`. Membro
  ainda não sincronizado (`NotFoundError`) renderiza `null` sem virar evento
  no Sentry; erros inesperados continuam sendo reportados.

### Textos e traduções

Mensagem via `defineMessages`:

- `screens.Observation.recordedBy`

As mensagens de etnia/aldeia não existem mais: o catálogo
`messages/en-US/primary.json` foi regenerado após a remoção dos campos. Os
rótulos do Figma ("Dados sobre Grupo ou Etnia" / "Dados sobre Aldeia Atual")
foram abandonados junto com a UI; a decisão de 2026-10-30 de usar "Etnia do
observador" / "Aldeia do observador" fica registrada apenas como histórico.

**Fluxo real (o review corrigiu o design anterior):** `build:translations`
apenas compila catálogos; não extrai nem traduz. O processo é:

1. `npm run extract-messages` (gera/atualiza chaves);
2. adicionar as entradas em `messages/en-US/primary.json` **e**
   `messages/pt-BR/primary.json`;
3. `npm run build:translations`;
4. `npm run check:message-catalog` (gate de CI).

Sem o passo 2 a UI mostra inglês em pt-BR.

## Fluxo

```
Onboarding (#128)                 Perfil local (MMKV)
        │                                │
        ▼                                ▼
  abrir câmera/mapa  ──►  useNewObservationDraft()
                                 │ createDraft(undefined, observerTags(profile))
                                 ▼
                    ObservationCreate (sem campos de observador)
                                 │ usuário descreve a observação
                                 ▼
             save: normalizeObserverTags(value.tags)
                                 ▼
                    createObservation({tags})
                                 ▼
              sync ──► membros do mesmo projeto
```

A tela `Observation` exibe só "Registrado por"; as tags `coiab:*` viajam nos
dados sem aparecer na UI.

## Casos de borda

| Caso                                | Comportamento                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Perfil vazio                        | Salvar funciona; nenhuma tag do observador é gravada                                                                 |
| Só etnia preenchida                 | Só `coiab:etnia` é gravada                                                                                           |
| Valor vazio ou só espaços no perfil | Normalização remove a chave; nada de `''`                                                                            |
| Espaços internos ("Aldeia Nova")    | Preservados; só as pontas são aparadas no save                                                                       |
| Observação antiga sem tags          | Tags permanecem ausentes; a seção depende de `createdBy` e do nome do membro ser resolvido; editar não adiciona tags |
| Membro removido/sem nome            | Seção inteira omitida (nada de "Registrado por")                                                                     |
| Troca de categoria no rascunho      | `updatePreset` preserva tags que não vieram do preset (teste obrigatório)                                            |
| Offline                             | Nada muda: tags seguem o fluxo normal de observação                                                                  |
| Cliente CoMapeo genérico            | Mostra a chave crua; o dado não se perde                                                                             |

## Alternativas consideradas

- **A — `Observation.metadata`:** só 4 chaves de posição. Inviável.
- **B — campos de preset no pacote:** nativo em qualquer cliente, mas depende
  da #30 (`0.0.0-interino`), quebra convite entre versões de pacote
  (`entrada.ts:120-123`), exige backfill destrutivo e esconde o autofill
  atrás de botão opcional. Fica como dívida, reusando as mesmas chaves.
- **E — estender `deviceInfo`:** schema fechado; `setDeviceInfo` grava em
  todos os projetos do aparelho e anuncia na LAN para não membros
  (`mapeo-manager.js:1038-1075`); cadeia de PRs em `digidem/*`. Rejeitada.
- **F — embutir no nome do aparelho:** vaza para qualquer peer na rede local.
  Rejeitada.

## Plano de implementação

### Arquivos

| Arquivo                                                                  | Mudança                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/frontend/lib/observerProfile.ts` (novo)                             | `OBSERVER_TAG_KEYS`, `observerTags(profile)`, `normalizeObserverTags(tags)`, `observerTagText(value)` |
| `src/frontend/hooks/useNewObservationDraft.ts` (novo)                    | devolve callback: `createDraft(undefined, observerTags(profile))`                                     |
| `src/frontend/contexts/PersistedStores/DraftObservationStore.ts`         | `createDraft(observation?, initialTags?)` — tags iniciais no mesmo `setState`                         |
| `src/frontend/sharedComponents/ObserverDetails.tsx`                      | apresentação pura do autor (`screens.Observation.recordedBy`)                                         |
| `src/frontend/sharedComponents/ObserverSection.tsx`                      | boundary + Suspense do autor; `Divider` e detalhes só com nome                                        |
| `src/frontend/screens/Observation/index.tsx`                             | renderiza `ObserverSection` com `createdBy`                                                           |
| `src/frontend/screens/CameraScreen.tsx`                                  | usa `useNewObservationDraft()`                                                                        |
| `src/frontend/screens/MapScreen/index.tsx`                               | usa `useNewObservationDraft()`                                                                        |
| `src/frontend/screens/ObservationCreate/ObservationCreateSaveButton.tsx` | normaliza tags no payload                                                                             |
| `src/frontend/screens/ObservationEdit/ObservationEditSaveButton.tsx`     | normaliza tags no payload                                                                             |
| `messages/en-US/primary.json`                                            | `screens.Observation.recordedBy` (catálogo regenerado)                                                |

Sem mudança em: `assets/categorias/*`, `manifestos.generated.json`,
`pacotes*.ts`, `materializar.ts`, `entrada.ts`.

### Passos (TDD, RED antes de GREEN)

1. **RED** `observerProfile.test.ts`: chaves; trim de pontas; espaço interno
   preservado; vazio removido; perfil completo/parcial/vazio; demais tags
   intactas; `observerTagText` (string aparada, não-string → `null`).
2. **GREEN** `observerProfile.ts`.
3. **RED** `DraftObservationContext.test.tsx` (convenção do repo; store real,
   `persist: false`):
   - `createDraft(undefined, tags)` aplica tags iniciais;
   - `createDraft(observation)` mantém `obs.tags` e **não** aplica perfil;
   - `updatePreset` preserva `coiab:*` nos dois ramos (preset novo e troca de
     preset).
4. **GREEN** store.
5. **RED** `useNewObservationDraft.test.tsx`: perfil completo preenche as duas;
   parcial preenche uma; vazio não grava nada.
6. **GREEN** hook + troca dos dois call sites.
7. **RED** `ObserverDetails.test.tsx`: autor presente mostra "Registrado por";
   autor ausente ou nome vazio não renderiza nada; etnia/aldeia nunca
   aparecem.
8. **GREEN** `ObserverDetails`.
9. **RED** `ObserverSection.test.tsx`: membro com nome → `Divider` + detalhes;
   sem nome → `null`; `NotFoundError` não vira evento no Sentry.
10. **GREEN** `ObserverSection` e uso na tela `Observation`.
11. **RED** `ObservationCreateSaveButton.test.tsx` (arquivo já existe):
    payload com tags aparadas e **sem** chave vazia; CA1 e CA2 verificados
    aqui. `ObservationEditSaveButton.test.tsx` cobre o mesmo na edição.
12. **GREEN** normalização nos dois botões.
13. Mensagens: `extract-messages` → catálogo en-US → `build:translations`
    → `check:message-catalog`.
14. `npm run lint` (prettier + eslint + `tsc --noEmit`), `npm run test:jest`,
    `npm run test:scripts`.
15. **Verificação manual Android**: observação nova com perfil completo grava
    as tags sem exibir campos; observação antiga **pode** mostrar `Divider` +
    "Registrado por" quando o autor resolve — etnia e aldeia nunca aparecem;
    sem nome de membro, nada é renderizado.

## Critérios de aceite

- **CA1** Observação nova, perfil completo, nasce com `coiab:etnia` e
  `coiab:aldeia` nos dados; nada é exibido nem editável na criação.
- **CA2** Payload salvo não contém `''` nem espaços nas pontas nas duas
  chaves (teste no save button).
- **CA3** Perfil parcial grava só o valor existente.
- **CA4** Mudar o perfil depois não altera observações salvas (garantido por
  construção: perfil só é lido no `createDraft` novo; teste do store cobre a
  edição).
- **CA5** Editar observação não aplica o perfil atual nem adiciona tags do
  perfil; não há preenchimento manual, mas a normalização no save continua
  rodando e pode aparar valores existentes e remover chaves vazias.
- **CA6** A tela mostra só "Registrado por" quando o membro tem nome; sem nome
  (ou membro não sincronizado) não há seção; etnia e aldeia nunca aparecem.
- **CA7** `git diff --stat develop -- assets/categorias src/frontend/lib/organization`
  vazio; roteiro manual: organização criada antes do branch + observação
  conferida num segundo aparelho após sync.
- **CA8** `lint`, `test:jest`, `test:scripts` e `check:message-catalog`
  verdes.

## Riscos e dívidas

- **LGPD art. 5º, II:** origem étnica é dado sensível; herda o consentimento
  do onboarding, mas falta aviso específico antes de compartilhar. O dado é
  replicado nas tags e visível em export/sync, mas não na UI.
- **Sem remoção real:** banco append-only com tombstone; corrigir não apaga
  cópias sincronizadas.
- **Cliente genérico** mostra a chave crua.
- **Dívida B:** quando o pacote canônico da #30 chegar, adicionar os campos
  com as mesmas chaves e rótulos nativos, sem migração.
- **Vocabulário livre:** continua texto livre semeado do perfil (sem sugestões
  do `AutocompleteField` da #132); agregar valores é follow-up de dados, não de
  UI.
- **Sem tela de edição de perfil:** follow-up, não bloqueio (D5); sem ela, o
  autofill reflete apenas o que o onboarding gravou.
