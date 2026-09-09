# SPEC — Issue #46: Organização como composição de projetos CoMapeo

**Issue:** https://github.com/transistir/coiab-app/issues/46  
**Tipo:** Technical spike / validação arquitetural  
**Status:** Arquitetura proposta definida; spike necessário para validação  
**Data:** 2026-08-28  
**Última revisão:** 2026-09-03 — 2ª rodada (Codex gpt-5.6-sol): retry/reemissão de invites, nome da Organização no marker, resolução na inicialização, auditoria de superfícies standalone  
**Repositório:** `transistir/coiab-app`  
**Branch de referência:** `develop`

---

## Resumo executivo

A arquitetura proposta para o MVP é:

> **Organização é uma camada de produto do COIAB App que compõe projetos CoMapeo existentes.**

No MVP, cada Organização possui exatamente dois projetos:

- `Monitoramento`
- `Alertas`

Para o usuário, esses projetos **não existem como entidades independentes de produto**. Nesta distribuição do CoMapeo, Organização é o modelo padrão e obrigatório de uso. Os projetos continuam existindo e funcionando internamente como primitives do Core, mas o COIAB não precisa preservar a experiência legada de criar, entrar ou operar um projeto standalone.

Ao concluir a configuração inicial do app, o usuário deve seguir por uma de duas entradas:

```text
Começar no COIAB
      │
      ├── Criar nova organização
      └── Entrar em organização existente
```

Não deve existir criação automática de projeto pessoal/default.

Operações que conceitualmente pertencem à Organização devem ser implementadas como **orquestração frontend de operações project-level existentes**:

```text
COIAB Organization
       │
       ├── identidade / agrupamento
       ├── navegação
       ├── criação
       ├── convite / entrada
       └── configurações compartilhadas
              │
              ├── Monitoramento (CoMapeo Project)
              └── Alertas       (CoMapeo Project)
                         │
                         └── CoMapeo Core existente
```

Isso implica, por exemplo:

```text
"Convidar para a organização"
          │
          ├── invite Monitoramento
          └── invite Alertas
```

E no aparelho receptor:

```text
2 convites CoMapeo correlacionados
          │
          ▼
"Entrar na organização"
          │
          ├── accept invite Monitoramento
          └── accept invite Alertas
```

O usuário executa **uma ação**. O COIAB executa **duas operações CoMapeo** internamente.

A issue #46 não deve mais decidir se Organização será uma entidade de backend. A decisão arquitetural do MVP é implementar a Organização como composição frontend usando as primitives existentes do CoMapeo e `projectDescription` como canal de identidade. O objetivo do spike é **provar as premissas técnicas dessa composição em execução real** e, se alguma premissa falhar, documentar exatamente a limitação reproduzível antes de propor mudança de Core/backend.

O caminho `frontend-only` é considerado viável se:

1. um dispositivo novo puder iniciar diretamente em `Criar organização` ou `Entrar em organização existente`, sem projeto pessoal/default;
2. os dois projetos puderem ser identificados como pertencentes à mesma Organização;
3. os dois convites puderem ser enviados para o mesmo dispositivo como uma única operação de produto;
4. os dois convites puderem ser agrupados no receptor antes do aceite;
5. um único botão puder aceitar os dois convites;
6. falhas parciais puderem ser retomadas sem duplicar projetos ou membership;
7. nenhuma mudança em Core, IPC, protobuf, sync ou backend for necessária.

---

## 1. Decisão arquitetural

### 1.1 Organização não é um novo backend object no MVP

Não criar inicialmente:

- API de Organização;
- banco de Organização;
- protocolo de membership de Organização;
- mecanismo de sync de Organização;
- servidor de Organização;
- entidade paralela que replique dados dos projetos.

O dado operacional continua pertencendo aos projetos CoMapeo. Esses projetos são infraestrutura interna da Organização, não uma alternativa de produto paralela.

### 1.2 Organização é uma composição

Modelo conceitual:

```ts
type OrganizationProjectSlot = 'monitoramento' | 'alertas';

type Organization = {
  id: string;
  name: string;
  projects: {
    monitoramento: string;
    alertas: string;
  };
};
```

A issue #24 continua responsável por definir o modelo definitivo. Este tipo descreve apenas a composição que a #46 precisa provar.

### 1.3 Organização é o estado raiz do produto

Nesta versão do app, não existe um modo de uso baseado em projeto standalone.

Depois da configuração básica do dispositivo, o app deve exigir uma Organização ativa ou um fluxo para obtê-la:

```text
dispositivo configurado
        │
        ▼
possui Organização?
   │             │
  sim           não
   │             │
   ▼             ▼
abrir org    Criar organização
             ou
             Entrar em organização existente
```

Consequências:

