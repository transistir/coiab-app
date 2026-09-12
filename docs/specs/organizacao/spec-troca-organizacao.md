# SPEC A — Troca de organização

Status: decisões de produto e contrato técnico definidos para planejamento de implementação. Este documento não implementa a funcionalidade nem registra aprovação nas issues.

Base verificada em 06/09/2026: `transistir/coiab-app`, commit `c20ef05861909410eccaa0de65b76252d1eea045`. Os caminhos abaixo são relativos à raiz desse repositório; caminhos em `node_modules/` identificam dependências instaladas consultadas, não arquivos versionados do app. Tipos, campos e rotas apresentados como **propostos** são contratos deste spec, não APIs existentes.

## 1. Objetivo e recorte de produto

A organização passa a ser o contexto principal do COIAB. A ação que hoje permite escolher livremente um projeto passa a escolher uma organização. Cada organização contém dois projetos CoMapeo distintos e fixos, apresentados como áreas de trabalho: **Monitoramento** e **Alertas**.

O MVP admite **múltiplas organizações cadastradas por dispositivo** (decisão registrada em [#25](https://github.com/transistir/coiab-app/issues/25), 09/09/2026), incluindo organizações cuja preparação ainda não terminou. O modelo local já aceita uma coleção e o mecanismo de ativação é implementado e testado com mais de uma organização. A interface de seleção entre organizações (listar todas e trocar a ativa, inclusive entrar em uma segunda organização) é **trabalho próprio de UI ainda não implementado**: o que este spec define para a troca A → B (§5.2) vale para quando ela for construída; no estado atual do produto, o dispositivo entra em uma organização via onboarding (criação ou convite). A ativação já serve ao primeiro acesso, à restauração após reinício e à recuperação. A troca frequente entre organizações fica para o pós-MVP.

Decisão de produto registrada em [#25](https://github.com/transistir/coiab-app/issues/25) (09/09/2026): o MVP suporta múltiplas organizações, revogando a recomendação inicial de uma organização por dispositivo ali registrada. Não confundir “uma organização” com “um projeto”: as duas áreas existem desde a criação, e alternar entre elas não é troca de organização.

Referências de escopo: [épico #4 — Organizações](https://github.com/transistir/coiab-app/issues/4), [modelo mínimo #24](https://github.com/transistir/coiab-app/issues/24), [criação local #26](https://github.com/transistir/coiab-app/issues/26), [dois projetos #5](https://github.com/transistir/coiab-app/issues/5), [materialização e recuperação #31](https://github.com/transistir/coiab-app/issues/31), [rotas #28](https://github.com/transistir/coiab-app/issues/28) e [estados intermediários #29](https://github.com/transistir/coiab-app/issues/29).

## 2. O que existe na base

| Responsabilidade | Evidência lida | Consequência para o COIAB |
| --- | --- | --- |
| Entrada da troca | `src/frontend/sharedComponents/DrawerMenu.tsx`: usa `useManyProjects()`, mostra “Switch Project” quando há mais de um projeto e abre `AllProjects`. `src/frontend/sharedComponents/HomeHeader.tsx` mostra o nome do projeto e abre o menu. | Contar organizações, não os dois projetos fixos; exibir a organização no cabeçalho. |
| Seletor atual | `src/frontend/screens/AllProjects.tsx`: organização visual com projeto atual primeiro, marca de seleção, bloqueio por trilha e chamada a `setActiveProjectId`. | Reaproveitar a composição visual; mudar a fonte dos itens e o contrato de ativação. |
| Estado ativo | `src/frontend/contexts/ActiveProjectIdStoreContext.tsx`: Zustand persistido em MMKV, chave `ActiveProjectId`, valor `{projectId}`; na inicialização sem ID escolhe o primeiro retorno de `listProjects()`. | Um ID de projeto isolado não identifica uma organização. O fallback arbitrário não é válido no COIAB. |
| API do projeto | `src/frontend/contexts/ActiveProjectContext.tsx`: `ActiveProjectProvider` resolve `useSingleProject({projectId})` e fornece `projectId`/`projectApi`. | Manter esse contrato para telas que operam sobre uma área de trabalho. |
| Navegação | `src/frontend/Navigation/Stack/index.tsx`, `src/frontend/Navigation/Stack/AppScreens.tsx`, `src/frontend/Navigation/Stack/OnboardingScreens.tsx` e `src/frontend/sharedTypes/navigation.ts`. A seleção de onboarding/app depende de nome do dispositivo e ID ativo. Só o grupo de modais compartilhados recebe hoje `navigationKey={activeProjectId}`. | Validar organização antes de montar telas de projeto e reiniciar também o histórico das telas de conteúdo. |
| Abas e menu | `src/frontend/Navigation/Tab/index.tsx` monta `HomeTabs` com drawer e rotas `ObservationsList`, `Map`, `Camera`; `src/frontend/Navigation/Tab/TabBar.tsx` também oferece acesso à trilha pelo mapa. | A troca de organização entra no menu. Não requer uma nova aba inferior. |
| Criação | `src/frontend/screens/ProjectCreation/CreateOrNameSoloProject/index.tsx` usa `useCreateProject`/`useUpdateProjectSettings`; nomear o solo também cria outro projeto solo. `src/frontend/screens/Onboarding/MapOnYourOwnIntro.tsx` cria um projeto sem nome. | Reusar elementos do formulário, mas não executar essas regras de criação solo ao criar organização. |
| Consultas | `src/frontend/hooks/server/observations.ts` e `src/frontend/hooks/server/presets.ts` consultam documentos pelo projeto ativo; presets incluem o idioma. | Dados e categorias continuam separados por projeto. |
| Sincronização e arquivo | `src/frontend/screens/Exchange/index.tsx`, `src/frontend/screens/Exchange/ExchangeScreenContent.tsx`, `src/frontend/hooks/server/projects.ts` e `src/frontend/screens/RemoteArchive/index.tsx` usam `projectId`; o arquivo é identificado entre os membros do projeto. | Organização não transforma sincronização ou Remote Archive em recurso global do core. |
| Trabalho em andamento | `src/frontend/contexts/PersistedStores/DraftObservationStore.ts`, `src/frontend/contexts/DraftObservationContext.tsx` e `src/frontend/contexts/TrackStoreContext.tsx` mantêm estado global; os estados persistidos lidos não têm `projectId` de origem. | Bloquear troca enquanto houver trabalho pendente e acrescentar vínculo de origem na implementação. |

Não existem nesta base os caminhos `src/frontend/navigation/` nem hooks `multiProject*`: o diretório real é `src/frontend/Navigation/`, e o equivalente funcional está no seletor, nos contexts e nos hooks importados de `@comapeo/core-react` acima.

## 3. Substituição semântica e limites do mapeamento

| CoMapeo | COIAB | Correspondência |
| --- | --- | --- |
| Escolher o contexto principal no menu | Escolher organização | 1:1 na intenção da ação e no ponto de entrada. |
| Cartão do projeto ativo | Identificação da organização ativa | 1:1 na função de orientar o usuário; o nome vem do cadastro local. |
| Um projeto | Uma área Monitoramento ou Alertas de uma organização | 1:1 entre área e projeto CoMapeo. |
| Projeto ativo | Projeto derivado da organização ativa e da área selecionada | Não é uma simples renomeação do ID. |
| Lista de projetos | Lista de organizações locais | Uma organização corresponde a dois projetos; projetos soltos não viram itens da lista. |
| Criar/nomear projeto solo | Criar organização e materializar o par | Não é 1:1: exige preparar e validar os dois projetos. |
| Membros, papéis, convites e arquivo de um projeto | Recursos da área correspondente | Não há herança automática de permissões, convite único ou servidor compartilhado para a organização. |

Os identificadores e dados dos projetos existentes não são renomeados, copiados ou fundidos durante uma troca. “Monitoramento” e “Alertas” são rótulos fixos da camada COIAB, associados a IDs explícitos; nomes iguais no core não demonstram identidade ou pertencimento. “Alertas” aqui designa a área de registros, sem ativar notificações ou detecções remotas do CoMapeo.

Alternar **Monitoramento ↔ Alertas** mantém a organização e muda apenas o projeto operacional. A interface apresenta isso como navegação entre áreas fixas, sem oferecer criação, remoção, renomeação ou seleção livre de projetos no MVP.

## 4. Modelo local mínimo e persistência

### 4.1. Separação das camadas existentes

`src/frontend/App.tsx` importa o cliente `comapeo` de `@comapeo/core-react-native`, e `src/frontend/contexts/AppProviders.tsx` o entrega ao `ComapeoCoreProvider`. Em `package.json`, as versões declaradas são `@comapeo/core-react-native` **1.0.0-pre.12** e `@comapeo/core-react` **12.0.3**; `@comapeo/core` **7.4.0** está em `devDependencies`, inclusive para testes. A versão do core efetivamente executado é confirmada pelo próprio módulo nativo: `node_modules/@comapeo/core-react-native/src/version.ts:49` declara `BACKEND_MODULES["@comapeo/core"] = "7.4.0"`, a versão fixada no bundle Node.js embarcado. Core embarcado e dependência de desenvolvimento estão, portanto, na mesma versão 7.4.0, e o código legível em `node_modules/@comapeo/core/src/` serve de evidência do comportamento executado.

A leitura de `node_modules/@comapeo/core-react-native/README.md` confirma core executado em Node.js embarcado, com cliente RPC. O bundle instalado `node_modules/@comapeo/core-react-native/android/src/main/assets/nodejs-project/index.mjs` cria diretórios `sqlite-dbs` e `core-storage` para o manager e contém uso de `better-sqlite3`. No código legível de desenvolvimento, `node_modules/@comapeo/core/src/mapeo-manager.js` mantém `client.db`, chaves e caminhos de bancos por projeto; `node_modules/@comapeo/core/src/mapeo-project.js` abre o banco SQLite do projeto e configura armazenamento Hypercore. Portanto, a persistência dos projetos pertence ao core, combinando bancos SQLite e armazenamento dos cores; não é uma lista MMKV de observações.

Já `src/frontend/hooks/persistedState/createPersistedState.ts` fornece `MMKVStoreInitializer` sobre `react-native-mmkv`. Os contexts persistidos usam Zustand com serialização JSON. Não há dependência instalada `react-native-quick-sqlite` no `package.json`/`package-lock.json` consultados. Não introduzir esse driver nem tabelas de organização no banco privado do core.

### 4.2. Contrato proposto

Persistir **um único documento de produto versionado**, gravado atomicamente sob a **nova chave proposta** `CoiabOrganizations`, usando a mesma infraestrutura MMKV/Zustand. Esse documento é a única fonte durável da camada organizacional: cadastro, estado da operação de criação, journal de materialização da #31 e confirmação pendente são **campos dele**, não entidades nem chaves separadas. Não usar o helper `createPersistedState()` marcado como deprecated; seguir o padrão dos contexts com `persist`, `createJSONStorage` e `MMKVStoreInitializer`.

```ts
// Modelo proposto; não representa exports existentes.
// Chave MMKV proposta: 'CoiabOrganizations'. Documento único, versionado, escrito atomicamente.
type Area = 'monitoramento' | 'alertas';

type TemplateRef = {
  versao: string; // identificação de versão do pacote canônico da área
  hash: string; // hash do pacote fixado na distribuição
};

// Journal de materialização da #31: campo do documento, um registro por área.
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

Regras obrigatórias:

1. `id` não é nome, URL de arquivo ou ID de um dos projetos. Sua identidade é local ao dispositivo; este spec não promete compartilhar o cadastro por sincronização nem reconhecer uma organização em outro aparelho pelo ID local.
2. Uma organização `pronta` tem `materializacao.monitoramento.projectId` e `materializacao.alertas.projectId` não nulos e distintos, ambos com `etapa === 'verificado'`. Um projeto só pode pertencer a uma organização local e ocupar uma área. Projetos adicionais eventualmente existentes no core ficam sem associação e fora da experiência COIAB.
3. `estado='pronta'` só é gravado após confirmar o par e a aplicação dos respectivos templates de categorias. É conclusão da preparação, não prova permanente de acesso: a abertura sempre revalida existência e papel atual nos dois projetos.
4. `ativa` só pode referenciar organização pronta e utilizável. Ausência, vínculo parcial, acesso removido ou consulta com erro não autorizam selecionar o primeiro projeto do core. Falha temporária de consulta mostra recuperação, preservando o cadastro; não é motivo para apagar a seleção persistida.
5. O `projectId` operacional é **derivado** de `organizacoes[ativa.organizacaoId].materializacao[ativa.area].projectId` — a expressão indica busca pelo ID da organização, não índice numérico. Não manter um segundo ID ativo persistido como fonte concorrente.
6. Não persistir cópias de observações, categorias, membros, papéis, progresso de sync ou estado “Remote Archive ligado” nesse documento. Não há tipo de organização condicionado a ter arquivo. Nome local é o único atributo de apresentação obrigatório; cor, descrição, logo, servidor, timestamps e cadastro jurídico não compõem o mínimo.
7. Os três valores de `estado` são distintos e duráveis, porque §6.2 exige tela e ação diferentes para cada um. `preparando` é gravado antes de cada chamada ao core; `falha_recuperavel` é gravado ao capturar erro ou ao esgotar a tentativa automática; `pronta` é a conclusão 2/2. Em processo recém-iniciado não existe operação em voo: `preparando` encontrado na reidratação autoriza exatamente **uma** retomada automática, e seu fracasso grava `falha_recuperavel`, que exige “Tentar novamente” do usuário. Dentro de uma sessão viva, `preparando` significa chamada em andamento e bloqueia nova submissão.
8. “Indisponível” **não** é valor persistido: é o resultado de revalidar uma organização `pronta` na ativação (acesso removido, ID inexistente, leitura com erro) e nunca sobrescreve `estado` nem apaga `ativa`.
9. `confirmacaoPendente` recebe `true` na mesma gravação que publica `pronta`. O reconhecimento (“Abrir organização”) grava `confirmacaoPendente: false` e `ativa = {organizacaoId, area: 'monitoramento'}` em **uma única escrita**; encerrar o processo antes desse toque reapresenta a confirmação, sem recriar projetos.

O journal (`materializacao`, `areaEmExecucao`, `ultimoErro`) tem leitores definidos: (a) o coordenador de ativação (§5.1), que reconcilia e conclui a preparação; e (b) o registro condicional de rotas (§7), que classifica o dispositivo em organização **ausente** (nenhum registro), **incompleta** (`preparando` ou `falha_recuperavel`), **pronta com confirmação pendente**, **pronta e ativável** ou **indisponível** (revalidação de uma organização pronta falhou). Nenhum outro consumidor grava nesses campos. A coleção suporta múltiplos registros (#25); a interface de entrada em uma segunda organização é trabalho de UI ainda não implementado. A sequência que produz e consome esses campos é normativa no SPEC B §5.3–5.5; a forma acima é normativa aqui.

### 4.3. Criação, entrada e dados legados

Criar a organização é uma operação local que começa a materialização dos dois projetos imediatamente, com templates disponíveis no dispositivo. O formulário pode reaproveitar a base de `ProjectCreation/CreateOrNameSoloProject/index.tsx`, mas deve funcionar sem `useActiveProject()`: no primeiro acesso ainda não existe projeto operacional.

Somente após validar os dois projetos a organização é gravada como `pronta`, com `confirmacaoPendente: true`. Nesse ponto a criação exibe a confirmação “Organização criada” — um estado de `OrganizationSetup`, não uma rota nova (D13). A ativação em Monitoramento e a abertura de `Home/Map` acontecem no toque em **Abrir organização**, na escrita única descrita na regra 9 de §4.2. Se apenas um projeto foi criado, persistir seu ID, mostrar preparação incompleta e retomar a área faltante, sem recriar o projeto confirmado. Não mostrar uma organização incompleta como pronta nem criar um projeto solo de reserva. Trocar organização nunca chama criação ou importação de categorias.

A #31 deve tratar separadamente retorno incerto de criação: a chamada pode ter criado dados no core antes de o app salvar o ID. A API `createProject` lida em `node_modules/@comapeo/core/src/mapeo-manager.js` gera suas próprias chaves e não recebe chave de idempotência. Exigir journal e reconciliação dos IDs do core antes de repetir uma chamada incerta; não prometer uma transação entre MMKV e core ou inventar argumento de idempotência. Enquanto houver ambiguidade, manter recuperação explícita e preservar os projetos, sem associar por nome ou apagar candidatos automaticamente.

Entrada por convite reutiliza o transporte CoMapeo, mas um convite de projeto aceito **não basta** para ativar organização. O fluxo de entrada deve fornecer vínculo explícito do par de IDs às áreas e concluir a preparação local; enquanto faltar um vínculo/acesso, mostrar “Aguardando concluir a entrada na organização”. Não criar um novo projeto Alertas para completar um par recebido parcialmente: isso criaria outro grupo de dados. A definição do transporte do vínculo entre os dois convites pertence ao fluxo de entrada; este spec fixa seu contrato de saída e proíbe inferência por nomes. No MVP, recusar o início de entrada em outra organização quando já houver uma cadastrada, sem executar saída da atual.

A sequência normativa da criação — bloqueio único, snapshot de IDs, `createProject` com `configPath: ''`, `$importCategories` explícito, verificação e publicação 2/2 — está no SPEC B §5.4, escrevendo nos campos definidos em §4.2 acima. Este spec não a duplica.

Instalações CoMapeo com projetos existentes e sem cadastro de organização não são convertidas automaticamente. Preservar projetos, dados, chaves e o valor legado `ActiveProjectId`; abrir a porta de entrada de organização. A associação de dados legados exige migração explícita e verificada, fora deste spec. Não chamar `clear` global do MMKV. Quando houver cadastro válido, o ID legado deixa de ser autoridade; `ActiveProjectIdStoreContext.tsx` deve ser adaptado para expor a seleção derivada e impedir mutações arbitrárias. Não excluir sua chave histórica nesta entrega.

### 4.4. Glossário compartilhado (idêntico no SPEC B §4.1)

Termo de produto, campo correspondente no modelo e string única por estado. Estes são os termos válidos nos dois documentos e na UI; variantes anteriores (“espaço”, “tipo estável”, “Nenhum registro em…”, “Entrar por convite”, “Estamos preparando sua organização”) ficam revogadas.

| Termo de produto (UI e specs) | Campo/valor no modelo (§4.2) | String canônica pt-BR |
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
| Organização indisponível | resultado de revalidação; sem valor persistido (§4.2, regra 8) | “Não foi possível abrir sua organização”; botão **Tentar novamente** |
| Troca bloqueada por trabalho pendente | — | “Conclua ou descarte o registro antes de trocar de organização” |

## 5. Organização ativa e mecanismo de troca

### 5.1. Inicialização e contrato único

A organização ativa representa **o contexto de trabalho deste dispositivo**, não uma sessão de conta ou autorização no core. `AppProviders.tsx` deve disponibilizar o estado organizacional antes de montar consumidores do projeto. `Navigation/Stack/index.tsx` deve distinguir: autenticação/configuração do dispositivo, carregamento do registro local/core, organização ausente/incompleta/indisponível e organização utilizável.

Reabrir o app restaura organização e área gravadas, após validação local. A primeira ativação e uma troca para outra organização começam sempre em Monitoramento. Se uma coleção de teste/pós-MVP tiver várias organizações e nenhuma seleção válida, exigir seleção explícita; se houver exatamente uma pronta e sem confirmação pendente, a ativação inicial **deve** escolhê-la após validar o par. Falha de acesso à organização já selecionada não deve ativar outra silenciosamente.

Toda mudança de contexto deve passar por um coordenador de ativação da camada de produto, a implementar. Não é API do core. Isso inclui seleção, primeira criação, término de entrada, recuperação e alternância de área. Os consumidores atuais de `useActiveProject()` continuam recebendo um projeto real, já validado.

### 5.2. Sequência obrigatória da troca A → B

1. **Receber e serializar a intenção.** Validar ID de B e política de disponibilidade. Tocar na organização já ativa apenas fecha o seletor; não reinicia área, dados ou navegação. Impedir duplo toque e outra ativação concorrente.
2. **Verificar trabalho pendente antes de mudar estado.** Bloquear por gravação de trilha, trilha parada ainda não salva/descartada, rascunho de observação/edição, captura/processamento de mídia e mutação de dados, convite ou arquivo em andamento. Informar “Conclua ou descarte o registro antes de trocar de organização”. O usuário resolve o trabalho na origem e solicita a troca novamente; não há descarte automático ou continuação pendente após salvar. Reusar `src/frontend/screens/TrackRecordingActive.tsx` para conduzir a parada/salvamento de trilha, mas `isTracking=false` sozinho não libera a troca.
3. **Preparar B.** Mostrar “Abrindo organização…” sem conteúdo misturado e sem alterar a seleção persistida. Consultar os dois projetos, confirmar IDs, acesso e conclusão dos templates. A operação não exige internet nem arquivo acessível. Erro de leitura, ID ausente, papel bloqueado ou vínculo incompleto cancela a ativação, mantendo A. Erro de conectividade do arquivo não invalida projetos disponíveis localmente.
4. **Encerrar o contexto operacional de A.** Suspender novas ações e desligar os comandos de sincronização de dados iniciados pela UI para os dois projetos de A; desconectar suas conexões com servidores. Retirar listeners/telas vinculados à origem, fechar o drawer e cancelar/ignorar consultas de apresentação pendentes da origem. Mutação já enviada não pode ser “cancelada” só limpando o cache: por isso ela bloqueia a etapa 2. Cada callback carrega o projeto e a geração de contexto de origem, e não pode navegar ou publicar resultados na geração seguinte.
5. **Confirmar a seleção de uma vez.** Gravar `{organizacaoId: B.id, area: 'monitoramento'}` no documento organizacional e publicar o contexto derivado. A UI permanece coberta até concluir persistência, provider e navegação. Sem duas escritas independentes de organização e projeto. Erro de gravação restaura A e informa falha; se seus comandos de sync já foram interrompidos, informar que a sincronização precisa ser iniciada novamente.
6. **Abrir destino limpo.** Descartar o histórico de telas dependentes do contexto anterior e abrir `Home`, aba `Map`, em Monitoramento de B. Limpar filtros de lista, seleção de categoria, seleção de registro e estados transitórios do mapa; não apagar mapas baixados, preferências gerais nem dados do core. Voltar no Android não pode ressuscitar tela, modal ou parâmetros de A.

As etapas são uma transição de interface, não uma transação distribuída. Em encerramento do processo, a seleção durável anterior ou a nova seleção completa é revalidada na próxima abertura; nunca montar um par misto. Durante uma tentativa com erro, oferecer “Tentar novamente” e “Voltar”; sem origem utilizável, permanecer na recuperação.

Alternar área aplica os mesmos bloqueios, isolamento de callbacks e reinício do conteúdo, mas mantém `organizacaoId`, muda apenas `ativa.area` e encerra o contexto operacional do projeto de origem. Não passa pelo seletor de organizações.

### 5.3. Efeitos por subsistema

| Subsistema | Comportamento definido |
| --- | --- |
| Dados e cache | Listas, mapa, detalhes, campos, mídia, exportação e contadores leem somente o projeto derivado da área. Manter consultas identificadas por `projectId`, como os hooks atuais; qualquer nova agregação deve incluir organização e ambos os IDs. Não usar dados anteriores como placeholder do destino. Cache de A pode permanecer com sua chave; seus resultados não renderizam em B. |
| Categorias | `hooks/server/presets.ts` continua resolvendo presets por projeto e idioma. Cada área usa seu template fixo. Troca não importa, copia ou mistura categorias; categoria selecionada na origem não permanece no destino. Edição de categorias não fica acessível no MVP. |
| Rascunhos e trilhas | Acrescentar origem persistida por `projectId` aos estados de trabalho antes de liberar troca; validar a origem também ao salvar. Mesmo com essa proteção, o MVP mantém apenas um trabalho em andamento e bloqueia a troca até concluí-lo. Rascunho legado sem origem só pode receber o ID legado se ele for verificável; caso contrário, fica em recuperação, sem atribuição ao novo contexto. |
| Sincronização | `Sync` continua operando uma área por vez e identifica organização + área. A troca não sincroniza automaticamente os dois projetos do destino nem reaproveita o percentual da origem. `ExchangeScreenContent.tsx` já usa `projectApi.$sync.stop()`, `connectServers()` e `disconnectServers()`; a ativação precisa coordenar a saída, pois o cleanup atual desconecta servidores e só configura autostop em condições específicas. |
| Limite do desligamento de sync | Parar sync de dados não é garantia de desconexão integral entre dispositivos: `node_modules/@comapeo/core/src/sync/sync-api.js` documenta que `stop()` mantém pre-sync. A organização local não é uma fronteira nova de segurança de rede. A descoberta local do dispositivo continua; não prometer ausência de todo tráfego de organizações inativas. |
| Remote Archive | A configuração permanece em cada projeto. As rotas de arquivo usam o projeto da área selecionada, com organização + área identificadas. Adicionar/remover arquivo continua afetando só essa área; não copiar URL, membros ou consentimento para a outra área ou organização. Se houver um resumo organizacional, mostrar o estado de cada área, inclusive configuração parcial. Ausência de arquivo não altera a organização nem impede ativação. |
| Permissões | Reconsultar papéis por projeto; coordenador em Monitoramento não implica coordenador em Alertas. Não armazenar nem inferir um papel organizacional. As regras de alteração de arquivo e dados continuam submetidas ao core. |
| Estado geral do aparelho | Idioma, PIN, privacidade, preferências de coordenadas/unidades, permissões de câmera/localização e mapas de fundo permanecem gerais. Trocar organização não efetua logout, não apaga dispositivo e não transfere observações. |

Os fluxos que hoje escrevem um ID diretamente precisam ser integrados ao contrato: `src/frontend/screens/Invites/InviteSuccessfullyAccepted.tsx`, `src/frontend/screens/RemovedFromProjectBottomSheet.tsx`, `src/frontend/screens/YourTeam/LeaveProject.tsx` e os fluxos de criação citados. `src/frontend/screens/Invites/InviteReceived.tsx` também cria um solo de reserva após aceitar convite; essa regra não pertence ao COIAB. Ocultar só o botão de troca é insuficiente.

Perda de acesso a qualquer um dos dois projetos torna o contexto organizacional indisponível até recuperação: bloquear novas gravações, preservar trabalho pendente e encaminhar à recuperação sem fallback solo. A verificação deve observar ambos os projetos; `src/frontend/sharedComponents/ProjectRemovalListener.tsx` hoje observa apenas o ativo. Não converter uma remoção em recriação do projeto faltante nem oferecer saída individual de uma área fixa no MVP.

## 6. Interface e estados intermediários

### 6.1. Entrada e navegação entre áreas

O cabeçalho de `Home` identifica a organização; o nome completo deve estar disponível no menu e na leitura de acessibilidade, mesmo se truncado visualmente. O menu mostra o nome da organização e dois acessos fixos, **Monitoramento** e **Alertas**, com marca da área atual. As abas inferiores existentes continuam representando lista, mapa, câmera e acesso à trilha.

Com múltiplas organizações suportadas no MVP (#25) e a interface de seleção ainda não implementada, não mostrar “Trocar de projeto”, “Nova colaboração” ou seletor vazio enquanto o seletor de organizações não existir. Quando o seletor for construído, `Organizations` lista organizações — nunca áreas: o seletor não se torna um seletor de áreas.

A alternância **Monitoramento ↔ Alertas** acontece exclusivamente por esses dois acessos fixos do menu, em qualquer momento do ciclo de vida da organização, inclusive logo após a criação (D12). Junto com o nome da organização no `HomeHeader`, esses dois acessos são a evidência de que a organização tem duas áreas acessíveis — não é necessária uma superfície inicial de organização adicional.

O cartão do menu oferece **“Trocar de organização”**, abrindo o seletor modal **“Organizações”**. Mostrar a ativa primeiro com marca e texto “Atual”; demais por nome, com desempate pelo ID. Nomes duplicados recebem um identificador local abreviado para distingui-los. Organizações incompletas/indisponíveis aparecem identificadas, sem ação de ativação; a recuperação é uma ação separada. O seletor não lista os projetos internos nem inicia criação de outra organização. Essa criação será outra entrega de produto.

### 6.2. Estados e ações

| Condição | Conteúdo e ação | Base de reaproveitamento |
| --- | --- | --- |
| Registro/core carregando | “Carregando organização…”; impedir entrada em telas de projeto. Erro encerra o carregamento e oferece nova tentativa. | `src/frontend/sharedComponents/FullScreenCenteredLoader.tsx`. |
| Nenhuma organização, dispositivo configurado (nenhum registro em `organizacoes`) | “Seu dispositivo ainda não está em uma organização”; ações **Criar organização** e **Aguardar convite**. Sem lista de projetos solo. É aqui que vive a escolha criar/aguardar: `Success` apenas encaminha para cá. | Composição de `src/frontend/screens/Onboarding/Success.tsx`, com descritores i18n próprios (SPEC B §4). |
| Espera por convite | Título **Aguardar convite**; “Peça a uma pessoa responsável pela organização para convidar este dispositivo.”; botão Voltar. Recepção de convites continua ativa; espera não é spinner infinito nem organização pronta vazia. | `src/frontend/screens/ProjectCreation/JoinAProject.tsx` e `src/frontend/sharedComponents/PendingInvitesListener.tsx`. |
| Criação/entrada em andamento (`estado: 'preparando'`) | “Preparando sua organização…”, com uma linha por área (**Aguardando**, **Preparando**, **Pronto**, **Não concluído**). Sem ação de retry manual enquanto uma chamada está em curso; na reabertura, uma única retomada automática (§4.2, regra 7). | Nova porta de entrada organizacional, com os componentes de feedback existentes. |
| Criação/entrada falhou de forma recuperável (`estado: 'falha_recuperavel'`) | “Não foi possível concluir a criação.” + “O que já foi preparado está salvo. Tente novamente para concluir.”; indicar qual área falta e oferecer **Tentar novamente** para criação, ou orientação de completar o convite para entrada. Não criar segunda organização como retry. | Mesma porta de entrada; estado distinto do anterior, exigido pela regra 7 de §4.2. |
| Organização pronta, confirmação pendente (`confirmacaoPendente: true`) | “Organização criada”; “{organizationName} está pronta. Monitoramento e Alertas já estão disponíveis.”; botão **Abrir organização**, que ativa Monitoramento e abre `Home/Map` na escrita única da regra 9. Reabrir antes do toque reapresenta este estado. | `ProjectCreation/CreateOrNameSoloProject/ProjectCreated.tsx` como composição, sem convite nem estatísticas. |
| Organização pronta e ativa, sem registros | Manter nome no cabeçalho e os dois acessos de área no menu. “Ainda não há registros em Monitoramento” / “Ainda não há registros em Alertas”, com ação **Ir para o mapa**. Não mostrar “sem organização”. | `src/frontend/screens/ObservationsList/ObservationsEmptyView.tsx` e `src/frontend/screens/ObservationsList/index.tsx`. |
| Organização indisponível (revalidação falhou; sem valor persistido) | Nome preservado; “Não foi possível abrir sua organização”, explicando acesso removido, vínculo inconsistente ou falha de leitura; botão **Tentar novamente**. Retorno/seleção de outra somente se essa ação estiver disponível. Preservar rascunhos e dados. | Tratamento organizacional do listener de remoção e da porta de entrada. |
| Troca bloqueada/falhou | Explicação específica; manter organização e área anteriores. Nenhum “sucesso” antes da persistência e abertura do destino. | Feedback modal existente, sem nova rota só para erro de troca. |

Este spec fixa comportamento, conteúdo e localização funcional. Não introduz um redesenho da bottom nav ou declara conformidade visual com Figma. Os componentes de criação/entrada e estados vazios devem seguir o design aprovado no trabalho de implementação das issues correspondentes.

## 7. Menor conjunto de rotas e integração

Nomes novos abaixo são **propostas para implementação**; não são arquivos existentes. Usar o `RootStack` atual, sem criar outro navegador raiz.

| Rota | Alteração e responsabilidade |
| --- | --- |
| `OrganizationSetup: undefined` — **nova** | Porta de entrada após configurar o dispositivo, também usada para recuperação. Contém como estados locais: ausência com a escolha **Criar organização**/**Aguardar convite**, introdução, formulário de nome, preparação, falha recuperável e **confirmação de criação com “Abrir organização”**; não exige projeto ativo. A espera por convite reutiliza `JoinProjectIntro`. Não criar uma rota para cada estado (D13). |
| `AllProjects: undefined` → `Organizations: undefined` — **renomeada** | Reposicionar o seletor modal atual para ler o registro local e listar **organizações**, nunca os projetos internos nem as áreas. Disponível apenas quando a capacidade de múltiplas organizações estiver habilitada; acessível também na recuperação, sem depender de `ActiveProjectProvider`. |
| `Home` e suas abas — **mantidas** | Consomem organização/área validadas; após ativação abrem `Map`, inclusive na primeira abertura vinda da confirmação. Alternância de área é estado de produto acionado pelos acessos fixos do menu, sem rota nova por projeto e sem superfície inicial de organização adicional. |
| `Success`, `JoinProjectIntro` e modais de convite — **adaptadas** | `Success` deixa de conter a decisão criar/aguardar: encaminha à porta de entrada organizacional, que apresenta a escolha reaproveitando sua composição visual. Espera e resultado de convite funcionam sem projeto ativo; conclusão de convite não chama seleção de projeto diretamente. |
| `CreateProject`, `NameSoloProject`, `MapOnYourOwnIntro` e entradas de colaboração livre — **retiradas da jornada COIAB MVP** | O formulário organizacional reaproveita componentes, sem oferecer os fluxos solo originais. Não deixar entradas secundárias contornarem a jornada organizacional. |
| `Sync`, `RemoteArchive`, `AddRemoteArchive`, `RemoveRemoteArchive` e telas de conteúdo — **mantidas** | Operam na área derivada, identificam seu escopo e pertencem ao ciclo de vida do contexto. Rotas e callbacks antigos não podem atuar no novo destino. |

São **uma rota funcional nova e uma renomeação**, além de adaptações de registro, condições e consumidores existentes. Alterar `src/frontend/sharedTypes/navigation.ts` e os arquivos reais em `src/frontend/Navigation/Stack/` para registrar esse contrato. Não acrescentar `organizationId` opcional a todas as rotas de conteúdo: o contexto é resolvido centralmente; IDs em parâmetros nunca autorizam acesso cruzado.

Separar no registro condicional: autenticação/configuração de dispositivo; entrada/recuperação sem projeto; conteúdo com organização validada. A classificação usa exclusivamente o documento `CoiabOrganizations` de §4.2 — ausência de registro, `estado`, `confirmacaoPendente` e o journal `materializacao`/`areaEmExecucao` —, nunca `listProjects()` nem o `activeProjectId` legado; a ordem de resolução é a do SPEC B §3.3. `src/frontend/Navigation/Stack/index.tsx` não pode continuar usando somente `!activeProjectId` como condição de onboarding. Manter `OrganizationSetup` alcançável quando a seleção aponta para projeto inexistente, sem tentar montar o provider desse projeto antes da recuperação.

A chave de navegação das telas e modais dependentes do contexto deve incluir organização e área/projeto. Recriar o conteúdo com essa chave e destino inicial explícito `Home/Map`; não depender de `goBack()` após trocar o ID nem do `initialRouteName` calculado em um onboarding anterior. O mecanismo de remoção de telas por `navigationKey` é suportado pela [documentação de grupos do React Navigation](https://reactnavigation.org/docs/group/); a necessidade de coordenar essa remoção com os gates acima decorre do código local. A implantação deve provar o destino com o navegador real.

`src/frontend/Navigation/Stack/DeepLinkListener.tsx` e `PendingInvitesListener.tsx` devem adiar abertura de modais durante uma ativação e aplicar a política de convite antes de aceitar/ativar contexto. Links ou notificações não habilitam múltiplas organizações no MVP. Preservar a intenção para reavaliação depois da transição; nunca reaproveitar parâmetros de A em B.

## 8. MVP, pós-MVP e não-objetivos

| Entrega | MVP | Pós-MVP |
| --- | --- | --- |
| Organizações cadastradas pela jornada normal | Múltiplas (decisão #25, 09/09/2026); entrada hoje pelo onboarding — criação ou convite. | Interface de gestão/troca frequente entre organizações. |
| Dois projetos fixos e áreas acessíveis | Obrigatório desde a criação concluída. | Mantido até nova decisão. |
| Registro local em coleção e ativação centralizada | Implementados; primeira ativação, restauração e recuperação exercitam o mecanismo. | Reutilizados para troca frequente. |
| Seletor de organizações | Política definida (§6.1); UI não implementada. Construção planejada como entrega própria, usando o flag já existente `useEarlyAccessState` (`src/frontend/sharedComponents/DrawerMenu.tsx:110`) se precisar de liberação gradual. | Habilitado quando houver duas ou mais; uma única não precisa de seletor. |
| Adicionar/substituir/abandonar organização | Entrada por criação (onboarding) ou convite; sem substituição destrutiva. | Requer política própria de entrada, saída e dados locais. |

Não-objetivos explícitos:

- Criar backend, API remota de organizações, conta de usuário ou diretório central; sincronizar o cadastro MMKV entre dispositivos.
- Alterar schema/protocolo/chaves dos projetos CoMapeo ou promover permissões e convites de projeto a permissões/convites globais de organização.
- Definir o transporte de pareamento de convites ou o conteúdo canônico das categorias; seus contratos de ativação e recuperação são obrigatórios aqui. O journal de materialização **não** é não-objetivo: chave, forma e leitores estão fixados em §4.2, e a #31 implementa apenas as rotinas de reconciliação que gravam nesses campos (SPEC B §5.4–5.5).
- Migrar automaticamente projetos legados, mover registros entre áreas/organizações, excluir projetos, substituir a organização atual ou implementar saída individual das áreas fixas.
- Garantir isolamento de todo tráfego de rede por organização, sincronização conjunta automática ou configuração automática de Remote Archive nos dois projetos.
- Introduzir notificações na área Alertas, redesign da bottom nav ou edição livre de projetos/categorias no MVP.

## 9. Critérios de aceite e evidência

Os critérios abaixo verificam a implementação futura; esta alteração documental não os declara executados. “A” e “B” são organizações com pares de projetos distintos preparados por fixtures, sem liberar a capacidade múltipla no produto MVP.

| ID | Cenário testável e resultado esperado | Evidência mínima |
| --- | --- | --- |
| CA01 | Dispositivo sem organização: após configuração, abre `OrganizationSetup`, que oferece **Criar organização** e **Aguardar convite** (a decisão não fica em `Success`) e não monta conteúdo de projeto nem cria solo automaticamente. | Integração com navegador real e captura do estado vazio. |
| CA02 | Criação sem internet: conclui o par com templates corretos e grava `estado: 'pronta'` com `confirmacaoPendente: true`, exibindo a confirmação. **Abrir organização** grava `confirmacaoPendente: false` e `ativa` em uma escrita e abre `Home/Map` em Monitoramento. Reabrir antes do toque reapresenta a confirmação; depois dele abre a organização, mantendo cadastro e IDs. | Integração com core + reabertura em emulador, com encerramento de processo antes e depois do toque. |
| CA03 | Falhar após criar 1 de 2 projetos: a organização fica `falha_recuperavel` com o journal apontando a área faltante; retry completa o faltante com o mesmo ID já confirmado. Encerrar o processo durante uma chamada deixa `preparando`, que na reabertura faz exatamente uma retomada automática e, falhando, passa a `falha_recuperavel` com “Tentar novamente”. Retorno incerto exige reconciliação, sem criação cega nem perda de candidatos. | Falhas injetadas por etapa e reabertura durante preparação, verificando o valor persistido de `estado`. |
| CA04 | Uma organização com dois projetos: não há troca de projeto/organização nem criação de segunda; ambos os acessos de área funcionam. Entrada secundária, deep link e aceite de convite não burlam a política. | Integração de navegação e inspeção da UI MVP. |
| CA05 | Com A e B disponíveis em testes, seletor mostra duas organizações, atual marcada e nomes distinguíveis; nenhum dos quatro projetos é item de troca. Tocar A é no-op que fecha o seletor. | Teste do seletor e captura visual. |
| CA06 | Trocar A/Alertas → B: concluir em B/Monitoramento, `Home/Map`, com drawer fechado. Voltar não mostra tela/modal de A. Alterar área em B não muda organização. | Navegador real com histórico semeado, incluindo onboarding prévio e detalhe/modal aberto. |
| CA07 | A tem registros e categoria exclusivos; B tem outros ou está vazio. Atrasar consultas/listeners de A até depois da troca: nada de A aparece em B nem é usado ao criar/salvar em B. Reabrir restaura a última área persistida de B. | Integração com dados distintos e respostas atrasadas. |
| CA08 | Trilha gravando, trilha parada pendente, rascunho, edição, processamento de mídia ou mutação em andamento: troca bloqueada, seleção inalterada e dados preservados. Salvar/descartar na origem permite nova tentativa. | Testes de cada bloqueio; verificar também o projeto de destino da gravação. |
| CA09 | Rascunho persistido com origem A não é salvo em B; legado sem origem verificável abre recuperação. Encerrar processo entre preparação e confirmação restaura somente seleção anterior ou destino completo. | Testes de reidratação e falha de persistência. |
| CA10 | B incompleta, com ID inexistente, acesso bloqueado em qualquer área ou erro de leitura: troca não confirma. Falha temporária não apaga cadastro/seleção. Sem origem utilizável, recuperação permanece acessível. | Falhas de core simuladas, inclusive na área não selecionada. |
| CA11 | A sincronizando: troca envia parada de dados e desconexão de servidores para os projetos de A; B não herda percentual, dispositivo conectado da UI ou início automático. Dados locais permanecem. | Integração dos comandos com IDs verificados e observação do estado; sem afirmar ausência total de pre-sync. |
| CA12 | A tem arquivo e B não; ou só Monitoramento tem arquivo: telas refletem o projeto selecionado. Troca não chama adicionar/remover arquivo; uma operação de arquivo afeta apenas a área indicada e respeita seu papel. | Core/fixtures com configuração e papéis diferentes. |
| CA13 | Seleção legada aponta para projeto solo ou fora do cadastro: não adotá-lo como organização. Preservar dados e preferências. Perda de acesso posterior não cria solo, não recria projeto e não troca silenciosamente de organização. | Inicialização com MMKV/core semeados e eventos de remoção. |
| CA14 | Duplo toque, mudança de contexto durante refresh e convite/deep link recebido durante ativação: uma transição, destino correto, nenhum modal obsoleto. Erro de gravação mantém origem e permite nova tentativa. | Navegador real, refresh atrasado e falhas controladas. |
| CA15 | Estados sem organização, esperando convite, preparação em andamento, falha recuperável, confirmação pendente, vazios de ambas as áreas, organização indisponível e erro de troca apresentam exatamente os textos/ações de §6.2 e do glossário de §4.4, sem variantes revogadas. Leitor de tela identifica organização e seleção sem depender só de cor. | Capturas de cada estado revisadas visualmente e verificação de acessibilidade. |
| CA16 | Logo após abrir a organização recém-criada: o cabeçalho de `Home` mostra o nome da organização e o menu mostra os dois acessos de área com Monitoramento marcado como atual; cada área abre com seu template e seu estado vazio, sem nova criação/importação e sem controles para projeto adicional. Nenhuma superfície inicial de organização extra é montada. | Navegador real a partir do documento persistido pronto, com captura do cabeçalho, do menu e dos dois estados vazios. |

Bases de teste existentes consultadas: `src/frontend/contexts/ActiveProjectIdStoreContext.test.tsx`, `src/frontend/screens/Onboarding/JoinProjectIntro.test.tsx` e `tests/integration/helpers/core.ts`. O primeiro cobre seleção/fallback de projeto, mas não comprova o contrato organizacional. O segundo usa navegação real e convite; o helper fornece manager e IPC para exercitar o core.

Para qualquer regressão de reconciliação de rotas, registrar RED no comportamento defeituoso e GREEN na correção com o mesmo teste, navegador real, histórico semeado e refresh atrasado. Mocks de `navigate` isolados não satisfazem CA06/CA14. Registrar SHA da implementação, resultados e revisão independente; capturas verdes de pipeline precisam de inspeção visual. A implementação que modificar stories/fluxos deve seguir os gates de captura do repositório.

## 10. Riscos e questões abertas delimitadas

As decisões deste spec não ficam condicionadas às questões abaixo. Elas delimitam trabalhos consumidores; cada item já tem encaminhamento.

1. **Pareamento de convites entre dispositivos.** Convite CoMapeo identifica projeto, e o cadastro local não se replica. **Recomendação:** o fluxo de entrada deve entregar explicitamente os dois IDs e suas áreas antes da ativação; enquanto isso, manter espera recuperável. Não parear pelo nome e não apresentar “entrou na organização” após um só convite.
2. **Criação interrompida entre core e MMKV.** Não há transação comum nem idempotência na API de criação consultada. **Recomendação:** a #31 implementa a reconciliação sobre o journal fixado em §4.2 antes de retry incerto; incerteza permanece recuperável, sem apagar dados ou duplicar cegamente. A troca só aceita preparação concluída e confirmação reconhecida.
3. **Perda do cadastro local ou dados legados.** Projetos sobreviventes não permitem deduzir com segurança a composição organizacional. **Recomendação:** preservar o core e exigir migração/recuperação explícita; não reconstruir por nomes, ordem da lista ou URL do arquivo.
4. **Expectativa de isolamento e permissões organizacionais.** Papéis, arquivo e sync continuam por projeto, inclusive pre-sync do core. **Recomendação:** identificar a área em ações sensíveis, não agregar permissões e não prometer desligamento integral de rede; outro requisito de isolamento exigirá trabalho próprio no core.
5. **Dependências com arquitetura de navegação e design.** A #28 depende da definição de navegação e as telas de criação/espera têm desenho próprio. **Recomendação:** planejar com o conjunto mínimo da seção 7, preservando os bloqueios e estados definidos; adaptar a apresentação ao design aprovado sem reintroduzir troca livre de projetos. Múltiplas organizações permanecem desabilitadas até decisão posterior de produto.

## Decisões tomadas

1. **D1.** Organização é o contexto principal local do COIAB; o MVP suporta múltiplas organizações por dispositivo (decisão #25, 09/09/2026), com UI de seleção/troca como entrega própria.
2. **D2.** Cada organização pronta associa dois projetos CoMapeo distintos e exclusivos às áreas fixas Monitoramento e Alertas; nomes não determinam associação.
3. **D3.** A camada organizacional usa **um único** documento versionado em MMKV/Zustand, na chave `CoiabOrganizations`, escrito atomicamente: cadastro, estado da operação de criação, journal de materialização e confirmação pendente são campos desse documento, não chaves ou entidades separadas. Projetos, dados, membros e configurações permanecem no core existente, sem novo backend.
4. **D4.** Organização e área ativas são uma única seleção persistida; o projeto operacional é derivado, sem ID persistido concorrente ou fallback ao primeiro projeto/solo.
5. **D5.** Preparação do par ocorre na criação; sucesso e ativação exigem os dois projetos e templates concluídos. Falha parcial preserva IDs e permite recuperação. O estado persistido distingue `preparando`, `falha_recuperavel` e `pronta`: em processo novo, `preparando` autoriza uma única retomada automática e `falha_recuperavel` exige “Tentar novamente”; “indisponível” é resultado de revalidação, não valor persistido.
6. **D6.** Convite de um projeto não ativa organização; entrada exige vínculo explícito e acesso ao par completo. Projetos legados não são agrupados automaticamente.
7. **D7.** Uma organização recém-criada é publicada `pronta` com `confirmacaoPendente: true` e só é ativada no toque em **Abrir organização**, que grava reconhecimento e seleção em uma escrita única. Primeira ativação e troca de organização abrem Monitoramento em `Home/Map`; reinício restaura a área válida persistida. Não há superfície inicial de organização além de `Home` — o nome no cabeçalho e os dois acessos de área no menu são a evidência exigida. Selecionar a atual não reinicia contexto.
8. **D8.** Toda mudança de contexto usa uma operação centralizada, serializada e validada; preserva origem em falha, elimina histórico obsoleto e rejeita resultados tardios da origem.
9. **D9.** Trabalho pendente bloqueia troca; rascunhos e trilhas recebem vínculo de origem antes da liberação do mecanismo. Não há descarte automático.
10. **D10.** Sincronização de dados e conexões de arquivo da origem são encerradas pela troca; o destino não inicia sync automaticamente. Não há promessa de isolamento integral de tráfego.
11. **D11.** Categorias, permissões e Remote Archive continuam por projeto/área; não são copiados ou promovidos automaticamente ao nível organizacional.
12. **D12.** Menu e cabeçalho identificam organização; os dois acessos de área substituem a escolha livre de projeto. Não é necessária nova aba inferior.
13. **D13.** O mínimo de navegação é uma nova `OrganizationSetup`, renomeação de `AllProjects` para `Organizations` e adaptação dos gates/rotas existentes; estados intermediários — inclusive a confirmação de criação — não viram rotas adicionais. `Organizations` lista organizações e nunca projetos internos ou áreas; a escolha criar/aguardar pertence a `OrganizationSetup`, não a `Success`.
14. **D14.** Coleção e mecanismo suportam múltiplas organizações sob testes; a UI e a entrada em uma segunda organização ficam desabilitadas no MVP.
15. **D15.** Perda de acesso ou associação inconsistente encaminha à recuperação com dados preservados, sem recriação de projeto ou troca silenciosa; aceitação exige evidência de navegação real e revisão independente.
16. **D16.** O glossário de §4.4 é compartilhado com o SPEC B (§4.1) e normativo nos dois: o termo de produto é **área** (nunca “espaço” ou “tipo”), a ação de espera é **Aguardar convite** (nunca “Entrar por convite”) e cada estado tem uma única string canônica pt-BR.

## Changelog da revisão r1

Findings aplicados: **A-1, A-2, A-3, A-4, X-1, X-2, X-3, X-4, X-5**.

| Finding | Mudança |
| --- | --- |
| A-1 | §4.2 substitui `estado: 'preparando' \| 'pronta'` por `'preparando' \| 'falha_recuperavel' \| 'pronta'`, acrescenta `confirmacaoPendente`, `areaEmExecucao` e `ultimoErro`, e as regras 7–9 definem como o processo recém-iniciado desambigua “em andamento” de “falhou”. §6.2 passa a ter linhas separadas para cada estado; CA03 verifica o valor persistido. |
| A-2 / X-2 | O journal deixa de ser “estado separado” e vira o campo `materializacao` do mesmo documento versionado `CoiabOrganizations` (§4.2), com forma (`EtapaArea`, `TemplateRef`) e leitores nomeados: coordenador de ativação (§5.1) e registro condicional de rotas (§7). §7 e §8 foram ajustados: a #31 implementa a reconciliação, não o formato. O mesmo tipo aparece no SPEC B §5.3. |
| A-3 | §5.1: com exatamente uma organização pronta e sem confirmação pendente, a ativação inicial **deve** escolhê-la. |
| A-4 | §4.1 cita `node_modules/@comapeo/core-react-native/src/version.ts:49` (`BACKEND_MODULES["@comapeo/core"] = "7.4.0"`) como prova da versão do core embarcado; a ressalva anterior foi removida. |
| X-1 | Destino pós-criação unificado: publicação `pronta` + `confirmacaoPendente: true`, confirmação como estado de `OrganizationSetup`, e **Abrir organização** grava reconhecimento e ativação em Monitoramento em uma escrita, abrindo `Home/Map` (§4.3, §6.2, §7, D7). Não há superfície inicial de organização adicional; a evidência das duas áreas vem do cabeçalho e dos acessos fixos do menu. |
| X-3 | §6.1, §7 e D13 fixam que `Organizations` lista organizações e não vira seletor de áreas; a alternância Monitoramento ↔ Alertas usa os acessos fixos do `DrawerMenu`. |
| X-4 | §6.2, §7, D13 e CA01 fixam `OrganizationSetup` como dono da escolha criar/aguardar; `Success` apenas encaminha. Rótulo único: **Aguardar convite**. |
| X-5 | Novo glossário compartilhado em §4.4 (idêntico ao §4.1 do SPEC B) e D16; strings de §6.2 alinhadas (“Preparando sua organização…”, “Não foi possível concluir a criação.”, “Ainda não há registros em Monitoramento/Alertas”, “Não foi possível abrir sua organização”). |

Também acrescentados: CA16 (evidência das duas áreas logo após abrir) e ponteiros explícitos para o SPEC B §3.3 e §5.4–5.5, evitando duplicar a sequência de criação.
