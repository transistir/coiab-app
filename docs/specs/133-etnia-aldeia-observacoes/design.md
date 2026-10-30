# #133 — Etnia e aldeia do observador nas observações (Opção C)

- **Autor:** luandro (decisão de produto) / agente orquestrador (redação)
- **Data:** 2026-10-30
- **Issue:** transistir/coiab-app#133
- **Brief:** [concepts_brief.md](./concepts_brief.md)
- **Status:** design revisado por Goldfish (Opus 5.5 + GPT-6.1-Sol); P1/P2 aplicados

## Decisões fechadas pelo owner

- **D6:** o dado é **só do observador** (quem usa o aparelho), nunca da
  comunidade observada.
- **D5:** não existem usuários pré-#128. Perfil incompleto só ocorre por
  estado corrompido; campo vazio não bloqueia e não grava tag.
- **Opção C confirmada:** etnia e aldeia como **tags da observação**, com UI
  própria no app, sem tocar no pacote `.comapeocat`.

## Problema

O onboarding do #128 coleta etnia e aldeia, mas grava só no aparelho
(`CoiabUserProfile`, MMKV v2). Nenhuma observação carrega esses dados, então
eles não replicam e não aparecem para o resto da organização.

## Objetivos

1. Toda observação nova carrega etnia e aldeia do observador em `tags`.
2. Os valores são preenchidos a partir do perfil local, **visíveis e
   editáveis na tela de criação**, antes de salvar.
3. A visualização da observação mostra etnia, aldeia e o nome do aparelho que
   registrou.
4. Funciona em organização existente, sem migração e sem reimportar pacote.

## Não-objetivos

- Alterar `.comapeocat`, manifestos ou `conferirImportacao`.
- Backfill de observações antigas.
- Documento de perfil de pessoa no core.
- Mudar o onboarding do #128.
- Trilhas (tracks) no MVP.

## Modelo de dados

| Chave | Valor | Origem |
|---|---|---|
| `coiab:etnia` | string, sem espaços nas pontas, não vazia | perfil local `ethnicity` |
| `coiab:aldeia` | string, sem espaços nas pontas, não vazia | perfil local `village` |

- `@comapeo/schema` aceita qualquer chave em `tags` (sem `propertyNames`) e
  valor string; `field.tagKey` exige só `minLength: 1`, então `coiab:*`
  continua válido se um dia virar campo de pacote.
- **Vazio não vira chave**: nem `''`, nem `null`.
- A tag é retrato do momento da criação. Mudar o perfil depois **não**
  reescreve observações existentes.
- Observações antigas não têm as chaves e continuam válidas.

### Normalização (P1 do review)

O rascunho guarda o texto **como digitado** — nada de `trim()` a cada tecla,
senão "Aldeia Nova" perde o espaço intermediário. A limpeza acontece no
**save**, nos dois botões, através de uma função pura:

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
  (`VillageEntry.tsx:67`, `UserProfileStoreContext.tsx:141-144`).
- Não é criada action nova no store; o rascunho pode conter `''` até salvar,
  e o save nunca persiste vazio.

## Frontend

### Criação (`ObservationCreate`)

- `ObserverFields` logo abaixo de `DescriptionField`
  (`ObservationCreate/index.tsx:109-114`): dois campos single-line.
- **Rótulo permanente acima do campo** (não usar o rótulo flutuante do
  `DescriptionField`, que só aparece com o teclado aberto — com autofill o
  valor apareceria sem rótulo).
- Cada `TextInput` com `accessibilityLabel` próprio (RN não associa rótulo a
  campo), `testID` próprio (`OBS.observer-ethnicity-inp`,
  `OBS.observer-village-inp`) e `returnKeyType="next"`.
- Texto de apoio curto indicando que vem do perfil e é opcional.
- Autofill ao iniciar rascunho novo: `createDraft(undefined, observerTags)`
  aplica os valores num único `setState`.

### Edição (`ObservationEdit`)

- Mesmos campos, com os valores existentes do rascunho.
- **Sem autofill**: `createDraft(observation)` nunca aplica perfil. Editar uma
  observação antiga não pode atribuir a etnia de quem edita ao registro de
  outra pessoa.
- Coordenador pode editar os valores de outra pessoa — consequência aceita de
  D6 e da permissão que já existe em `useCanEditOrDelete`.

