# Spec B — Criar nova organização

Data: 06/09/2026. Produto: COIAB. Repositório: `transistir/coiab-app`.
Base de código consultada: `c20ef05861909410eccaa0de65b76252d1eea045` (`develop`).
Escopo deste documento: comportamento e contrato técnico prontos para planejamento de implementação; não representa funcionalidade já implementada.

## 1. Objetivo e limites do contrato

Depois de nomear seu dispositivo, a pessoa chega à porta de entrada organizacional (`OrganizationSetup`, SPEC A §7) e escolhe **Criar organização** ou **Aguardar convite**. Ao confirmar um nome válido, o app cria localmente uma organização com as duas áreas **Monitoramento** e **Alertas**, cada uma com seu conjunto fixo de categorias. A confirmação de sucesso só aparece quando os dois projetos CoMapeo e suas categorias estão verificados.

A criação funciona **sem internet**, com os arquivos de categorias incluídos na instalação. Os dois projetos são materializados **durante a criação**, antes do primeiro acesso à organização. Não há cadastro em servidor, consulta de disponibilidade do nome ou configuração de Remote Archive nesse caminho.

Referências de produto consultadas: [#23 — escolha no onboarding](https://github.com/transistir/coiab-app/issues/23), [#26 — criação](https://github.com/transistir/coiab-app/issues/26), [#24 — modelo mínimo](https://github.com/transistir/coiab-app/issues/24), [#5 — dois projetos](https://github.com/transistir/coiab-app/issues/5), [#30 — templates e categorias](https://github.com/transistir/coiab-app/issues/30), [#31 — materialização e recuperação](https://github.com/transistir/coiab-app/issues/31) e [#29 — estados vazios](https://github.com/transistir/coiab-app/issues/29).

Contrato com o [SPEC A — Troca de organização](./spec-troca-organizacao.md), lido integralmente nesta árvore: organização é uma composição local, limitada a **uma por dispositivo no MVP**, com identidade própria e associação das duas **áreas** fixas a dois IDs públicos distintos do CoMapeo. Nome não é identidade. O diário de criação não é uma terceira entidade de negócio nem um novo backend: ele é o campo `materializacao` do mesmo documento versionado definido em SPEC A §4.2, reproduzido em §5.3 deste documento. O glossário compartilhado de §4.1 aqui é idêntico ao de SPEC A §4.4 e prevalece sobre qualquer variante de vocabulário anterior.

## 2. Base existente e reaproveitamento

Todos os caminhos desta seção existem e foram lidos. Componentes e estados novos são descritos por responsabilidade; seus nomes de arquivos serão definidos no planejamento.

| Base real | Comportamento encontrado | Decisão para COIAB |
| --- | --- | --- |
| `src/frontend/screens/Onboarding/DeviceNaming.tsx` | Salva o nome do dispositivo e reinicia o app; o navegador escolhe a próxima tela. | Reaproveitar literalmente a etapa de nomear dispositivo e sua persistência. |
| `src/frontend/screens/Onboarding/Success.tsx` | Exibe o dispositivo pronto e a escolha entre entrar em projeto e mapear por conta própria. `joinProject` é hoje o `PrimaryButton` (l. 62–78) e `mapOnYourOwn` o `SecondaryButton` (l. 79–95). | **Reutilizar a composição visual**, não o dono da decisão: a escolha criar/aguardar de #23 passa a ser o estado “sem organização” de `OrganizationSetup` (SPEC A §6.2/§7), e `Success` apenas encaminha para lá. Ações e descritores i18n são novos (§4). |
| `src/frontend/screens/ProjectCreation/StartNewProjectIntro.tsx` | Introdução com ícone, título, descrição e botão que abre `CreateProject`. | Reposicionar no onboarding e renomear o conteúdo para organização. Manter estrutura visual e botão de continuação. |
| `src/frontend/screens/ProjectCreation/JoinAProject.tsx` | Componente compartilhado pelas rotas `JoinAProject` e `JoinProjectIntro`, com orientação para pedir convite. | Reutilizar a apresentação, com vocabulário de organização, como destino de **Aguardar convite**. Protocolo de entrada pertence a outro spec. |
| `src/frontend/screens/ProjectCreation/CreateOrNameSoloProject/index.tsx` | Formulário de nome; ramo novo chama `useCreateProject`, ativa o projeto e vai para `ShareProjectStats`. Ramo solo renomeia o projeto ativo e dispara outro projeto sem nome. Ambos dependem de `useActiveProject()`. | Reutilizar a estrutura do formulário; substituir a operação por criação de organização. Retirar a dependência de projeto ativo desse caminho e não executar o ramo solo. |
| `src/frontend/screens/ProjectCreation/CreateOrNameSoloProject/ProjectCreated.tsx` | Confirmação com nome, ação de concluir e convite de dispositivo; recebe dados de estatísticas. | Reutilizar ícone e composição, com confirmação da organização e botão **Abrir organização**. Retirar convite e mensagem de estatísticas deste fluxo. |
| `src/frontend/screens/ProjectCreation/ShareProjectStats.tsx` | Escolha de compartilhar estatísticas do projeto ativo. | Não integrar à criação de organização. Os dois projetos nascem com `sendStats: false`; preferências gerais de diagnóstico não são alteradas. |
| `src/frontend/screens/Onboarding/MapOnYourOwnIntro.tsx` e `src/frontend/screens/ProjectCreation/NameDefaultProjectIntro.tsx` | Criam um projeto solo ou promovem observações existentes a projeto nomeado. | Não expor como alternativas neste onboarding; não criar um terceiro projeto solo nem importar observações existentes. |
| `src/frontend/screens/ProjectCreation/Collaborate.tsx` e `src/frontend/screens/AllProjects.tsx` | Oferecem nova colaboração/criação fora do onboarding e listagem genérica de projetos. | Aplicar a mesma restrição de uma organização: esconder a criação adicional; impedir acesso direto ao formulário quando já houver organização pronta ou operação pendente. `AllProjects` é renomeada para `Organizations` e passa a listar **organizações** (SPEC A D13); ela não lista os projetos internos, não vira seletor de áreas e fica oculta no MVP. |
| `src/frontend/sharedComponents/HookFormTextInput.tsx`, `src/frontend/sharedComponents/Buttons.tsx`, `src/frontend/sharedComponents/IconTitleDescription.tsx`, `src/frontend/sharedComponents/LoadingIndicator.tsx` e `src/frontend/sharedComponents/ScreenContentWithDock.tsx` | Campo controlado com validação/contador, botões e componentes de apresentação. | Reutilizar os componentes existentes sem duplicar suas implementações. Passar mensagens de validação explícitas no formulário. |

São novos: orquestração persistente da criação, reconciliação após interrupção, apresentação de progresso/erro recuperável e leitura do estado da organização pelo navegador. Apenas trocar textos e duplicar a mutação atual não atende a este spec.

### Pontos de integração obrigatórios

- `src/frontend/Navigation/Stack/OnboardingScreens.tsx` registra hoje as telas de onboarding; `src/frontend/Navigation/Stack/AppScreens.tsx` registra introdução, formulário e confirmação de projeto apenas no grupo do app. Disponibilizar a sequência de criação antes de existir projeto ativo.
- `src/frontend/Navigation/Stack/index.tsx` decide onboarding versus app a partir de nome do dispositivo e `activeProjectId`. Substituir esse critério de produto pelo estado persistido da organização. Manter autenticação e nomeação do dispositivo como pré-condições.
- `src/frontend/contexts/ActiveProjectIdStoreContext.tsx` escolhe hoje `listProjects()[0]` quando não há seleção salva. No COIAB, essa escolha não pode ativar um projeto parcial; somente uma associação verificada da organização pronta pode fornecer o projeto ativo.
- `src/frontend/contexts/ActiveProjectContext.tsx` exige projeto ativo. Formulário, progresso e recuperação devem funcionar fora desse contexto. Ele continua atendendo às telas internas de Monitoramento e Alertas.
- `src/frontend/App.tsx` e `src/frontend/contexts/AppProviders.tsx` são os pontos existentes de inicialização/injeção dos stores. Carregar o estado local de organização e reconciliar a criação antes de liberar as telas de coleta.
- `src/frontend/sharedTypes/navigation.ts` contém os tipos das rotas citadas. Reposicionar os registros e ajustar parâmetros e tipos junto com os componentes. Os identificadores internos atuais podem permanecer nesta entrega; títulos visíveis não dependem de renomear arquivos ou rotas.

## 3. Fluxo completo

### 3.1 Entrada e telas

Ordem funcional: **introdução do app → privacidade → nome do dispositivo → escolha → introdução da organização → nome da organização → preparação → confirmação → organização aberta em `Home/Map`, com as áreas vazias**. Da escolha até a confirmação, tudo acontece como estados de `OrganizationSetup`; nenhum desses estados vira rota nova (SPEC A D13). Reaproveitar a sequência inicial de `src/frontend/screens/Onboarding/IntroToCoMapeo.tsx` e `src/frontend/screens/Onboarding/DataPrivacy.tsx`; a consulta opcional à política de privacidade permanece no grupo de onboarding existente.

| Etapa | Conteúdo e ações | Navegação e efeitos |
| --- | --- | --- |
| Escolha, após o retorno da nomeação do dispositivo | Estado “sem organização” de `OrganizationSetup`, reaproveitando a composição de `Success.tsx`. Manter “{deviceName} está pronto!”. Orientação: “Crie uma organização ou aguarde um convite para participar de uma existente.” Botão principal **Criar organização**; secundário **Aguardar convite**. | `Success` encaminha para `OrganizationSetup` e não decide nada. Criar abre a introdução. Aguardar abre a tela de orientação. Nenhuma das ações cria projetos. A hierarquia principal/secundário é a desta linha, não a dos botões atuais de `Success.tsx` (ver §4). |
| Introdução | Título **Criar organização**. Texto: “Sua organização terá Monitoramento e Alertas, com categorias prontas para usar. Você pode criá-la sem internet.” Botão **Continuar**. | Abre o formulário; voltar retorna à escolha, sem efeitos no CoMapeo. |
| Nome | Título **Criar organização**; campo **Nome da organização**, contador e botão **Criar organização**. Orientações: “Escolha um nome para sua organização.” e “Usar o mesmo nome de outra organização não conecta os dispositivos. Para participar de uma organização existente, aguarde um convite.” | Validar e persistir a intenção antes da primeira criação. Voltar antes da confirmação não cria nada. Preservar o texto ao voltar da tela e retornar na mesma sessão; não há rascunho durável obrigatório antes de confirmar. |
| Preparação | **Preparando sua organização…**; linhas Monitoramento e Alertas, cada uma com **Aguardando**, **Preparando**, **Pronto** ou **Não concluído**. Indicador de atividade e texto acessível da etapa. | Fechar o teclado ao iniciar. Travar nome e novas submissões. “Pronto” em uma linha exige projeto e categorias verificados. Não mostrar IDs, nomes de chamadas ou arquivos ao usuário. |
| Falha recuperável | **Não foi possível concluir a criação.** Complemento: “O que já foi preparado está salvo. Tente novamente para concluir.” Botão **Tentar novamente**. Erros de espaço podem orientar a liberar armazenamento. | Retomar a mesma operação, preservando nome e IDs. Não voltar a um formulário vazio nem liberar organização incompleta. |
| Confirmação | **Organização criada**; “{organizationName} está pronta. Monitoramento e Alertas já estão disponíveis.” Exibir as duas áreas e botão **Abrir organização**. | Somente após a conclusão persistida (`estado: 'pronta'`, `confirmacaoPendente: true`) e a verificação dos dois projetos. **Abrir organização** grava `confirmacaoPendente: false` e `ativa = {organizacaoId, area: 'monitoramento'}` na mesma escrita e abre `Home`, aba `Map`, em Monitoramento (SPEC A §4.2 regra 9 e D7). Não encaminhar a `ShareProjectStats` ou `SelectDevice`. |

**Aguardar convite:** título **Aguardar convite** e orientação “Peça a uma pessoa responsável pela organização para convidar este dispositivo.” Voltar retorna à escolha. Ao reiniciar sem organização e sem operação de criação, retornar à escolha; não é necessário persistir essa navegação de espera. Recepção, aceite e conclusão de entrada serão especificados separadamente.

### 3.2 Voltar, fechar e retomar

Antes de confirmar, voltar é permitido. Durante uma chamada de criação/importação, bloquear a saída pelo cabeçalho, gesto e botão Voltar do Android; minimizar ou encerrar o processo continua possível. Após uma falha, manter a tela de recuperação e permitir sair do app pelo sistema; não oferecer descarte destrutivo da operação no MVP.

Em cada abertura com operação incompleta, mostrar a preparação. A retomada automática (uma única tentativa de reconciliação/conclusão) é autorizada **apenas** quando `estado: 'preparando'` — processo recém-iniciado não tem operação em voo, e a chamada pode ter encerrado sem gravar o resultado. Quando `estado: 'falha_recuperavel'` (falha já persistida), NÃO executar nova tentativa: aguardar **Tentar novamente**, sem loop de retentativas. Uma chamada ainda em andamento não pode ser duplicada por toque, remount ou retorno do segundo plano.

Após 30 segundos sem conclusão de uma chamada, mostrar “A preparação está demorando. Se não continuar, feche e abra o aplicativo.” O tempo não autoriza disparar outra chamada: timeout de apresentação não cancela uma operação nativa. Se o resultado permanecer desconhecido, retomar apenas depois de a chamada encerrar ou de reiniciar o processo que executa o Core, seguido de reconciliação.

### 3.3 Critério de navegação

Depois da autenticação e da nomeação do dispositivo, resolver nesta ordem:

1. Documento `CoiabOrganizations` ainda não reidratado: carregamento, sem mapa nem escolha transitória.
2. `estado: 'preparando'` ou `'falha_recuperavel'`: preparação/recuperação em `OrganizationSetup`, mesmo se `listProjects()` retornar um projeto e mesmo se houver `activeProjectId` antigo. Em processo recém-iniciado, `preparando` autoriza uma única retomada automática; seu fracasso grava `falha_recuperavel`, que aguarda **Tentar novamente** (SPEC A §4.2, regra 7).
3. `estado: 'pronta'` com `confirmacaoPendente: true`: confirmação de criação, ainda em `OrganizationSetup`.
4. `estado: 'pronta'` com `confirmacaoPendente: false` e `ativa` válida: `Home` com a área ativa, cabeçalho com o nome da organização e os dois acessos de área no menu.
5. Nenhum registro em `organizacoes`: estado “sem organização” de `OrganizationSetup`, com a escolha criar/aguardar.

A confirmação pendente é persistida junto da conclusão. Ao tocar **Abrir organização**, gravar reconhecimento e seleção ativa na mesma escrita e substituir a pilha pelo destino final `Home/Map`. Fechar o app entre concluir e tocar no botão reapresenta a confirmação, sem recriar projetos. Não confiar só em `initialRouteName`, em `popToTop()` ou no refetch da lista de projetos: a composição das rotas deve preservar progresso e confirmação durante a troca de estado.

## 4. Vocabulário e tradução

O mecanismo confirmado é `react-intl`: `defineMessages`, `useIntl().formatMessage` e, para interpolação rica, `FormattedMessage`. O provider está em `src/frontend/contexts/IntlContext.tsx`; resolução de idioma em `src/frontend/lib/intl.ts`. As fontes pt-BR são `messages/pt-BR/primary.json` e `messages/pt-BR/secondary.json`, com entradas no formato `{"message": "…"}`. A base de extração em inglês é produzida por `scripts/extract-messages.mjs`: IDs com prefixo `$1` vão para o catálogo primário; os demais, para o secundário. `scripts/build-translations.mjs` compila os catálogos para artefatos gerados, usando `pt` como chave de carregamento de pt-BR.

Renomear o **conceito de criação/participação** na UI para organização. Monitoramento e Alertas continuam sendo dois projetos CoMapeo e são apresentados pelos seus nomes próprios. Não substituir globalmente `projectId`, contratos do Core ou qualquer ocorrência técnica de “projeto”. Na UI, **Alertas** identifica a área de registros da organização, sem promessa de notificações push ou detecções remotas.

| Mensagem atual verificada | Texto pt-BR de destino |
| --- | --- |
| `$1screens.DeviceNaming.Success.chooseProject` — conteúdo de referência; usar descritor novo | Crie uma organização ou aguarde um convite para participar de uma existente. |
| `$1screens.DeviceNaming.Success.mapOnYourOwn` — conteúdo de referência; usar descritor novo | Criar organização (ação **principal**) |
| `$1screens.DeviceNaming.Success.joinProject` — conteúdo de referência; usar descritor novo | Aguardar convite (ação **secundária**) |
| `$1screens.Settings.StartNewProjectIntro.title` e `$1screens.Settings.CreateOrJoinProject.CreateProject.title` | Criar organização |
| `$1screens.Settings.CreateOrJoinProject.enterName` | Nome da organização |
| `$1screens.Settings.CreateOrJoinProject.createProjectButton` | Criar organização |
| `$1screens.Settings.JoinAProject.title` | Aguardar convite |
| `screens.Settings.CreateOrJoinProject.ProjectCreated.projectReady` | {organizationName} está pronta. Monitoramento e Alertas já estão disponíveis. |

As três primeiras linhas exigem descritores novos, e não apenas por mudança de significado: reaproveitá-las inverteria a hierarquia de §3.1. Em `src/frontend/screens/Onboarding/Success.tsx`, `joinProject` é o `PrimaryButton` (l. 62–78) e `mapOnYourOwn` é o `SecondaryButton` (l. 79–95); o COIAB precisa de **Criar organização** como ação principal e **Aguardar convite** como secundária. Como a escolha também muda de dono — sai de `Success` e vira o estado “sem organização” de `OrganizationSetup` —, criar descritores próprios sob o novo namespace e deixar os IDs de `Success` intocados. `deviceReady` (“{deviceName} está pronto!”) mantém significado idêntico e pode ser reutilizado.

Essa tabela é um mapeamento de origem para conteúdo, não uma ordem para reaproveitar traduções semanticamente diferentes sob o mesmo ID. Criar descritores próprios de organização para textos cujo significado muda, incluindo espera, erros, acessibilidade e estados vazios; usar interpolação com `organizationName` e `deviceName`. Atualizar os `defaultMessage` em inglês para o mesmo conceito e fornecer pt-BR completo, evitando que o fallback volte a pedir criação de projeto. Componentes genéricos e mensagens de significado idêntico podem manter seus IDs.

No planejamento da implementação, incluir extração e compilação pelos scripts existentes, revisão das duas fontes pt-BR e varredura das telas acessíveis neste fluxo. Artefatos compilados não são fonte para edição manual. A elaboração deste spec não executa esses scripts, pois escreveriam fora do diretório autorizado.

### 4.1 Glossário compartilhado (idêntico ao SPEC A §4.4)

Termo de produto, campo correspondente no modelo e string única por estado. Estes são os termos válidos nos dois documentos e na UI; variantes anteriores (“espaço”, “tipo estável”, “Nenhum registro em…”, “Entrar por convite”, “Estamos preparando sua organização”) ficam revogadas.

| Termo de produto (UI e specs) | Campo/valor no modelo (§5.3) | String canônica pt-BR |
| --- | --- | --- |
| **Organização** | `OrganizacaoLocal`, `organizacoes[]`, `nome` | o nome cadastrado, sem sufixo |
| **Área** — nunca “espaço” nem “tipo” | `Area = 'monitoramento' \| 'alertas'`, `ativa.area` | **Monitoramento**, **Alertas** |
| Projeto CoMapeo | `materializacao[area].projectId` | termo técnico interno; não aparece na UI COIAB |
| Sem organização | nenhum registro em `organizacoes` | “Seu dispositivo ainda não está em uma organização”; ações **Criar organização** e **Aguardar convite** |
| Espera por convite | nenhum registro em `organizacoes` | título **Aguardar convite**; “Peça a uma pessoa responsável pela organização para convidar este dispositivo.” |
| Preparação em andamento | `estado: 'preparando'` | “Preparando sua organização…”; uma linha por área com **Aguardando**, **Preparando**, **Pronto** ou **Não concluído** |
| Falha recuperável | `estado: 'falha_recuperavel'` | “Não foi possível concluir a criação.” + “O que já foi preparado está salvo. Tente novamente para concluir.”; botão **Tentar novamente** |
| Confirmação de criação | `estado: 'pronta'` + `confirmacaoPendente: true` | “Organização criada”; “{organizationName} está pronta. Monitoramento e Alertas já estão disponíveis.”; botão **Abrir organização** |
| Área sem registros | `estado: 'pronta'` + `confirmacaoPendente: false` | “Ainda não há registros em Monitoramento” / “Ainda não há registros em Alertas”; ação **Ir para o mapa** |
| Organização indisponível | resultado de revalidação; sem valor persistido (SPEC A §4.2, regra 8) | “Não foi possível abrir sua organização”; botão **Tentar novamente** |
| Troca bloqueada por trabalho pendente | — | “Conclua ou descarte o registro antes de trocar de organização” |

## 5. Criação técnica e persistência

### 5.1 APIs efetivamente disponíveis

`package.json` fixa `@comapeo/core-react` 12.0.3, `@comapeo/core-react-native` 1.0.0-pre.12, `@comapeo/core` 7.4.0 e `@comapeo/ipc` 9.0.1. A leitura de `node_modules/@comapeo/core-react-native/src/version.ts` confirma Core 7.4.0 no bundle nativo. As referências em `node_modules` abaixo são evidências das dependências instaladas, não novos arquivos do produto nem destinos de edição.

- `node_modules/@comapeo/core-react/dist/esm/hooks/projects.js`: `useCreateProject()` delega a `clientApi.createProject(...)` e invalida a lista de projetos no sucesso. O cliente também é obtido com `useClientApi()`, já usado em `src/frontend/contexts/ActiveProjectIdStoreContext.tsx`.
- `node_modules/@comapeo/ipc/dist/client.d.ts`: o cliente oferece as operações do manager e `getProject(projectPublicId)` retornando o cliente de projeto.
- `node_modules/@comapeo/core/src/mapeo-manager.js`: `createProject({name, configPath, projectColor, projectDescription})` retorna um **ID público**. Gera chaves novas a cada chamada, salva-as localmente, inicializa configurações e dispositivo e só então retorna. `listProjects()` usa a tabela de chaves como fonte e pode listar um projeto ainda sem configurações completas. Não há parâmetro de organização, chave de idempotência ou transação de dois projetos nessa assinatura.
- `node_modules/@comapeo/core/src/mapeo-project.js`: `$importCategories({filePath})` propaga falha; `$getProjectSettings()` e `$setProjectSettings(...)` permitem conferir/reparar configurações. O método legado `importConfig({configPath})` captura erros e os retorna como uma lista; `createProject()` não expõe essa lista ao chamador.
- `node_modules/@comapeo/core/src/member-api.js`: `$member.getById(deviceId)` exige informações do próprio dispositivo no projeto. O manager oferece `getDeviceInfo()` e `setDeviceInfo(...)`; este último reaplica as informações aos projetos locais. Reabrir um projeto com `getProject()` não repete automaticamente a gravação do dispositivo interrompida na criação.
- `node_modules/@comapeo/core/src/import-categories.js`: a importação grava presets, campos, ícones, traduções, `defaultPresets` e `configMetadata`, e remove presets/campos antigos ao final. Ela não é uma transação indivisível. `node_modules/@comapeo/core/src/datatype/index.js` disponibiliza `getMany()` excluindo documentos apagados por padrão.

**Decisão:** um orquestrador do frontend usa o cliente existente e chamadas sequenciais aguardadas. Criar cada projeto com `configPath: ''`, que na versão lida desabilita a importação implícita, e depois chamar explicitamente `$importCategories({filePath})`. Passar `''` explicitamente é obrigatório: **omitir** `configPath` não equivale a `''`, porque o parâmetro tem default `this.#defaultConfigPath` (`node_modules/@comapeo/core/src/mapeo-manager.js:468`) e a importação implícita voltaria. Isso permite observar o erro e preservar o ID antes de importar. Não usar o retorno de `createProject({configPath: arquivo})` como evidência suficiente de categorias prontas. Não acrescentar APIs fictícias como `createOrganization()` ao Core.

### 5.2 Templates locais

A lista final de categorias pertence a #30, que ainda não as enumera no corpo consultado. Este spec não inventa categorias. O insumo obrigatório da implementação são **dois pacotes canônicos aprovados**, um por área, com categorias, campos, ícones, traduções, seleção padrão e identificação de versão. Fixar a versão e o hash de cada pacote na distribuição e registrar a versão escolhida na operação.

Os pacotes devem estar incluídos no app instalado e ser disponibilizados como caminhos de arquivo locais legíveis pelo processo nativo do Core, sem download no primeiro uso. Uma URI de recurso não é, por si só, esse caminho. Conferir existência, integridade e disponibilidade de ambos antes de criar o primeiro projeto. Não há nomes de arquivo de templates COIAB verificados nesta base; os caminhos concretos serão definidos com a entrega de #30.

Cada organização da mesma versão usa os mesmos dois templates. O nome salvo nos projetos será **Monitoramento** e **Alertas**, sem concatenação com o nome da organização. A associação de área a ID vive no registro local (`materializacao[area].projectId`), não depende desses nomes. O usuário não seleciona, importa, edita ou renomeia os templates/projetos fixos neste fluxo nem recebe controles para fazê-lo depois.

### 5.3 Registro e diário da operação

Seguir o padrão de store persistido com Zustand e MMKV encontrado em `src/frontend/contexts/ActiveProjectIdStoreContext.tsx`, reutilizando o adaptador `MMKVStoreInitializer` de `src/frontend/hooks/persistedState/createPersistedState.ts`. Não usar o helper antigo `createPersistedState`, marcado como obsoleto, para uma nova store.

O contrato é o documento único definido em SPEC A §4.2, na chave **`CoiabOrganizations`**, reproduzido aqui por ser o alvo de escrita desta sequência. Não há chave, store ou entidade separada para o diário: `materializacao` é campo do mesmo documento.

```ts
// Modelo proposto; idêntico ao do SPEC A §4.2. Não representa exports existentes.
// Chave MMKV proposta: 'CoiabOrganizations'. Documento único, versionado, escrito atomicamente.
type Area = 'monitoramento' | 'alertas';

type TemplateRef = {
  versao: string; // identificação de versão do pacote canônico da área
  hash: string; // hash do pacote fixado na distribuição
};

// Diário/journal de materialização da #31: campo do documento, um registro por área.
type EtapaArea = {
  etapa: 'ausente' | 'criando' | 'criado' | 'importando' | 'verificado';
  projectId: string | null; // ID público do core, gravado antes de qualquer importação
  template: TemplateRef | null; // fixado na primeira tentativa desta área
  idsAntesDaCriacao: string[] | null; // listProjects() gravado imediatamente antes de createProject
};

type OrganizacaoLocal = {
  id: string; // identificador opaco, estável, gerado localmente
  nome: string; // obrigatório, sem espaços nas extremidades
  estado: 'preparando' | 'falha_recuperavel' | 'pronta';
  confirmacaoPendente: boolean; // true ao publicar 'pronta'; false após “Abrir organização”
  materializacao: {
    monitoramento: EtapaArea;
    alertas: EtapaArea;
  };
  areaEmExecucao: Area | null; // área da etapa em curso; null quando nenhuma etapa está iniciada
  ultimoErro: null | {codigo: string; area: Area | null; ocorridoEm: string}; // sem o nome da organização
};

type EstadoOrganizacoes = {
  versao: 1;
  organizacoes: OrganizacaoLocal[];
  ativa: null | {
    organizacaoId: string;
    area: Area;
  };
};
```

Correspondência com o que esta sequência precisa persistir:

| Campo | Finalidade nesta operação |
| --- | --- |
| `versao`, `id`, `nome` | Reconhecer a mesma organização durante todo o processo; formato migrável entre versões do app. |
| `estado` | Impedir que uma composição incompleta seja tratada como organização utilizável e distinguir “em andamento” de “falhou” após encerramento do processo. Ausência de registro representa nenhuma criação iniciada. |
| `materializacao[area].projectId` | Guardar os IDs públicos por área, inicialmente `null`; ambos obrigatórios, distintos e `verificado` no estado pronto. |
| `materializacao[area].template` e `.etapa` | Retomar com o mesmo conteúdo após fechamento ou atualização do app. |
| `areaEmExecucao` e `materializacao[area].idsAntesDaCriacao` | Reconciliar a janela em que o Core criou um projeto, mas o app ainda não salvou seu ID. |
| `ultimoErro` e `confirmacaoPendente` | Exibir recuperação acionável e reapresentar sucesso após reinício. Não guardar nome da organização em `ultimoErro`. |
| `ativa` | Projeção da seleção operacional; escrita junto com o reconhecimento da confirmação. |

Gravar esse documento sob a única chave de persistência versionada, incluindo a conclusão e a confirmação pendente na mesma atualização. O estado pronto é o ponto de publicação local. Não pressupor transação entre MMKV e o armazenamento do Core, nem entre esse documento e a chave de projeto ativo. Se uma gravação necessária falhar, interromper o avanço; estado apenas em memória não autoriza sucesso.

O `activeProjectId` é uma projeção recuperável: após a confirmação, selecionar Monitoramento para o primeiro uso. Não existe seleção ativa pendente entre a publicação de `pronta` e o toque em **Abrir organização**: nesse intervalo `ativa` permanece `null`, reabrir o app apenas reapresenta a confirmação (SPEC A §4.2, regra 9), e `ativa` só nasce na escrita única do toque. A existência de uma seleção antiga não comprova a existência da organização.

### 5.4 Sequência normativa

1. Sob um bloqueio único de criação no app, validar nome, nomeação do dispositivo e inexistência de organização pronta. Se houver operação anterior, entrar na recuperação dela. Checar os dois arquivos de templates locais.
2. Gerar a identidade local e persistir o registro em preparação, com nome e versões dos templates. Nenhum projeto é criado antes dessa gravação.
3. Para **Monitoramento**, ler `clientApi.listProjects()` e persistir o conjunto de IDs em `materializacao.monitoramento.idsAntesDaCriacao` e a intenção de criar essa área (`areaEmExecucao`, `etapa: 'criando'`). Aguardar `clientApi.createProject({name: 'Monitoramento', configPath: ''})`. Persistir imediatamente o ID retornado, antes de qualquer importação.
4. Obter `projectApi = await clientApi.getProject(id)`. Aguardar `projectApi.$importCategories({filePath: caminhoLocalDoTemplate})`. Ler `projectApi.$getProjectSettings()`, `projectApi.preset.getMany()` e `projectApi.field.getMany()`; verificar o resultado contra o template. Somente então persistir Monitoramento como verificado.
5. Repetir os passos 3–4 para **Alertas**, com seu arquivo próprio. No caminho sem falhas são exatamente **duas** chamadas de criação e **duas** importações explícitas. Não disparar as duas criações em paralelo.
6. Conferir novamente que os IDs são distintos, pertencem às duas áreas esperadas e podem ser abertos; ambos devem ter categorias verificadas, configurações corretas e o próprio dispositivo inicializado conforme descrito abaixo. Persistir a organização pronta, com confirmação pendente. Nenhuma etapa de coleta, convite ou sincronização é pré-condição para concluir.
7. Invalidar/atualizar as consultas de projetos, configurações e categorias afetadas, pois chamadas diretas do cliente não executam automaticamente os callbacks dos hooks. Preparar (em memória, sem persistir) a seleção de Monitoramento que o toque em **Abrir organização** gravará, exibir a confirmação e respeitar a ordem de navegação da seção 3.3.

`caminhoLocalDoTemplate` é uma variável descritiva dessa sequência, não uma API ou um arquivo que já exista.

**Inicialização do dispositivo após interrupção:** ler `clientApi.getDeviceInfo()` e conferir, em cada projeto, `projectApi.$member.getById(deviceId)`, incluindo nome, tipo e papel de criador. Se a gravação do próprio dispositivo ficou incompleta, reaplicar `clientApi.setDeviceInfo({name, deviceType})` com os valores atuais salvos, sem pedir nova nomeação, e verificar novamente. Essa operação também atualiza as cópias das informações do dispositivo nos demais projetos locais, sem alterar seus nomes, categorias ou registros de coleta. O manager tenta avisar peers conectados depois da gravação local; falha apenas nessa divulgação não bloqueia a conclusão quando as leituras locais comprovam a inicialização. Erro de gravação local mantém a recuperação pendente.

**Verificação das categorias:** comparar conteúdo canônico, referências válidas de campos/ícones, seleção em `defaultPresets` e metadados esperados; não comparar apenas quantidade, rótulos traduzidos ou IDs gerados na importação. Uma importação interrompida pode deixar extras ativos: o conjunto ativo final também deve corresponder ao template. Leituras de configuração que retornem fallback vazio não contam como sucesso. A tela existente `src/frontend/screens/PresetChooser/ObservationCategoryChooser.tsx` usa `usePresetsSelection`, enquanto `src/frontend/hooks/server/presets.ts` lê presets por projeto; os dois caminhos devem refletir o template da área selecionada.

### 5.5 Falha parcial e reconciliação sem duplicação

O bloqueio cobre **todas** as entradas capazes de criar/adicionar projeto enquanto a operação existir: formulário, caminhos legados e aceite de convites. `src/frontend/sharedComponents/PendingInvitesListener.tsx` pode abrir um convite em várias telas, e `src/frontend/screens/Invites/InviteReceived.tsx` pode criar um projeto solo adicional após aceitar. Suspender esse encaminhamento/aceite durante a preparação e a recuperação, inclusive após reinício. Não rejeitar convites automaticamente. O spec de entrada deve respeitar esse mesmo bloqueio.

Reconciliar pelo diário e por leituras novas de `listProjects()`, não pela lista em cache e não pelo nome:

| Situação encontrada | Recuperação obrigatória |
| --- | --- |
| Falha antes de qualquer chamada de criação | Preservar a operação; repetir pré-condições e continuar. Se a intenção nem chegou a ser persistida, manter o formulário com erro e o nome digitado. |
| Um ID já persistido; importação não confirmada | Abrir esse mesmo projeto, reparar nome e `sendStats: false` com `$setProjectSettings(...)` se necessário, verificar categorias e importar novamente apenas se incompletas/incorretas. Não criar substituto. |
| Monitoramento pronto e criação de Alertas falha | Manter Monitoramento e sua verificação; reconciliar Alertas, criar somente se ele ainda não existir e concluir suas categorias. A organização permanece indisponível para coleta até 2/2. |
| Core gravou projeto, mas a resposta ou a gravação do ID foi perdida | Comparar IDs atuais com o conjunto persistido antes da chamada. Com exatamente um ID novo, associá-lo à etapa pendente, mesmo sem nome/configurações completas; salvar o ID e reparar/concluir esse projeto. |
| Etapa pendente sem ID novo | Após comprovar que a chamada anterior terminou ou que o processo anterior encerrou, repetir a criação daquela área. Se `listProjects()` falhar, não interpretar como lista vazia e não criar. |
| Mais de um ID novo para uma única etapa | Violação do bloqueio/integridade: manter diário e mostrar falha com orientação de suporte. Não adivinhar por nome, criar mais projetos ou apagar projetos alheios. Essa situação não pode ocorrer nos cenários normais de interrupção cobertos pelo MVP e deve falhar nos testes de exclusão mútua. |
| Dois projetos existentes; importação ou publicação local interrompida | Conferir cada etapa contra o template, corrigir somente o que falta e publicar o mesmo registro pronto. Falha ao salvar a conclusão nunca exige recriar projetos. |
| Organização pronta encontrada ao tentar criar novamente | Abrir a confirmação pendente ou a organização existente. Não criar, sobrescrever ou renomear nada. |

A reimportação explícita substitui presets/campos ativos, mas pode gerar novos IDs e histórico; portanto só é permitida automaticamente **antes da publicação**, sem observações, convites aceitos ou compartilhamento desses projetos. Não reimportar um projeto já verificado a cada retry. Se a importação terminou mas o checkpoint se perdeu, verificar primeiro; conteúdo completo evita trabalho adicional. Um checkpoint de importação anterior não dispensa verificação quando houver evidência de interrupção ou inconsistência.

Projetos que existiam antes da operação não são incorporados, renomeados ou apagados automaticamente. A restrição é uma organização composta de dois projetos associados; numa instalação limpa, o total também será dois. Migração de dados legados pertence ao spec A, e não pode ser inferida pela coincidência dos nomes Monitoramento/Alertas.

Não há rollback destrutivo automático. O caminho de recuperação é concluir a mesma operação. Erros persistentes de arquivo ou armazenamento continuam acionáveis após corrigir a causa; não exigem reinstalar o app, apagar Monitoramento ou nomear a organização outra vez.

## 6. Validações e casos de borda

| Caso | Regra testável |
| --- | --- |
| Nome vazio ou só espaços | Rejeitar antes de persistir intenção/criar projetos. Mensagem **Informe o nome da organização.** O `HookFormTextInput` existente já valida `trim()` quando o campo é obrigatório; fornecer a mensagem traduzida. |
| Limite do nome | Manter o limite atual do campo: 60 unidades de comprimento de string JavaScript, incluindo espaços digitados, coerente com o contador existente. Campo de uma linha; rejeitar quebras de linha/caracteres de controle colados. Com mais de 60, mostrar **Use no máximo 60 caracteres.** Não truncar silenciosamente. |
| Nome salvo | Aplicar `trim()` nas bordas; exigir ao menos um caractere restante. Preservar acentos, maiúsculas e espaços internos. Não restringir a caracteres ASCII nem exigir unicidade global. O nome normalizado é congelado após confirmar. |
| Nome igual ao de outra organização | Permitido em outro dispositivo; não estabelece relação, permissão ou sincronização. Não fazer consulta de rede para validar. |
| Toques repetidos, remontagem ou callback tardio | Um orquestrador e uma operação durável; nenhuma etapa roda simultaneamente duas vezes. Callback deve pertencer à operação atual antes de alterar seu estado. |
| Organização ou operação já existente | Guarda no entry point e no comando, além da UI. Pronta leva à existente; pendente leva à recuperação. Não admitir segunda organização no MVP. |
| Sem internet, Wi-Fi, Bluetooth ou GPS | Criar e recuperar normalmente com os assets instalados. Permissões de coleta/descoberta não são pré-condição da criação; falhas de mapa de fundo, telemetria e Remote Archive não bloqueiam. |
| Pacote ausente/inválido ou armazenamento insuficiente | Falhar com orientação e retry. Checagem dos dois pacotes ocorre antes do primeiro projeto; falha tardia usa o diário. Nunca recorrer silenciosamente às categorias padrão do CoMapeo. |
| App encerrado em qualquer etapa | Recuperar nome, área em execução (`areaEmExecucao`), IDs e templates escolhidos. Não voltar ao onboarding inicial nem abrir apenas o primeiro projeto. |
| Atualização do app com criação pendente | Migrar formato do diário sem descartar IDs e conservar os templates da versão pendente até conclusão. Não misturar versões dos dois pacotes durante um retry. |
| Dados legados ou registro inválido | Não tratar um projeto solto como organização. Preservar dados e encaminhar inconsistência ao tratamento de modelo/migração; nunca corrigir apagando dados sem um fluxo específico. |

## 7. Depois da criação: organização sem dados

A confirmação já mostra **Monitoramento** e **Alertas**. Ao tocar **Abrir organização**, a mesma escrita que reconhece a confirmação ativa Monitoramento e abre `Home`, aba `Map` (SPEC A §4.2 regra 9 e D7). **Não** existe superfície inicial de organização adicional: a evidência de que a organização tem duas áreas acessíveis é o nome da organização no cabeçalho de `Home` (`src/frontend/sharedComponents/HomeHeader.tsx`) somado aos dois acessos fixos **Monitoramento** e **Alertas** no `src/frontend/sharedComponents/DrawerMenu.tsx`, com a área atual marcada (SPEC A §6.1/D12). Essa decisão substitui o requisito anterior de uma tela nova com contadores e mantém D13 do SPEC A (estados intermediários não viram rotas): #29 é atendida pelos estados vazios por área descritos abaixo, que também comprovam zero registros.

Não criar observações, trilhas, alertas de exemplo ou notificações para preencher a tela. Categorias e informações do próprio dispositivo são configuração, não registros de coleta. A organização existe e está pronta mesmo com zero registros.

O primeiro contexto interno é Monitoramento; a pessoa pode abrir Alertas imediatamente, sem nova criação/importação. `src/frontend/Navigation/Tab/index.tsx` oferece hoje mapa, lista e câmera dentro de um projeto ativo; reutilizar essas superfícies internas. Reaproveitar a composição de `src/frontend/screens/ObservationsList/ObservationsEmptyView.tsx` para orientar o primeiro registro, contextualizando a área: **Ainda não há registros em Monitoramento** ou **Ainda não há registros em Alertas**, com ação **Ir para o mapa**. O mapa pode operar com recursos locais disponíveis; ausência de mapa baixado não converte a criação em erro.

A alternância **Monitoramento ↔ Alertas** usa exclusivamente os dois acessos fixos do `DrawerMenu`. O seletor renomeado `Organizations` (ex-`src/frontend/screens/AllProjects.tsx`) lista **organizações**, fica oculto no MVP e **não** vira seletor de áreas nem recebe os dois IDs da organização; ele também não oferece botão para nova colaboração/criação. Guardas também devem impedir alterar nomes fixos, importar categorias manualmente ou criar um projeto adicional por uma rota antiga. O desenho geral da navegação e a experiência de convite pós-criação são entregas próprias; este spec fixa a transição, os dados e os estados vazios necessários para fechar a criação.

## 8. Não objetivos

- Protocolo de convite, aceite, entrada e associação dos dois projetos de uma organização existente, incluindo sua recuperação parcial.
- Mais de uma organização no dispositivo, troca entre organizações, saída, exclusão, renomeação posterior e migração de projetos legados.
- Criar backend ou conta de organização, sincronizar o registro local entre dispositivos, configurar Remote Archive ou impor conectividade.
- Escolher as categorias de #30, criar/editar categorias pelo usuário, projetos adicionais ou atualização de templates de organizações já em uso.
- Notificações push, detecções remotas, permissões organizacionais novas, campanhas de estatísticas e revisão completa do design do app.

## 9. Critérios de aceite e evidências

| ID | Cenário / resultado exigido |
| --- | --- |
| CA1 | Instalação limpa: depois de salvar o nome do dispositivo e retornar do reinício existente, aparecem **Criar organização** e **Aguardar convite**. Entrar/voltar dessas opções não cria projeto. |
| CA2 | Percorrer introdução, nome, preparação, confirmação e abertura usando somente organização como conceito de criação. Não aparecem “Mapeie por Sua Conta”, criação de projeto solo, compartilhamento de estatísticas ou convite obrigatório. |
| CA3 | Nome vazio/só espaços e nome com 61 unidades são rejeitados sem chamadas ao Core; nomes válidos de 1 e 60 unidades e nomes com acentos são aceitos. Espaços nas bordas são removidos ao salvar. Erros e contador são visíveis/acessíveis. |
| CA4 | Criação normal em modo avião: exatamente dois novos IDs distintos, nomes Monitoramento/Alertas, sem terceiro projeto; registro local pronto associa corretamente as duas áreas. Não depende de internet, GPS, descoberta ou servidor de métricas. |
| CA5 | Ambos os projetos contêm somente o conjunto ativo de categorias/campos do template correspondente, ícones/referências e seleções válidas. Arquivo errado, ausente ou importação incompleta não produz sucesso, mesmo se `createProject()` tiver resolvido. |
| CA6 | **Falha parcial de #31:** injetar falha ao criar Alertas após Monitoramento estar pronto. O app mostra recuperação, mantém o ID de Monitoramento e não libera coleta. Remover a falha e tocar **Tentar novamente** conclui 2/2, sem recriar Monitoramento, com o mesmo nome e registro local. |
| CA7 | Encerrar o app durante a criação do segundo projeto (estado `preparando`, 1/2); reabrir sem rede. A retomada automática única conclui o segundo projeto ou grava `falha_recuperavel` e mostra retry acionável. Separadamente: encerrar após `falha_recuperavel` persistido e reabrir — nenhuma tentativa automática ocorre; a tela de recuperação aguarda **Tentar novamente**. Nunca abre um mapa isolado por fallback de `listProjects()[0]`. |
| CA8 | Encerrar após cada criação no Core e antes de salvar seu ID, inclusive antes de gravar nome/configuração ou informações do próprio dispositivo no projeto. A reconciliação encontra o único ID novo pelo conjunto anterior, reaproveita esse ID e termina com dois projetos associados, sem duplicatas. A leitura do próprio membro retorna nome, tipo e papel de criador em ambos. |
| CA9 | Interromper importação de categorias em cada projeto, inclusive durante substituição/remoção de presets, e interromper depois da importação antes do checkpoint. Retomar resulta no conjunto ativo correto; etapas já completas não são reimportadas sem necessidade. |
| CA10 | Falhar na persistência da intenção: nenhuma criação. Falhar ao salvar ID ou conclusão: preservar o diário anterior, reconciliar e concluir sem novos projetos indevidos. Fechar após publicar pronta e antes de tocar **Abrir organização**: ao reabrir, `ativa` ainda é `null`, a confirmação é reapresentada e nenhuma seleção é reconstruída ou inferida (escrita única do toque, SPEC A §4.2 regra 9). |
| CA11 | Duplo toque, remontagem e convite recebido durante preparação/recuperação não iniciam criação/aceite concorrente. `listProjects()` com erro ou chamada de resultado desconhecido não dispara nova criação. Verificar também retorno do segundo plano e timeout de apresentação. |
| CA12 | Com organização pronta, abrir caminho antigo de criação não cria nem substitui organização. Com operação pendente, o mesmo caminho retoma a existente. Projetos legados fora do diário permanecem intactos. |
| CA13 | Ao concluir, a confirmação (`confirmacaoPendente: true`) permanece visível até **Abrir organização**, inclusive com refetch atrasado. Reiniciar antes desse toque reapresenta a confirmação; depois dele, reconhecimento e `ativa` estão gravados na mesma escrita e o app abre `Home/Map` em Monitoramento. Voltar não retorna a formulário pronto para criar novamente. |
| CA14 | Logo após abrir: o cabeçalho de `Home` mostra o nome da organização e o menu mostra os dois acessos de área com Monitoramento marcado como atual; cada área abre com seu template, sem outra criação, e sua lista mostra zero registros com “Ainda não há registros em Monitoramento/Alertas” e ação **Ir para o mapa**. Nenhuma superfície inicial de organização extra é montada, e não há dados fictícios nem controles para projeto adicional. |
| CA15 | Todo o caminho, mensagens de erro e rótulos de acessibilidade funcionam em pt-BR, com interpolação correta. Extração/compilação de traduções passam na implementação; fallback não reintroduz o conceito antigo. |
| CA16 | Atualizar o app com uma criação pendente preserva a identidade, IDs e versões de templates, e permite concluí-la. No estado pronto, reinícios não importam categorias novamente. |

Na implementação, combinar testes de orquestração/persistência com Core real e interrupções nos limites de gravação, testes de navegação e execução em emulador. `tests/integration/helpers/setupIntegrationTest.tsx` já oferece montagem sem projeto; `tests/integration/helpers/navigation.tsx` usa o `AppNavigator` real; `src/frontend/screens/Onboarding/JoinProjectIntro.test.tsx` fornece um exemplo de teste integrado do onboarding. Injetar falhas no limite das operações, não substituir toda a semântica do Core por mocks que sempre retornam sucesso.

Para CA7 e CA13, usar o navegador real, estado inicial sem projeto, estado persistido 1/2 e atualização atrasada das consultas. Se houver correção de corrida de navegação, registrar RED no comportamento defeituoso e GREEN com a mesma regressão. Para fechamento do app, usar persistência em disco e reinício do processo; desmontar um componente ou reutilizar apenas stores em memória é evidência insuficiente.

Registrar screenshots pt-BR da escolha, nome inválido, preparação, falha 1/2, confirmação e organização aberta (cabeçalho com o nome, os dois acessos de área no menu e os dois estados vazios), além da evidência técnica dos IDs/etapas e dos templates corretos. A evidência de criação offline e de encerramento/retomada exige emulador com o Core nativo, além de stories. Este documento especifica essas verificações futuras; não declara que já passaram.

## 10. Riscos e pendências externas

As decisões funcionais acima estão fechadas. Restam no máximo cinco dependências/riscos a tratar no planejamento:

1. **Templates finais de #30 ainda não enumerados na fonte consultada.** Recomendação: entregar os dois pacotes aprovados, manifesto de conteúdo e versão antes da materialização; impedir entrega com categorias genéricas ou inventadas. O mecanismo e o momento da importação permanecem os definidos aqui.
2. **Convergência com o SPEC A — resolvida nesta revisão.** O documento único versionado `CoiabOrganizations` de SPEC A §4.2 está reproduzido em §5.3 e é o alvo de escrita desta sequência. Recomendação: implementar #24 uma única vez, com o tipo compartilhado, e alterar os dois documentos juntos se o esquema mudar; manter migração de dados legados separada, sem reconhecimento por nome.
3. **Criação não idempotente e importação não transacional no Core 7.4.0.** Recomendação: manter bloqueio global, snapshot de IDs antes de criar e verificação após importar; exigir testes de interrupção. Alteração local no Core só se a recuperação pelo cliente falhar de forma reproduzível; isso não justifica serviço remoto.
4. **Reconciliação de rotas e seleção automática do primeiro projeto.** Recomendação: derivar disponibilidade das telas do registro de organização e preservar confirmação pendente; provar com navegação real e refetch atrasado, incluindo convite concorrente.
5. **Apresentação das telas de #23/#26/#29 e assets nativos.** Recomendação: validar a composição reaproveitada e os estados vazios com o design aprovado, e testar caminhos locais dos pacotes no build instalado em modo avião. Ajustes visuais não alteram a ordem, o contrato offline ou a exigência 2/2.

## Decisões tomadas

1. **D1 — Organização local:** uma organização por dispositivo no MVP, composta por dois projetos CoMapeo; nenhum novo backend.
2. **D2 — Entrada:** escolha criar/aguardar após nomear o dispositivo, reutilizando o fork de navegação existente e retirando o caminho solo do onboarding COIAB.
3. **D3 — Criação offline:** internet, descoberta, GPS, Remote Archive e métricas não são pré-condições; templates acompanham a instalação.
4. **D4 — Materialização imediata:** criar Monitoramento e Alertas sequencialmente após confirmar o nome, antes de confirmar sucesso ou permitir primeiro acesso.
5. **D5 — Categorias explícitas:** usar criação sem importação implícita e depois `$importCategories({filePath})`, com verificação do conteúdo canônico por projeto.
6. **D6 — Identidade e nome:** identidade local independente do nome; nome obrigatório, limite compatível com o campo atual e `trim()` ao salvar; sem unicidade global.
7. **D7 — Recuperação durável:** persistir intenção, snapshot e IDs; reconciliar retornos perdidos, reutilizar projetos existentes e concluir a operação sem rollback destrutivo automático.
8. **D8 — Exclusão mútua:** uma criação por vez, incluindo bloqueio dos caminhos legados e aceite de convites durante operação pendente; nenhuma retentativa concorrente ou criação por timeout.
9. **D9 — Publicação 2/2:** organização pronta somente com dois IDs distintos e ambos os templates verificados; seleção ativa nunca é evidência suficiente de conclusão.
10. **D10 — Sucesso e estado vazio:** confirmação persistida até reconhecimento; depois, organização com nome e as duas **áreas** de zero registros, com Monitoramento como primeiro contexto interno.
11. **D11 — Vocabulário:** organização nos textos de criação/participação e nos novos descritores de i18n; Monitoramento/Alertas como **áreas** (glossário de §4.1); contratos técnicos de projeto continuam internos.
12. **D12 — Fronteiras:** entrada por convite, edição posterior, múltiplas organizações, migração e conteúdo final dos templates pertencem aos respectivos specs/entregas; a implementação deste fluxo deve cumprir os critérios CA1–CA16.

## Changelog da revisão r1

Findings aplicados: **B-1, B-2, B-3, B-4, B-5, B-6, X-1, X-2, X-3, X-4, X-5**.

| Finding | Mudança |
| --- | --- |
| B-1 / X-2 | §5.3 agora define o contrato de persistência completo: o mesmo documento versionado `CoiabOrganizations` do SPEC A §4.2, com organização, operação, journal (`materializacao`), snapshot de IDs, último erro e `confirmacaoPendente`, gravado atomicamente. O contrato é reproduzido aqui, não referenciado a escuras. |
| B-2 / X-3 | §7 não transforma o seletor derivado de `AllProjects.tsx` em seletor de áreas: `Organizations` lista organizações e nunca projetos internos (SPEC A D13); a alternância Monitoramento ↔ Alertas usa os dois acessos fixos do `DrawerMenu` (SPEC A §6.1/D12). |
| B-3 / X-4 | §3.1 e §4 fixam que `Success` apenas encaminha para `OrganizationSetup`, dono da escolha criar/aguardar; rótulo único **Aguardar convite**; descritores i18n novos em namespace próprio (hierarquia Criar organização = principal, Aguardar convite = secundária). |
| B-4 / X-1 | §7 substitui a "superfície inicial da organização" nova: `Abrir organização` grava reconhecimento + ativação em Monitoramento e abre `Home/Map`; evidência das duas áreas vem do cabeçalho + acessos fixos do menu. CA14 reescrito. |
| B-5 | §4 registra a inversão de hierarquia dos botões atuais de `Success.tsx` e manda criar descritores próprios. |
| B-6 | D5 registra que omitir `configPath` não equivale a `''` (default `this.#defaultConfigPath`, `mapeo-manager.js:468`). |
| X-5 | §4.1 traz o glossário compartilhado idêntico ao SPEC A §4.4: termo de produto **área**, strings canônicas únicas, variantes anteriores revogadas. |
