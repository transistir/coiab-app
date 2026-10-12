import * as fs from 'node:fs';
import * as path from 'node:path';

// Greptile P1 (PR #112, thread 4237332040): as línguas preenchidas no
// Crowdin (de-DE, es-419, fr-FR, id-ID, ja-JP, nl-NL) devem conter toda
// chave `$1` referenciada por defineMessages das telas de onboarding.
// Quando a chave do componente não existe no catálogo de uma língua, o
// react-intl cai em fallback silencioso para o inglês e a tradução some.
// Histórico: commit 2f11cd0c renomeou as chaves de IntroToCoMapeo para
// "IntroToEkanâdyby" nesses 6 idiomas mas não no componente; app alemão
// etc. mostrava a tela em inglês. Os ids vivem no COMPONENTE
// (`$1screens.<NomeComponente>.*`); renomear tela é escopo da issue #111,
// então os catálogos é que devem apontar para o id atual do componente.
//
// Escopo do teste: apenas as 7 línguas preenchidas (as 6 + en-US/pt-BR).
// As outras ~40 de messages/ caem em fallback en via useLanguageQueries
// (merge en primeiro) e sua tradução parcial é esperado — não regressão.
// Baseline pré-existente: faltas anteriores a este PR vivem no piso
// PISO (abaixo) — dívida antiga fora do escopo; o teste detecta novas
// faltas com base no piso.
// Rode RED antes da correção dos catálogos e GREEN depois.
//
// NOTA: este teste é um snapshot de cobertura, não o gate do
// check-message-catalog (que compara messages/ com a saída do
// extrator); os dois são complementares.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

interface MensagemDefinida {
  id: string;
  defaultMessage: string;
}

/** Extrai os ids de defineMessages de um arquivo de tela (sem executá-lo).
 * Regex por par: `id: '<id>'` junto com `defaultMessage: '<msg>'` dentro do
 * mesmo objeto literal. Suficiente para o padrão consistente das telas. */
function idsDefineMessages(arquivo: string): MensagemDefinida[] {
  const fonte = fs.readFileSync(path.join(REPO_ROOT, arquivo), 'utf8');
  const resultados: MensagemDefinida[] = [];
  const re = /id:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fonte)) !== null) {
    const janela = fonte.slice(match.index, match.index + 400);
    const msgDefault =
      /defaultMessage:\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/.exec(janela);
    const id = match[1];
    if (!id) continue;
    resultados.push({
      id,
      defaultMessage: msgDefault?.[1] ?? msgDefault?.[2] ?? '',
    });
  }
  return resultados;
}

function chavesCatalogo(lingua: string): Set<string> {
  const caminho = path.join(REPO_ROOT, 'messages', lingua, 'primary.json');
  const catalogo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  return new Set(Object.keys(catalogo));
}

/** Línguas preenchidas no Crowdin: as 6 do fork de upstream + en-US e
 * pt-BR. As demais línguas de messages/ caem em fallback en via
 * useLanguageQueries (merge en primeiro), e sua tradução parcial é
 * esperado — não é regressão deste PR. */
const LINGUAS_TRADUZIDAS = [
  'de-DE',
  'es-419',
  'fr-FR',
  'id-ID',
  'ja-JP',
  'nl-NL',
  'pt-BR',
];

// Faltas pré-existentes à base do PR (#112): dívida antiga fora do escopo
// deste PR, apurada por diff. O piso TOLERA as faltas antigas por língua;
// o teste detecta NOVAS faltas com base nele.

const TELAS_ONBOARDING = ['src/frontend/screens/Onboarding/IntroToCoMapeo.tsx'];