### Visualização (`Observation`)

- `ObservationDetails` (componente de apresentação, testável como
  `FieldDetails.test.tsx`) renderiza:
  - "Etnia do observador" / "Aldeia do observador" (só as presentes);
  - "Registrado por": nome do aparelho.
- **Regra da seção:** renderiza **somente se houver ao menos uma tag
  `coiab:*`**. Observação antiga não ganha seção só com o autor.
- Nome do autor: componente filho com `useSingleMember({projectId, deviceId})`
  dentro de `<React.Suspense fallback={null}>` próprio (o hook usa suspense;
  isolar evita travar a tela inteira, como já é feito com `TrackAccordian`,
  `Observation/index.tsx:128-130`).
- `useSingleMember` pode devolver `name: undefined` (membro removido/ainda não
  sincronizado): nesse caso a linha "Registrado por" é omitida; etnia e aldeia
  continuam visíveis.

### Textos e traduções

Novas mensagens via `defineMessages`:

- `screens.ObservationCreate.observerEthnicity`
- `screens.ObservationCreate.observerVillage`
- `screens.Observation.observerEthnicity`
- `screens.Observation.observerVillage`
- `screens.Observation.recordedBy`
- texto de apoio dos campos

**Fluxo real (o review corrigiu o design anterior):** `build:translations`
apenas compila catálogos; não extrai nem traduz (`scripts/build-translations.mjs:45-48`).
O processo é:

1. `npm run extract-messages` (gera/atualiza chaves);
2. adicionar as entradas em `messages/en-US/primary.json` **e**
   `messages/pt-BR/primary.json`;
3. `npm run build:translations`;
4. `npm run check:message-catalog` (gate de CI).

Sem o passo 2 a UI mostra inglês em pt-BR.

Rótulos do Figma ("Dados sobre Grupo ou Etnia" / "Dados sobre Aldeia Atual")
são ambíguos à luz de D6. **Decisão do owner (2026-10-30):** usar
"Etnia do observador" / "Aldeia do observador".

## Fluxo

```
Onboarding (#128)                 Perfil local (MMKV)
        │                                │
        ▼                                ▼
  abrir câmera/mapa  ──►  useNewObservationDraft()
                                 │ createDraft(undefined, tags)  (1 setState)
                                 ▼
                        ObservationCreate (2 campos visíveis)
                                 │ usuário edita/limpa
                                 ▼
             save: normalizeObserverTags(value.tags)
                                 ▼
                    createObservation({tags})
                                 ▼
              sync ──► membros do mesmo projeto
```

## Casos de borda

| Caso | Comportamento |
|---|---|
| Perfil vazio | Campos vazios; salvar funciona; nenhuma tag |
| Só etnia preenchida | Só `coiab:etnia` é gravada |
| Campo limpo antes de salvar | Normalização remove a chave; nada de `''` |
| Espaços internos ("Aldeia Nova") | Preservados; só as pontas são aparadas no save |
| Observação antiga sem tags | Sem seção de observador; edição mostra campos vazios |
| Membro removido/sem nome | Linha "Registrado por" omitida; etnia/aldeia permanecem |
| Troca de categoria no rascunho | `updatePreset` preserva tags que não vieram do preset (teste obrigatório) |
| Offline | Nada muda: tags seguem o fluxo normal de observação |
| Cliente CoMapeo genérico | Mostra a chave crua; o dado não se perde |

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

| Arquivo | Mudança |
|---|---|
| `src/frontend/lib/observerProfile.ts` (novo) | `OBSERVER_TAG_KEYS`, `observerTags(profile)`, `normalizeObserverTags(tags)`, `hasObserverTags(tags)` |
| `src/frontend/hooks/useNewObservationDraft.ts` (novo) | devolve callback: `createDraft(undefined, observerTags(profile))` |
| `src/frontend/contexts/PersistedStores/DraftObservationStore.ts` | `createDraft(observation?, initialTags?)` — tags iniciais no mesmo `setState` |
| `src/frontend/sharedComponents/ObserverFields.tsx` (novo) | dois inputs com rótulo permanente, a11y, testID |
| `src/frontend/sharedComponents/ObserverDetails.tsx` (novo) | apresentação pura (etnia/aldeia/autor) |
| `src/frontend/screens/ObservationCreate/index.tsx` | renderiza `ObserverFields` |
| `src/frontend/screens/ObservationEdit/index.tsx` | renderiza `ObserverFields` (sem autofill) |
| `src/frontend/screens/Observation/index.tsx` | seção + Suspense do autor |
| `src/frontend/screens/CameraScreen.tsx` | usa `useNewObservationDraft()` |
| `src/frontend/screens/MapScreen/index.tsx` | usa `useNewObservationDraft()` |
| `src/frontend/screens/ObservationCreate/ObservationCreateSaveButton.tsx` | normaliza tags no payload |
| `src/frontend/screens/ObservationEdit/ObservationEditSaveButton.tsx` | normaliza tags no payload |
| `messages/en-US/primary.json`, `messages/pt-BR/primary.json` | novas mensagens |