- não criar projeto pessoal/default;
- não oferecer `Criar projeto` como entrada principal;
- não oferecer `Entrar em projeto` como jornada de produto;
- não exigir compatibilidade de UX com projetos CoMapeo standalone;
- permitir que `Monitoramento` e `Alertas` continuem sendo projetos reais internamente;
- permitir múltiplas Organizações: entrar em uma segunda Organização é permitido e a UI renderiza todas as reconstruídas (política definitiva de multi-org em #25);
- considerar uma Organização incompleta como estado transitório — durante provisioning/join ou após degradação por remoção de slot — nunca como modo normal de uso.

### 1.4 Operações org-level são fan-out/fan-in

Regra geral:

```text
Organization operation
        │
        ▼
resolve organization projectIds
        │
        ├── operation(projectId A)
        └── operation(projectId B)
        │
        ▼
aggregate result
```

Exemplos:

- criar Organização → criar dois projetos;
- convidar para Organização → enviar dois project invites;
- aceitar Organização → aceitar dois project invites;
- configurar Remote Archive → configurar os dois projetos;
- trocar área de trabalho → trocar `activeProjectId`.

O fato de uma API existente operar em apenas um `projectId` **não é um bloqueio arquitetural**. É a primitiva que a camada Organization deve compor.

---

## 2. Fonte de verdade atual

O escopo atual do MVP possui **dois projetos fixos por Organização**:

1. `Monitoramento`
2. `Alertas`

Documentos antigos que descrevem quatro projetos não são mais fonte de verdade para este spike.

### Issues desbloqueadas por esta prova

- #24 — modelo mínimo de Organização;
- #26 — criação de Organização;
- #27 — entrada por convite;
- #28 — rotas/contexto de Organização;
- #31 — materialização automática dos projetos;
- #32/#33 — navegação e troca entre Monitoramento/Alertas;
- #35/#36/#37 — Remote Archive no nível da Organização.

---

## 3. Fatos já confirmados no código

### 3.1 O app já opera a partir de `activeProjectId`

`ActiveProjectIdStoreContext.tsx` persiste o projeto ativo e permite trocar esse ID.

A camada Organization pode ficar acima disso:

```text
Organization XYZ
├── Monitoramento -> projectId A
└── Alertas       -> projectId B
                         │
                         ▼
                  activeProjectId
                         │
                         ▼
                  app CoMapeo atual
```

Não é necessário ensinar observações, tracks, sync e telas existentes sobre Organização.

### 3.2 A troca de projeto já existe

O app já usa `setActiveProjectId(targetProjectId)` para alternar projetos.

A navegação COIAB entre `Monitoramento` e `Alertas` deve reutilizar essa primitiva e preservar proteções existentes, como impedir troca durante tracking ativo.

### 3.3 Criação de projeto já existe

`@comapeo/core-react` expõe `useCreateProject()` e o Core já aceita settings de projeto como nome, cor, descrição (`projectDescription`) e config (`configPath`).

Criar uma Organização pode ser composição de duas chamadas existentes.

### 3.4 `useSendInvite` é project-scoped por design

`useSendInvite({ projectId })` obtém a API de um projeto e executa:

```ts
projectApi.$member.invite(deviceId, role)
```

Isso não exige que a UI exponha um convite por projeto.

A camada COIAB pode criar uma abstração como:

```ts
inviteToOrganization({ organizationId, deviceId, roleId })
```

que resolve os dois projetos e dispara os dois convites internamente.

Não há requisito de modificar `useSendInvite()` globalmente. Pode-se:

- compor duas instâncias do hook em uma camada superior; ou
- criar um hook/service COIAB que use diretamente as mesmas project APIs.

O spike deve escolher a implementação experimental mais simples.

### 3.5 O receptor consegue listar todos os convites

`useManyInvites()` retorna os convites recebidos pelo dispositivo — em **todos os estados**, não apenas pendentes. O agrupamento deve filtrar `state === 'pending'` antes de compor um bundle.

Portanto, a UI COIAB pode detectar um conjunto de convites relacionados e apresentar **uma única entrada de Organização**, em vez de abrir uma tela por projeto.

### 3.6 Aceite continua sendo individual, mas pode ser orquestrado

`useAcceptInvite()` recebe um `inviteId` e chama a API de aceite existente.

Logo:

```ts
acceptOrganizationInvite(bundle)
```

pode aceitar os dois `inviteId`s internamente.

Não é necessário um `acceptMany` no Core para proporcionar um único botão ao usuário.

### 3.7 `projectDescription` já atravessa o convite

No CoMapeo Core usado pelo app, o payload de convite já inclui `projectDescription`.

O sender lê esse valor das settings do projeto e o receiver recebe/persiste o mesmo valor ao adicionar o projeto.

Esse é o canal escolhido para carregar a metadata mínima de correlação entre os projetos da Organização. Nesta distribuição, `projectDescription` é reservado para o contrato interno do COIAB; não será criado outro campo de metadata para `organizationId` ou `slot`.

### 3.8 O projeto default legado deve ser removido do fluxo COIAB

`InviteReceived.tsx` cria hoje um projeto sem nome depois do aceite quando não existe um default project, por compatibilidade com versões antigas. Essa compatibilidade **não é requisito desta distribuição**.

O fluxo COIAB não deve executar esse comportamento e o onboarding não deve materializar previamente um projeto pessoal/default. A primeira unidade de trabalho válida do usuário é uma Organização.

Resultado esperado após entrar em uma Organização nova:

```text
Monitoramento
Alertas
```

E não:

```text
Monitoramento
Alertas
<projeto default sem nome>
```

### 3.9 A UI existente de edição pode destruir o marker

`EditProjectDetails.tsx` permite editar `projectDescription` de qualquer projeto via `useUpdateProjectSettings`, gravando no doc sincronizado `projectSettings`. Uma edição legítima apaga ou altera o marker COIAB em **todos os dispositivos** do projeto, sem canal de recuperação. A tela também exibiria o valor técnico do marker ao usuário, o que 4.3 proíbe.

Além da edição, o marker seria **exibido** ao usuário em `ProjectSettings/index.tsx` e `DrawerMenu.tsx` (que renderizam `projectDescription`). O COIAB não deve renderizar o valor bruto do marker em nenhuma superfície.

### 3.10 Saída/remoção de projeto materializa standalone

`RemovedFromProjectBottomSheet.tsx` cria e ativa um projeto sem nome quando o usuário sai ou é bloqueado de um projeto e não existe projeto default (`projects.find(p => !p.name)`). Em COIAB todos os projetos internos têm nome, então esse caminho sempre materializaria um standalone, contradizendo 1.3. Disparado tanto pelo fluxo de leave quanto pelo listener de remoção (`ProjectRemovalListener`).

### 3.11 Auditoria de superfícies standalone

Superfícies existentes que criam ou expõem jornada standalone: `InviteReceived.tsx` (3.8), `MapOnYourOwnIntro.tsx` (`createProject(undefined)` no onboarding), `RemovedFromProjectBottomSheet.tsx` (3.10), `Collaborate.tsx` (entradas `Join a Project` / `Start New Project`), `AllProjects.tsx` (botão `New Collaboration` — substituição é #32/#33) e `LeaveProject.tsx` (o active ID pode permanecer apontando para o projeto deixado). O spike E6 deve verificar que a jornada COIAB não passa por nenhuma criação standalone e que nenhuma dessas superfícies é alcançável como produto.

---

## 4. Identidade e correlação da Organização

Para mascarar dois convites como um único convite de Organização, o receptor precisa reconhecer que ambos pertencem ao mesmo grupo.

### 4.1 Decisão de implementação

Usar um marcador versionado e reservado em `projectDescription`. Esta é uma decisão do produto/arquitetura para esta versão, não uma alternativa provisória do spike.

Formato mínimo sugerido:

```text
coiab-org:v1:<organizationId>:m:<organizationName>
coiab-org:v1:<organizationId>:a:<organizationName>
```

Onde:

- `coiab-org` identifica metadata COIAB;
- `v1` versiona o formato;
- `organizationId` correlaciona projetos;
- `m` = Monitoramento;
- `a` = Alertas;
- `organizationName` = nome da Organização, sanitizado (sem `:`, codificado se necessário).

`organizationId` deve ser compacto (ex.: 16 chars hex): o campo tem limite de 60 chars na UI de edição e limite de schema não documentado — com UUID de 36 chars quase não sobra espaço para o nome. E3 verifica o limite real. O limite que de fato vincula o marker é o do schema/doc; os 60 chars da UI vinculam apenas o formulário de edição, que o COIAB remove para projetos internos (3.9) — não truncar nomes contra o limite errado.

O formato exato pode mudar durante o spike, desde que continue:

- versionado;
- estrito;
- pequeno;
- inequivocamente reconhecível;
- contendo pelo menos `organizationId`, `slot` e nome da Organização;
- cabendo no campo junto com o nome (limite de UI: 60 chars).

### 4.2 O que não deve entrar nesse marcador ainda

Não colocar prematuramente:

- estado completo da Organização;
- membros;
- Remote Archive;
- permissões próprias;
- categorias;
- dados replicados dos projetos.

A metadata serve apenas para **identidade e composição**.

### 4.3 `projectDescription` é parte do contrato interno COIAB

Nesta distribuição, projetos standalone não são um conceito de produto e a descrição humana de cada projeto interno não é requisito. Portanto, `projectDescription` pode ser reservado para identificar a composição da Organização.

O app deve:

- escrever apenas markers COIAB versionados nesse campo para os projetos internos da Organização;
- interpretar apenas formatos reconhecidos e válidos;
- não depender de um campo novo no schema/Core;
- não expor esse valor técnico como descrição de projeto para o usuário.

Se o formato precisar evoluir, a evolução deve acontecer pelo versionamento do próprio marker em `projectDescription`, por exemplo `coiab-org:v2:...`, e não pela criação de uma segunda metadata de Organização.

A UI existente de edição de detalhes (`EditProjectDetails`) grava nesse campo. Para projetos internos COIAB, essa edição deve ser restringida/removida ou tornada marker-preserving (ver 3.9 e 19). O produto não deve expor o marker em nenhum campo editável.

### 4.4 Nome da Organização: transporte e mutabilidade

O nome vive no marker (decisão do MVP). Consequências:

- renomear a Organização é uma ação org-level que reescreve o marker nos dois projetos (fan-out marker-preserving, trocando apenas o segmento do nome); consistência é eventual (doc sincronizado, last-write-wins);
- a reconstrução lê o nome de qualquer slot; durante a propagação de um rename os dois slots podem divergir — escolha determinística (ex.: slot `monitoramento` vence) e re-resolver após sync;
- o bundle de convite exibe o nome lido do marker do invite pendente;
- clients CoMapeo legados podem editar `projectDescription` e destruir o nome junto com o marker — risco aceito e documentado (19), sem auto-reparo no MVP.

---

## 5. Criação de Organização

### Experiência do usuário

```text
Criar organização
      │
      ▼
[uma ação]
      │
      ▼
Organização pronta
```

### Implementação esperada

```text
generate organizationId
        │
        ├── createProject("Monitoramento", marker orgId:m)
        └── createProject("Alertas", marker orgId:a)
        │
        ▼
persist/reconstruct mapping
        │
        ▼
setActiveProjectId(Monitoramento)
```

O marker é definido **na criação** — `createProject({projectDescription: marker})` — e não via update posterior: uma única escrita, e é exatamente esse valor que viaja no convite (3.7).

A criação das duas entidades não precisa ser atomicamente suportada pelo Core.

A camada Organization deve tratar estados intermediários:

```ts
'transient' | 'ready' | 'error'
```

Se um projeto for criado e o segundo falhar, o retry deve criar apenas o slot faltante.

A implementação de produção dessa recuperação pertence à issue de provisioning, mas o spike deve demonstrar que ela é possível.

---

## 6. Convite de Organização

### 6.1 Experiência de produto

O usuário convidador deve executar uma única ação:

```text
[ Convidar para a organização ]
```

Ele não deve selecionar ou enviar `Monitoramento` e `Alertas` separadamente.

### 6.2 Orquestração interna

Abstração conceitual:

```ts
inviteToOrganization({
  organizationId,
  deviceId,
  roleId,
});
```

Internamente:

```text
resolve Monitoramento projectId
resolve Alertas projectId
          │
          ├── project M -> member.invite(deviceId)
          └── project A -> member.invite(deviceId)
```

O spike deve testar envio **paralelo ou imediatamente concorrente** dos dois convites.

A API `invite()` de cada projeto continua responsável pelo ciclo de vida daquele project invite. A camada COIAB agrega os dois resultados.

### 6.3 Estado agregado no sender

Conceitualmente:

```ts
type OrganizationInviteProgress = {
  monitoramento: 'pending' | 'accepted' | 'rejected' | 'error';
  alertas: 'pending' | 'accepted' | 'rejected' | 'error';
};
```

A UI não precisa mostrar esse detalhe. Pode exibir estados como:

```text
Enviando convite…
Aguardando resposta…
Convite aceito
Não foi possível concluir
```

O `invite()` de cada projeto aguarda a resposta do receptor (timeout de sync inicial, padrão ~5s) e rejeita no timeout. **Timeout de resposta não é falha de envio**: o receptor pode manter um convite pendente válido. A agregação deve distinguir `timeout` de `error`, e o retry do slot deve ser idempotente — convite já pendente no receptor não deve ser duplicado.

### 6.4 Não exigir atomicidade do protocolo

Dois project invites continuam sendo duas operações independentes.

O objetivo não é transformar o protocolo em uma transação distribuída. O objetivo é esconder essa granularidade atrás de uma operação de produto recuperável.

### 6.5 Retry, duplicatas e reemissão (semântica real do Core)

Fatos que a orquestração precisa respeitar:

- cada envio gera um `inviteId` aleatório novo; o receptor deduplica apenas por `inviteId` — um retry do sender pode produzir **dois invites pendentes do mesmo slot**;
- o agrupamento do bundle deve colapsar duplicatas por slot (um pendente por slot, o mais recente vence por `receivedAt`; empate no mesmo milissegundo resolvido comparando `inviteId`), usando o slot do marker;
- invites pendentes vivem **apenas em memória** no receptor: reiniciar o app descarta invites pendentes, então um bundle incompleto pós-restart não completa sem reemissão;
- aceite que termina em erro é estado final daquele invite; re-aceitá-lo falha.

Consequência: a recuperação org-level de falha de envio é uma ação do sender — `Convidar novamente` — que reemite **apenas o slot faltante**; o receptor colapsa duplicatas por slot e a operação é idempotente na prática. Recuperação puramente receiver-side não existe para invites perdidos por reinício ou em estado terminal.

---

## 7. Recebimento e agrupamento dos convites

### 7.1 O receptor não deve abrir imediatamente um invite por projeto

Ao receber um invite reconhecido como COIAB Organization, o app deve consultar os convites pendentes e agrupá-los.

Chave mínima recomendada de agrupamento:

```text
organizationId
+ invitorDeviceId
+ versão do marker
```

E validar os slots esperados:

```text
Monitoramento
Alertas
```

### 7.2 Bundle conceitual

```ts
type OrganizationInviteBundle = {
  organizationId: string;
  invitorDeviceId: string;
  invites: {
    monitoramento?: string;
    alertas?: string;
  };
};
```

Quando ambos estiverem disponíveis:

```text
invite M ─┐
          ├── OrganizationInviteBundle XYZ
invite A ─┘
```

### 7.3 Experiência do usuário

Mostrar uma única superfície:

```text
Você foi convidado para
Organização XYZ

[ Recusar ]
[ Entrar na organização ]
```

Não mostrar:

```text
Join Monitoramento
Join Alertas
```

### 7.4 Convite incompleto

Como os dois convites trafegam separadamente, um pode chegar antes do outro.

Nesse caso, o estado deve ser interpretado como **bundle incompleto**, não como convite independente normal.

Exemplo:

```text
1/2 convite recebido
      ↓
"Preparando convite…"
      ↓
2/2 convites recebidos
      ↓
mostrar "Entrar na organização"
```

O spike não precisa definir o timeout final de UX, mas deve provar que a UI consegue distinguir:

- bundle incompleto;
- bundle completo;
- invite CoMapeo comum não-COIAB.

Convite em estado terminal não-pendente (cancelado/erro) não é atraso: é bundle **definitivamente** incompleto. A UI deve distinguir incompleto transitório (aguardando o segundo convite) de definitivo (nunca completará; reportar erro).

---

## 8. Aceite único da Organização

### 8.1 Uma única decisão explícita

O usuário toca uma vez:

```text
[ Entrar na organização ]
```

A camada COIAB executa:

```text
accept invite Monitoramento
accept invite Alertas
```

### 8.2 Orquestração conceitual

```ts
async function acceptOrganizationInvite(bundle) {
  // aceitar apenas os slots ainda ausentes
}
```

O código real não precisa seguir essa assinatura, mas deve possuir uma unidade clara responsável por coordenar o bundle.

### 8.3 Estado parcial é permitido internamente

Pode ocorrer:

```text
Monitoramento -> accepted
Alertas       -> network error
```

Isso não é um estado final válido de Organização, mas também não deve resultar em rollback destrutivo do primeiro projeto.

Representar como:

```text
joining / incomplete
```

E no retry:

```text
Monitoramento -> já presente, não repetir
Alertas       -> tentar novamente
```

Se o invite do slot faltante estiver em estado terminal (erro) ou foi perdido por reinício do app, o aceite não pode ser retomado localmente: a recuperação exige reemissão pelo sender (6.5). Aceitar apenas invites pendentes válidos.

### 8.4 Estado `ready`

Uma Organização só fica pronta quando os dois slots esperados estiverem associados localmente:

```text
Monitoramento ✓
Alertas       ✓
       ↓
Organization ready
```

### 8.5 Segurança de agrupamento

Nunca aceitar automaticamente convites arbitrários apenas porque carregam o mesmo `organizationId`.

Para compor um bundle, validar pelo menos:

- marker COIAB válido e versão suportada;
- mesmo `organizationId`;
- mesmo `invitorDeviceId`;
- mesmo `roleName` nos dois convites — paridade real de `roleId` não é verificável no receptor (o wire carrega apenas `roleName`, customizável); a paridade é garantida por construção: a ação org-level usa um único `roleId` no fan-out;
- slots distintos e esperados;
- nenhum slot duplicado;
- convite ainda pendente;
- projeto desse slot ainda não associado localmente.

O **único aceite automático** permitido é o disparado pela ação explícita `Entrar na organização` sobre um bundle já validado.

### 8.6 `activeProjectId` pós-entrada

Após o aceite, o app deve executar explicitamente `setActiveProjectId(Monitoramento)`. O fallback atual do store de projeto ativo escolhe `projects[0]` em ordem arbitrária de banco; o COIAB não deve depender dele. Ao entrar em uma segunda Organização, qual projeto fica ativo é decisão de #25; o spike garante apenas que algum slot válido é ativado.

---

## 9. Não há fluxo de projeto standalone no produto

O COIAB não precisa preservar a jornada legada de convite para projeto como uma experiência de produto suportada.

Para esta versão:

```text
convite válido de uso do COIAB
        │
        ▼
Organization Invite Bundle
        │
        ▼
Entrar na organização
```

Projetos continuam sendo a primitive técnica usada pelo Core, inclusive para transportar os dois convites que compõem o bundle. Porém, a UI não precisa oferecer uma rota alternativa como `Join Project` para convites sem metadata de Organização.

Durante o spike, um invite que não possa ser reconhecido com segurança como parte de uma Organização pode ser tratado como **não suportado pelo produto COIAB** em vez de cair no fluxo legado. O comportamento final de erro/rejeição pode ser definido pelas issues de onboarding/invite.

Essa decisão reduz o escopo de compatibilidade e evita manter duas abstrações concorrentes — Project e Organization — na experiência do usuário.

---

## 10. Reconstrução após reinício

A Organização não deve depender exclusivamente de um objeto local criado durante onboarding.

Ao iniciar o app, deve ser possível:

```text
listProjects()
     │
     ▼
parse COIAB markers
     │
     ▼
group by organizationId
     │
     ▼
resolve slots
     │
     ▼
Organization mapping
```

Exemplo:

```text
Project ABC
  marker = coiab-org:v1:XYZ:m

Project DEF
  marker = coiab-org:v1:XYZ:a

          ↓

Organization XYZ
├── monitoramento: ABC
└── alertas: DEF
```

Múltiplas Organizações podem coexistir: o mapping é uma **coleção** de Organizações, não um singleton. Entrar em uma segunda Organização é permitido no MVP e a UI renderiza todas as reconstruídas. A política definitiva de multi-org é #25.

Um store local pode existir como cache/contexto de UI, mas não deve ser a única informação capaz de reconstruir a associação se o marcador funcionar.

A decisão final sobre persistência pertence à #24.

### 10.1 Resolução na inicialização (máquina de estados raiz)

Na inicialização, antes de qualquer `activeProjectId` ser tratado como utilizável, o app resolve o mapping de Organizações e navega conforme:

```text
nenhuma organização      -> onboarding org-first
organização incompleta   -> tela transitória de provisioning/join (nunca Home)
organização ready        -> UI de Organização
```

- o fallback atual do store (escolher `projects[0]`) não pode decidir a entrada: hoje um restart com apenas um slot criado/aceito entraria em `Home` como se nada faltasse;
- o gate de navegação atual (baseado em `deviceInfo.name` + `activeProjectId`) precisa ser estendido para consultar o estado da Organização;
- markers duplicados para o mesmo slot, ou marker com versão não suportada: **falhar fechado** — Organização marcada `incomplete`, erro superficiado, nenhuma escolha silenciosa.

---

## 11. Remote Archive como prova de fan-out

Remote Archive já é configurado por `projectId`.

Para o usuário:

```text
Configurar Remote Archive da organização
```

Internamente:

```text
addServerPeer(projectId Monitoramento, url)
addServerPeer(projectId Alertas, url)
```

O spike deve demonstrar que isso pode ser feito usando as APIs existentes. A tela existente configura o projeto **ativo**. Para o fan-out, o spike usa as **manager APIs diretamente**, sem alternar `activeProjectId` — o mesmo padrão de orquestração endossado em 3.4.

Não é necessário implementar toda a UX final de Remote Archive na #46.

O valor deste teste é comprovar a regra geral:

> uma configuração org-level pode ser materializada como fan-out para os projetos que compõem a Organização.

---

## 12. Decisão fechada: sem metadata dedicada

A associação entre Organização e projetos — `organizationId`, `slot` e nome — será codificada em `projectDescription`. Não faz parte do escopo criar esses campos ou `OrganizationMetadata` como novos campos em `@comapeo/schema`, `@comapeo/core`, IPC ou protobuf.

O spike deve validar o uso desse canal existente e, se encontrar um problema no formato do marker, ajustar o **encoding/versionamento dentro de `projectDescription`**, mantendo a mesma superfície de dados.

Esta decisão reforça o objetivo de minimizar mudanças no Core: a camada Organization deve ser implementada como composição e orquestração no app sobre primitives existentes.

---

## 13. Perguntas que o spike ainda precisa responder

A arquitetura de produto já está escolhida. As perguntas restantes são de **validação técnica**, não de direção arquitetural.

### Q1 — Dois project invites podem permanecer pendentes simultaneamente para o mesmo dispositivo?

Esperado: sim, porque são operações pertencentes a project APIs distintas.

Provar em execução real.

### Q2 — O receptor possui toda a metadata necessária antes do aceite?

Esperado: `projectDescription` (marker com `organizationId` + slot + nome) + identidade do convidador são suficientes para formar o bundle.

Provar no objeto real retornado por `useManyInvites()`.

### Q3 — Os dois convites podem ser agrupados de forma determinística e segura?

Provar parser, slots, identificação do sender e comportamento com invites inválidos/duplicados.

### Q4 — Um único botão consegue aceitar todo o bundle sem alteração no Core?

Esperado: sim, coordenando as chamadas individuais de `accept(inviteId)`.

Provar em dois dispositivos.

### Q5 — Como o app se recupera quando apenas uma das duas operações conclui?

Provar retry idempotente do slot faltante tanto no envio quanto no aceite — incluindo o colapso de invites duplicados do mesmo slot e o caso de reinício do app entre a falha e o retry (invites pendentes não sobrevivem ao reinício; provar que a reemissão pelo sender resolve — 6.5).

### Q6 — Um dispositivo novo consegue começar diretamente em Organization sem projeto pessoal/default?

Provar que o onboarding pode oferecer apenas `Criar organização` ou `Entrar em organização existente`, e que ambos terminam sem materializar projeto standalone extra.

Essas são as únicas perguntas estruturais que devem impedir um veredito `FRONTEND_ONLY_VIABLE`. A escolha de um campo de metadata não é mais uma pergunta aberta: o campo é `projectDescription`.

---

## 14. Experimentos obrigatórios

### E1 — Criar e reconstruir Organização

1. Gerar um `organizationId`.
2. Criar `Monitoramento` e `Alertas` como projetos normais.
3. Aplicar marker de `organizationId + slot`.
4. Reiniciar/recarregar o app.
5. Reconstruir a Organização a partir da listagem de projetos.

**Passa se:** os mesmos dois project IDs forem reconstruídos sob a mesma Organização sem entidade backend nova.

---

### E2 — Trocar entre os dois projetos

1. Reconstruir a Organização.
2. Ativar Monitoramento.
3. Trocar para Alertas.
4. Trocar de volta.
5. Verificar proteção de tracking existente.

**Passa se:** apenas `activeProjectId`/mecanismo existente for necessário.

---

### E3 — Round-trip da metadata

1. Criar projeto com marker em `projectDescription`.
2. Ler localmente.
3. Enviar invite para segundo dispositivo.
4. Inspecionar invite antes do aceite.
5. Aceitar.
6. Ler o projeto aceito via `useManyProjects()` **pós-sync** (doc `projectSettings` sincronizado) — não a cópia transportada no invite; é a fonte pós-sync que a reconstrução (seção 10) consome.

**Passa se:** `organizationId + slot + nome` estiverem disponíveis antes e depois do aceite sem Core patch, e `createProject({projectDescription: marker})` passar na validação de schema (limite de tamanho não documentado; marker com nome deve caber no limite da UI de edição de 60 chars — usar `organizationId` compacto).

---

### E4 — Um botão envia dois convites

No dispositivo A:

1. abrir uma Organização válida;
2. tocar uma vez em `Convidar`;
3. disparar os dois project invites para B;
4. manter/agregar o estado das duas operações.

No dispositivo B:

5. confirmar que ambos podem coexistir como pending invites.

**Passa se:** uma única ação de produto resultar em dois invites pendentes reconhecíveis, sem exigir que o usuário repita a ação.

---

### E5 — Um botão aceita a Organização

No dispositivo B:

1. detectar os dois invites;
2. agrupá-los em um bundle;
3. mostrar uma única superfície;
4. tocar uma vez em `Entrar na organização`;
5. aceitar os dois invite IDs;
6. reconstruir os dois projetos como uma Organização.

**Passa se:** o usuário tomar uma única decisão explícita e terminar membro dos dois projetos.

---

### E6 — Onboarding Organization-first, sem projeto pessoal/default

Em um dispositivo novo:

1. concluir a configuração básica do app;
2. verificar que não é criado projeto pessoal/default;
3. verificar que a próxima decisão é `Criar organização` ou `Entrar em organização existente`;
4. completar uma das jornadas;
5. inspecionar os projetos locais.

**Passa se:** antes de uma Organização não existir projeto standalone automático e, após concluir a jornada, existirem apenas os projetos internos esperados da Organização.

---

### E7 — Falha parcial e retry

Forçar falha após apenas uma das operações concluir.

Testar pelo menos:

```text
sender:
M invite iniciado
A invite falha

receiver:
M accepted
A accept falha
```

Depois retomar.

**Passa se:**

- o estado não for marcado como `ready` prematuramente;
- o slot concluído não for duplicado;
- apenas o slot faltante for repetido;
- invites duplicados do mesmo slot são colapsados no bundle (um pendente por slot);
- após reinício do receptor com bundle incompleto, a reemissão do sender completa a Organização;
- a Organização chegar a `ready` depois da recuperação.

---

### E8 — Remote Archive fan-out

Com uma Organização contendo dois project IDs:

1. executar a mesma configuração de Remote Archive para ambos, via manager APIs diretamente (sem alternar `activeProjectId`);
2. verificar sucesso nos dois projetos;
3. registrar como o resultado é agregado.

**Passa se:** nenhuma API org-level/backend nova for necessária.

---

## 15. Critérios de aceitação da #46

- [ ] Organização é demonstrada como composição de dois projetos CoMapeo existentes.
- [ ] Organization é o estado raiz do produto; não existe jornada suportada de projeto standalone.
- [ ] `Monitoramento` e `Alertas` carregam uma identidade comum de Organização e slots distintos.
- [ ] A composição pode ser reconstruída após reiniciar o app.
- [ ] Alternância entre os projetos reutiliza `activeProjectId` e comportamento existente.
- [ ] Uma única ação `Convidar para a organização` dispara os dois project invites.
- [ ] Os dois invites podem coexistir no receptor e ser agrupados como um único bundle.
- [ ] A UI de produto não expõe fluxo de projeto standalone; invites válidos são tratados no contexto de uma Organização (substituição da listagem crua de projetos é #32/#33, fora do spike).
- [ ] Uma única ação `Entrar na organização` aceita os dois convites relacionados.
- [ ] Agrupamento valida `organizationId`, sender e slots esperados.
- [ ] Falha parcial no envio ou aceite é recuperável e não duplica o slot concluído.
- [ ] Organização só entra em `ready` quando os dois projetos estão presentes.
- [ ] Um dispositivo novo não recebe projeto pessoal/default automático e entra no fluxo `Criar organização` ou `Entrar em organização existente`.
- [ ] Editar detalhes de um projeto interno não destrói o marker (edição restrita/removida ou marker-preserving).
- [ ] Nenhuma superfície de UI renderiza o marker bruto (incluindo ProjectSettings e DrawerMenu).
- [ ] Sair ou ser removido de um projeto da Organização não materializa projeto standalone.
- [ ] Reinício do receptor com bundle incompleto é recuperável pela reemissão do sender.
- [ ] A inicialização resolve o estado da Organização (nenhuma / incompleta / ready) antes de qualquer Home.
- [ ] Remote Archive org-level pode ser demonstrado como fan-out para os dois projetos.
- [ ] Nenhuma mudança em sync, storage ou membership protocol foi necessária.
- [ ] Para `FRONTEND_ONLY_VIABLE`, nenhuma alteração em `src/backend` nem fork de dependência é necessária.
- [ ] O spike termina com evidência reproduzível e um veredito explícito.

---

## 16. Veredito

### A — `FRONTEND_ONLY_VIABLE`

Usar quando todos os comportamentos obrigatórios puderem ser implementados por composição/orquestração no app.

Isso inclui:

```text
Organization
  -> projects
  -> invites
  -> accepts
  -> activeProjectId
  -> Remote Archive fan-out
```

sem mudança em Core/protocolo/backend.

**Resultado:** seguir com #24 e issues dependentes assumindo Organization como camada frontend sobre projetos.

### B — `FRONTEND_ONLY_NOT_VIABLE`

Usar somente se os experimentos demonstrarem uma limitação estrutural que não possa ser resolvida pela composição/orquestração frontend usando as primitives existentes e `projectDescription` como canal de identidade da Organização.

O relatório deve identificar exatamente:

- qual operação falhou;
- por que frontend não consegue orquestrá-la;
- qual capability nova seria necessária;
- quais issues precisam ser reestimadas.

Não usar este veredito apenas porque duas operações project-level não são atômicas. Falha parcial recuperável é aceita pela arquitetura.

---

## 17. Evidência esperada

O spike deve deixar:

1. branch/commit experimental identificável;
2. demonstração do onboarding Organization-first em dispositivo novo;
3. lista de arquivos alterados;
4. testes do parser/encoder da metadata;
5. teste de agrupamento de invite bundles;
6. demonstração em dois dispositivos/emuladores;
7. evidência de um único botão enviando os dois convites;
8. evidência de um único botão aceitando os dois convites;
9. teste de falha parcial + retry;
10. evidência de ausência de projeto pessoal/default;
11. prova de Remote Archive fan-out;
12. resultado de lint/testes relevantes;
13. documento curto de veredito.

Comandos mínimos de verificação, adaptados se necessário:

```bash
npm run lint
npm run test:jest -- <testes relevantes>
git diff -- src/backend
```

Para `FRONTEND_ONLY_VIABLE`, o último comando deve permanecer vazio.

---

## 18. Não objetivos

A #46 não deve implementar a versão final de:

- modelo de Organization (#24);
- política de múltiplas organizações (#25);
- design visual final do onboarding Organization-first (#26/#27);
- design final de navegação (#32/#33);
- substituição da listagem crua de projetos (`AllProjects`) — durante o spike permanece alcançável como ferramenta de debug e E6 não falha por sua reachability; esconder/substituir é #32/#33;
- templates/configs finais dos projetos (#30/#31);
- Remote Archive org-level completo (#35/#36/#37);
- permissões próprias da Organização;
- migration strategy ampla;
- novo servidor/backend.

O código experimental pode ser descartável desde que prove as premissas.

---

## 19. Riscos e limites conhecidos

### Dois convites continuam sendo duas operações

Isso é esperado.

A camada Organization mascara a granularidade e fornece recuperação. Não precisamos de atomicidade distribuída para o MVP.

### Um invite pode chegar antes do outro

O receptor precisa suportar `bundle incomplete` antes de apresentar o aceite final.

### Um aceite pode concluir antes do outro

O estado local deve suportar `joining/incomplete` e retry apenas do slot faltante.

### Metadata em `projectDescription`

É uma decisão desta distribuição. Como projetos internos não são expostos como objetos de produto independentes, `projectDescription` fica reservado ao marker COIAB. O risco a tratar é robustez do parser e versionamento do formato, não a criação de outro campo.

### Marker pode ser falsificado por um sender

Por isso o agrupamento não deve confiar apenas no `organizationId`. Deve validar sender, slots e estado da transação/bundle.

### A UI de edição pode destruir o marker

`EditProjectDetails` grava `projectDescription` no doc sincronizado. Qualquer coordenador, em qualquer client, editando esse doc apaga o marker em todos os dispositivos. O COIAB deve restringir essa edição para projetos internos ou torná-la marker-preserving; sem isso, a reconstrução da seção 10 perde o canal de identidade. Marker perdido ou alterado em um slot degrada a Organização para `incomplete`, sem auto-reparo no MVP; renomear a Organização reescreve o marker nos dois slots (4.4) e divergência temporária entre slots é resolvida deterministicamente.

### Saída/remoção materializa standalone

O caminho atual de leave/remoção cria e ativa um projeto sem nome (3.10). O COIAB deve tratar remoção de slot como degradação da Organização (ready → incomplete), sem materializar standalone. Escopo decidido para o spike — o mínimo: interceptar o auto-create e marcar a Organização como `incomplete`. UX de degradação e rejoin pertencem às issues de produto.

### Compatibilidade com projeto standalone não é requisito

Esta distribuição pode deliberadamente remover ou deixar inacessíveis as jornadas legadas de criação/entrada em projeto standalone. O requisito é preservar as primitives de projeto necessárias para implementar Organizações, não preservar a UX original do CoMapeo.

---

## 20. Arquitetura recomendada após o spike

Se o veredito for A ou B, a direção para as próximas issues é:

```text
                    COIAB PRODUCT LAYER

                     Organization
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
  provisioning           invites        shared settings
       │                  │                  │
 create 2 projects    send/accept 2x      fan-out 2x
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                resolve project slots
                          │
            ┌─────────────┴─────────────┐
            │                           │
     Monitoramento                  Alertas
      projectId A                  projectId B
            │                           │
            └─────────────┬─────────────┘
                          │
                    CoMapeo Core
```

A regra de implementação para o MVP passa a ser:

> **Antes de criar uma capability nova no Core, verificar se a operação de Organização pode ser expressa como composição das capabilities project-level existentes.**

---

## 21. Referências técnicas

### COIAB App

- Issue #46 — https://github.com/transistir/coiab-app/issues/46
- Issue #5 — https://github.com/transistir/coiab-app/issues/5
- Issue #24 — https://github.com/transistir/coiab-app/issues/24
- Issue #27 — https://github.com/transistir/coiab-app/issues/27
- Active project store — https://github.com/transistir/coiab-app/blob/develop/src/frontend/contexts/ActiveProjectIdStoreContext.tsx
- Root navigation — https://github.com/transistir/coiab-app/blob/develop/src/frontend/Navigation/Stack/index.tsx
- Project switching — https://github.com/transistir/coiab-app/blob/develop/src/frontend/screens/AllProjects.tsx
- Invite receiver — https://github.com/transistir/coiab-app/blob/develop/src/frontend/screens/Invites/InviteReceived.tsx
- Invite sender — https://github.com/transistir/coiab-app/blob/develop/src/frontend/screens/YourTeam/ReviewAndInvite/index.tsx
- Remote Archive — https://github.com/transistir/coiab-app/blob/develop/src/frontend/screens/RemoteArchive/AddRemoteArchive.tsx

### CoMapeo

- `@comapeo/core-react` v12.0.3 invite hooks — https://github.com/digidem/comapeo-core-react/blob/v12.0.3/src/hooks/invites.ts
- Invite protobuf — https://github.com/digidem/comapeo-core/blob/v7.4.0/proto/rpc.proto
- Invite receiver — https://github.com/digidem/comapeo-core/blob/v7.4.0/src/invite/invite-api.js
- Member/invite sender — https://github.com/digidem/comapeo-core/blob/v7.4.0/src/member-api.js
- Project manager — https://github.com/digidem/comapeo-core/blob/v7.4.0/src/mapeo-manager.js
- Project settings schema — https://github.com/digidem/schema/blob/main/schema/projectSettings/v1.json

---

## Decisão resumida para o agente executor

Não investigar primeiro uma nova entidade Organization no backend.

Implemente um spike que prove este fluxo:

```text
CREATE
1 Organization action
      -> create Monitoramento
      -> create Alertas

INVITE
1 Invite Organization action
      -> send project invite M
      -> send project invite A

RECEIVE
2 pending project invites
      -> parse same organizationId
      -> validate same sender + complementary slots
      -> show 1 Organization invite

ACCEPT
1 Join Organization action
      -> accept invite M
      -> accept invite A
      -> no personal/default project
      -> reconstruct Organization

USE
Organization UI
      -> activeProjectId M/A
      -> existing CoMapeo behavior

SHARED SETTINGS
1 Organization setting
      -> apply to project M
      -> apply to project A
```

Se isso funcionar sem alteração em Core/backend, registrar:

```text
FRONTEND_ONLY_VIABLE
```

Não existe veredito intermediário baseado em criar metadata dedicada: `organizationId + slot` devem usar `projectDescription`.

Se alguma limitação impedir essa composição mesmo usando o canal existente, registrar `FRONTEND_ONLY_NOT_VIABLE` com a falha reproduzível e a capability mínima que estaria faltando. Qualquer proposta de mudança em Core/backend deve ser justificada por essa evidência.