// ids de telas/fluxos ainda sem tradução Crowdin nas 7 línguas: dívida
// preexistente da base do PR (#112), apurada por diff; o piso tolera as
// faltas antigas por língua para que o teste capture NOVAS faltas.
const PISO = {
  'de-DE': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.creationInProgress',
    '$1screens.Onboarding.CreateOrganization.tooLong',
    '$1screens.OrganizationSetup.createOrganization',
    '$1screens.OrganizationSetup.createIntroBody',
    '$1screens.OrganizationSetup.continueButton',
    '$1screens.OrganizationSetup.nameLabel',
    '$1screens.OrganizationSetup.nameGuidance',
    '$1screens.OrganizationSetup.nameNotIdentity',
    '$1screens.OrganizationSetup.emptyName',
    '$1screens.OrganizationSetup.pacoteNaoAprovado',
    '$1screens.OrganizationSetup.waitInviteTitle',
    '$1screens.OrganizationSetup.waitInviteBody',
    '$1screens.OrganizationSetup.backButton',
    '$1screens.OrganizationSetup.preparingTitle',
    '$1screens.OrganizationSetup.preparingStepA11y',
  ],
  'es-419': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.creationInProgress',
    '$1screens.Onboarding.CreateOrganization.tooLong',
    '$1screens.OrganizationSetup.createOrganization',
    '$1screens.OrganizationSetup.createIntroBody',
    '$1screens.OrganizationSetup.continueButton',
    '$1screens.OrganizationSetup.nameLabel',
    '$1screens.OrganizationSetup.nameGuidance',
    '$1screens.OrganizationSetup.nameNotIdentity',
    '$1screens.OrganizationSetup.emptyName',
    '$1screens.OrganizationSetup.pacoteNaoAprovado',
    '$1screens.OrganizationSetup.waitInviteTitle',
    '$1screens.OrganizationSetup.waitInviteBody',
    '$1screens.OrganizationSetup.backButton',
    '$1screens.OrganizationSetup.preparingTitle',
    '$1screens.OrganizationSetup.preparingStepA11y',
  ],
  'fr-FR': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.creationInProgress',
    '$1screens.Onboarding.CreateOrganization.tooLong',
    '$1screens.OrganizationSetup.createOrganization',
    '$1screens.OrganizationSetup.createIntroBody',
    '$1screens.OrganizationSetup.continueButton',
    '$1screens.OrganizationSetup.nameLabel',
    '$1screens.OrganizationSetup.nameGuidance',
    '$1screens.OrganizationSetup.nameNotIdentity',
    '$1screens.OrganizationSetup.emptyName',
    '$1screens.OrganizationSetup.pacoteNaoAprovado',
    '$1screens.OrganizationSetup.waitInviteTitle',
    '$1screens.OrganizationSetup.waitInviteBody',
    '$1screens.OrganizationSetup.backButton',
    '$1screens.OrganizationSetup.preparingTitle',
    '$1screens.OrganizationSetup.preparingStepA11y',
  ],
  'id-ID': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.creationInProgress',
    '$1screens.Onboarding.CreateOrganization.tooLong',
    '$1screens.OrganizationSetup.createOrganization',
    '$1screens.OrganizationSetup.createIntroBody',
    '$1screens.OrganizationSetup.continueButton',
    '$1screens.OrganizationSetup.nameLabel',
    '$1screens.OrganizationSetup.nameGuidance',
    '$1screens.OrganizationSetup.nameNotIdentity',
    '$1screens.OrganizationSetup.emptyName',
    '$1screens.OrganizationSetup.pacoteNaoAprovado',
    '$1screens.OrganizationSetup.waitInviteTitle',
    '$1screens.OrganizationSetup.waitInviteBody',
    '$1screens.OrganizationSetup.backButton',
    '$1screens.OrganizationSetup.preparingTitle',
    '$1screens.OrganizationSetup.preparingStepA11y',
  ],
  'ja-JP': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.creationInProgress',
    '$1screens.Onboarding.CreateOrganization.tooLong',
    '$1screens.OrganizationSetup.createOrganization',
    '$1screens.OrganizationSetup.createIntroBody',
    '$1screens.OrganizationSetup.continueButton',
    '$1screens.OrganizationSetup.nameLabel',
    '$1screens.OrganizationSetup.nameGuidance',
    '$1screens.OrganizationSetup.nameNotIdentity',
    '$1screens.OrganizationSetup.emptyName',
    '$1screens.OrganizationSetup.pacoteNaoAprovado',
    '$1screens.OrganizationSetup.waitInviteTitle',
    '$1screens.OrganizationSetup.waitInviteBody',
    '$1screens.OrganizationSetup.backButton',
    '$1screens.OrganizationSetup.preparingTitle',
    '$1screens.OrganizationSetup.preparingStepA11y',
  ],
  'nl-NL': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.creationInProgress',
    '$1screens.Onboarding.CreateOrganization.tooLong',
    '$1screens.OrganizationSetup.createOrganization',
    '$1screens.OrganizationSetup.createIntroBody',
    '$1screens.OrganizationSetup.continueButton',
    '$1screens.OrganizationSetup.nameLabel',
    '$1screens.OrganizationSetup.nameGuidance',
    '$1screens.OrganizationSetup.nameNotIdentity',
    '$1screens.OrganizationSetup.emptyName',
    '$1screens.OrganizationSetup.pacoteNaoAprovado',
    '$1screens.OrganizationSetup.waitInviteTitle',
    '$1screens.OrganizationSetup.waitInviteBody',
    '$1screens.OrganizationSetup.backButton',
    '$1screens.OrganizationSetup.preparingTitle',
    '$1screens.OrganizationSetup.preparingStepA11y',
  ],
  'pt-BR': [
    '$1screens.Onboarding.CreateOrganization.creating',
    '$1screens.Onboarding.CreateOrganization.tooLong',
  ],
} as Record<string, string[]>;

// ids que o próprio app gera em runtime (não chegam via catálogo Crowdin)
const IDS_IGNORADOS = new Set(['$1i18nCALENDAR']);
const LINGUA_REFERENCIA = 'en-US';

describe('catálogos traduzidos cobrem o IntroToCoMapeo', () => {
  const idsReferencia = new Set(
    TELAS_ONBOARDING.flatMap(idsDefineMessages)
      .map(def => def.id)
      .filter(id => id.startsWith('$1') && !IDS_IGNORADOS.has(id)),
  );

  const faltandoPorLingua: Record<string, string[]> = {};
  for (const lingua of LINGUAS_TRADUZIDAS) {
    const chaves = chavesCatalogo(lingua);
    const piso = new Set(PISO[lingua] ?? []);
    const faltando = [...idsReferencia].filter(
      id => !chaves.has(id) && !piso.has(id),
    );
    if (faltando.length > 0) faltandoPorLingua[lingua] = faltando;
  }

  test('nenhuma língua preenchida perde tradução de tela de onboarding', () => {
    const resumo = Object.entries(faltandoPorLingua)
      .map(([lingua, ids]) => `${lingua}: ${ids.join(', ')}`)
      .join('\n');
    expect(resumo).toBe('');
  });

  test('en-US (referência) cobre todos os ids das telas', () => {
    const chavesEn = chavesCatalogo(LINGUA_REFERENCIA);
    const faltandoEn = [...idsReferencia].filter(id => !chavesEn.has(id));
    expect(faltandoEn).toEqual([]);
  });
});