Sem mudança em: `assets/categorias/*`, `manifestos.generated.json`,
`pacotes*.ts`, `materializar.ts`, `entrada.ts`.

### Passos (TDD, RED antes de GREEN)

1. **RED** `observerProfile.test.ts`: chaves; trim de pontas; espaço interno
   preservado; vazio removido; perfil completo/parcial/vazio; demais tags
   intactas; `hasObserverTags`.
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
7. **RED** `ObserverFields.test.tsx`: digita caractere a caractere com espaço
   intermediário; limpar campo; valores iniciais; a11y/testID.
8. **GREEN** componente.
9. **RED** `ObservationCreateSaveButton.test.tsx` (arquivo já existe):
   payload com tags aparadas e **sem** chave vazia; CA1 e CA2 verificados aqui.
10. **GREEN** normalização nos dois botões.
11. **RED** `ObserverDetails.test.tsx` (como `FieldDetails.test.tsx`): só
    etnia; só aldeia; ambas; autor ausente; nenhum dado → nada.
12. **GREEN** `ObserverDetails` + seção na tela.
13. Mensagens: `extract-messages` → catálogos en-US/pt-BR → `build:translations`
    → `check:message-catalog`.
14. `npm run lint` (prettier + eslint + `tsc --noEmit`), `npm run test:jest`,
    `npm run test:scripts`.
15. **Verificação manual Android** (tela pequena, fonte ampliada): teclado não
    cobre o segundo campo, `ActionsRow` não bloqueia, salvar com teclado
    aberto normaliza. Se cobrir, aplicar `KeyboardAvoidingView` no mesmo
    padrão de `VillageEntry.tsx:91`.

## Critérios de aceite

- **CA1** Observação nova, perfil completo, nasce com `coiab:etnia` e
  `coiab:aldeia`; os dois valores estão **visíveis** na criação antes de
  salvar.
- **CA2** Payload salvo não contém `''` nem espaços nas pontas nas duas
  chaves (teste no save button).
- **CA3** Perfil parcial grava só o valor existente.
- **CA4** Mudar o perfil depois não altera observações salvas (garantido por
  construção: perfil só é lido no `createDraft` novo; teste do store cobre a
  edição).
- **CA5** Editar observação nunca injeta o perfil de quem edita; preencher
  manualmente é permitido.
- **CA6** A tela mostra etnia/aldeia e autor quando existem; **não** mostra
  seção vazia em observação antiga; autor sem nome é omitido sem esconder os
  demais dados.
- **CA7** `git diff --stat develop -- assets/categorias src/frontend/lib/organization`
  vazio; roteiro manual: organização criada antes do branch + observação
  conferida num segundo aparelho após sync.
- **CA8** `lint`, `test:jest`, `test:scripts` e `check:message-catalog`
  verdes.

## Riscos e dívidas

- **LGPD art. 5º, II:** origem étnica é dado sensível; herda o consentimento
  do onboarding, mas falta aviso específico antes de compartilhar.
- **Sem remoção real:** banco append-only com tombstone; corrigir não apaga
  cópias sincronizadas.
- **Cliente genérico** mostra a chave crua.
- **Dívida B:** quando o pacote canônico da #30 chegar, adicionar os campos
  com as mesmas chaves e rótulos nativos, sem migração.
- **Vocabulário livre:** o #132 já tem `AutocompleteField` com sugestões de
  etnia/aldeia; reusar é follow-up (o estilo do onboarding não é o do
  formulário).
- **Sem tela de edição de perfil:** follow-up, não bloqueio (D5).
