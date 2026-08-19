#!/usr/bin/env node
/**
 * rebrand.mjs — rebrand minimalista de um fork do CoMapeo Mobile.
 *
 * Subcomandos:
 *   apply      edits de identidade (app id, nome, domínio, owner) — só arquivos, sem rede
 *   verify     caça sobras de "com.comapeo" + valida config Expo + roda testes de config
 *   link-eas   cria/vincula o projeto EAS próprio (eas init --force) e atualiza projectId
 *   eas-env    registra COMAPEO_METRICS_* (e opcionalmente MAPBOX) nos 3 ambientes padrão
 *   release    fluxo git/gh que dispara o build-release.yml existente (release/vX.Y + rc/vX.Y)
 *   build-status  mostra os últimos builds EAS
 *
 * Rodar a partir da RAIZ do repositório. Nenhum arquivo fora dos listados é tocado:
 * deps @comapeo e @mapeo, URLs github.com/digidem, nomes COMAPEO_METRICS_* e config
 * do Sentry permanecem de propósito (ver SKILL.md — "O que NÃO mudar").
 */

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, execSync, spawnSync} from 'node:child_process';
import process from 'node:process';

const ROOT = process.cwd();

// ---------------------------------------------------------------- helpers

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function requireFiles(...files) {
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      die(
        `${f} não encontrado em ${ROOT} — rode a partir da raiz do repositório CoMapeo.`,
      );
    }
  }
}

function run(cmd, {inherit = false, allowFail = false} = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
  });
  if (r.status !== 0 && !allowFail) {
    if (!inherit) process.stderr.write(r.stderr || '');
    die(`comando falhou (${r.status}): ${cmd}`);
  }
  return (r.stdout || '') + (r.stderr || '');
}

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acentos: Ekanâdyby -> ekanadyby
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// apply: contador de substituições
const stats = {applied: 0, already: 0, missing: []};

/**
 * Substituição exata de string em um arquivo.
 * - to presente (e diferente de from) -> já aplicado (idempotente; checado
 *   PRIMEIRO porque há casos em que `to` contém `from`, ex. inserção de linha)
 * - from presente -> substitui (conta `applied`)
 * - nenhum dos dois -> `missing` (erro, a menos que optional)
 */
function applyRepl(file, from, to, {all = false, optional = false} = {}) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    if (!optional) stats.missing.push(`${file}: arquivo não existe`);
    return;
  }
  const src = fs.readFileSync(p, 'utf8');
  if (to !== from && src.includes(to)) {
    stats.already++;
  } else if (src.includes(from)) {
    fs.writeFileSync(p, all ? src.split(from).join(to) : src.replace(from, to));
    stats.applied++;
  } else if (!optional) {
    stats.missing.push(
      `${file}: padrão não encontrado: ${JSON.stringify(from.slice(0, 70))}`,
    );
  }
}

/** `already` (opcional): string que, se presente, indica substituição já feita. */
function applyRegex(file, re, to, {optional = false, already = null} = {}) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    if (!optional) stats.missing.push(`${file}: arquivo não existe`);
    return;
  }
  const src = fs.readFileSync(p, 'utf8');
  if (already && src.includes(already)) {
    stats.already++;
  } else if (re.test(src)) {
    fs.writeFileSync(p, src.replace(re, to));
    stats.applied++;
  } else if (!optional) {
    stats.missing.push(`${file}: regex não casou: ${re}`);
  }
}

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function finishStats() {
  console.log(
    `\napply: ${stats.applied} substituições, ${stats.already} já estavam aplicadas.`,
  );
  if (stats.missing.length) {
    console.error(`✖ ${stats.missing.length} padrões não encontrados:`);
    for (const m of stats.missing) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log('✔ apply concluído sem pendências.');
}

// ---------------------------------------------------------------- apply

function cmdApply(args) {
  requireFiles('app.json', 'app.config.js', 'eas.json');
  const appId = args['app-id'];
  const appName = args['app-name'];
  const domain = args['domain'];
  const owner = args['owner'];
  if (!appId || !appName || !domain || !owner) {
    die(
      'apply requer: --app-id org.exemplo --app-name "Nome" --domain app.exemplo.org --owner conta-expo',
    );
  }
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(appId)) {
    die(`--app-id inválido: ${appId} (esperado domínio reverso, ex. org.coiab)`);
  }
  const slug = args['slug'] || slugify(appName);
  const scheme = args['scheme'] || slug;
  const segs = appId.split('.');
  const javaPkg = `${appId}.flagsecure`;

  console.log(
    `Rebrand: com.comapeo -> ${appId} | CoMapeo -> ${appName} | slug/scheme ${slug}/${scheme} | deep link ${domain} | owner ${owner}`,
  );

  // 1. app.config.js — identidade base
  applyRepl(
    'app.config.js',
    `const APP_ID_BASE = 'com.comapeo';`,
    `const APP_ID_BASE = '${appId}';`,
  );
  applyRepl(
    'app.config.js',
    `const APP_NAME_BASE = 'CoMapeo';`,
    `const APP_NAME_BASE = '${appName}';`,
  );

  // 2. app.json — identidade Expo (mantém formatação original; o eas init reformata depois)
  applyRepl('app.json', `"name": "CoMapeo",`, `"name": "${appName}",`);
  applyRepl('app.json', `"slug": "comapeo",`, `"slug": "${slug}",`);
  applyRepl('app.json', `"scheme": "comapeo",`, `"scheme": "${scheme}",`);
  applyRepl('app.json', `"host": "app.comapeo.org"`, `"host": "${domain}"`);
  applyRepl('app.json', `"package": "com.comapeo"`, `"package": "${appId}"`);
  applyRepl(
    'app.json',
    `"bundleIdentifier": "com.comapeo"`,
    `"bundleIdentifier": "${appId}"`,
  );
  applyRepl('app.json', `"owner": "digidem"`, `"owner": "${owner}"`);

  // 3. deep links (constante + comentários)
  applyRepl(
    'src/frontend/lib/deepLinkConfig.ts',
    'comapeo://',
    `${scheme}://`,
    {all: true},
  );
  applyRepl(
    'src/frontend/lib/deepLinkConfig.ts',
    'app.comapeo.org',
    domain,
    {all: true},
  );
  applyRepl(
    'src/frontend/lib/deepLinkConfig.ts',
    'scheme=comapeo,',
    `scheme=${scheme},`,
  );

  // 4. plugin FlagSecure (package Java + caminhos de destino + comentários)
  for (const f of [
    'expo-config-plugins/flagSecure/FlagSecureModule.java',
    'expo-config-plugins/flagSecure/FlagSecurePackage.java',
  ]) {
    applyRegex(
      f,
      /^package com\.comapeo\.flagsecure;.*$/m,
      `package ${javaPkg};`,
      {already: `package ${javaPkg};`},
    );
  }
  applyRepl(
    'expo-config-plugins/flagSecure/index.js',
    `config.android?.package ?? 'com.comapeo'`,
    `config.android?.package ?? '${appId}'`,
  );
  const destBlockTo =
    segs.map(s => `    '${s}',`).join('\n') + `\n    'flagsecure',`;
  applyRepl(
    'expo-config-plugins/flagSecure/index.js',
    `    'com',\n    'comapeo',\n    'flagsecure',`,
    destBlockTo,
    {all: true}, // moduleDest + packageDest
  );
  applyRepl(
    'expo-config-plugins/flagSecure/index.js',
    `// Convert "com.comapeo.dev" => ["com","comapeo","dev"] for example`,
    `// Convert "${appId}.dev" => [${segs.map(s => `"${s}"`).join(',')},\"dev\"] for example`,
  );
  applyRepl(
    'expo-config-plugins/flagSecure/index.js',
    `// So your MainApplication is at: android/app/src/main/java/com/comapeo/dev/MainApplication.kt for example`,
    `// So your MainApplication is at: android/app/src/main/java/${segs.join('/')}/dev/MainApplication.kt for example`,
  );
  applyRepl(
    'expo-config-plugins/flagSecure/index.js',
    `const importLine = 'import com.comapeo.flagsecure.FlagSecurePackage';`,
    `const importLine = 'import ${javaPkg}.FlagSecurePackage';`,
  );

  // 5. eas.json
  // 5a. sem SENTRY_DISABLE_AUTO_UPLOAD, todo build release quebra no task
  //     SentryUpload: o fork não tem token/org Sentry do upstream (awana-digital)
  applyRepl(
    'eas.json',
    `      "ios": {
        "image": "latest",
        "node": "24.13.0"
      }
    },
    "development": {`,
    `      "ios": {
        "image": "latest",
        "node": "24.13.0"
      },
      "env": {
        "SENTRY_DISABLE_AUTO_UPLOAD": "true"
      }
    },
    "development": {`,
  );
  // 5b. perfis além dos 3 ambientes padrão precisam de "environment"
  //    (plano gratuito do EAS só tem production/preview/development)
  for (const profile of ['release-candidate', 'test', 'pre-release']) {
    applyRepl(
      'eas.json',
      `"${profile}": {\n      "extends": "base",\n      "distribution": "internal",`,
      `"${profile}": {\n      "extends": "base",\n      "distribution": "internal",\n      "environment": "preview",`,
    );
  }

  // 6. package.json — nome + hook de upload desativado (requer storage próprio)
  applyRepl('package.json', `"name": "comapeo-mobile",`, `"name": "${slug}",`);
  applyRepl(
    'package.json',
    `"eas-build-on-success": "scripts/upload-release.sh",`,
    `"//eas-build-on-success": "scripts/upload-release.sh (desativado: requer storage MinIO/R2 com credenciais AWS — reativar/remover quando houver storage próprio)",`,
  );

  // 7. testes e configs que citam a identidade
  applyRepl('app.config.test.ts', 'com.comapeo', appId, {all: true});
  applyRepl('app.config.test.ts', 'CoMapeo', appName, {all: true});
  applyRepl(
    'wdio.ci.config.js',
    `projectName: 'CoMapeo',`,
    `projectName: '${appName}',`,
    {all: true},
  );
  applyRepl(
    'docs/EndToEndTests/E2EWithAppium.md',
    'com.comapeo.dev',
    `${appId}.dev`,
    {all: true},
  );
  for (const f of walkTs(path.join(ROOT, 'tests/e2e/specs'))) {
    applyRepl(path.relative(ROOT, f), `'com.comapeo.rc'`, `'${appId}.rc'`, {
      all: true,
      optional: true, // specs sem terminate/activateApp não têm o padrão
    });
  }

  // 8. correção de caminhos não-ASCII (new URL(...).pathname percent-encode "â" etc.)
  applyRepl(
    'scripts/build-intl-polyfills.mjs',
    `  const outputPath = new URL(
    '../src/frontend/polyfills/intl.ts',
    import.meta.url,
  ).pathname;`,
    `  const outputPath = fileURLToPath(
    new URL('../src/frontend/polyfills/intl.ts', import.meta.url),
  );`,
  );
  applyRepl(
    'scripts/extract-messages.mjs',
    `import {execSync} from 'node:child_process';

const PROJECT_ROOT = new URL('../', import.meta.url).pathname;`,
    `import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));`,
  );
  applyRepl(
    'scripts/download-prebuilds.mjs',
    `  const nodeVersionFilePath = new URL(
    'android/libnode/include/node/node_version.h',
    new URL(import.meta.resolve('@comapeo/nodejs-mobile-react-native')),
  ).pathname;`,
    `  const nodeVersionFilePath = fileURLToPath(
    new URL(
      'android/libnode/include/node/node_version.h',
      new URL(import.meta.resolve('@comapeo/nodejs-mobile-react-native')),
    ),
  );`,
  );

  // 9. opcional: já gravar o novo projectId EAS (pula o link-eas)
  if (args['project-id']) {
    const pid = args['project-id'];
    if (!new RegExp(`^${UUID_RE}$`).test(pid)) {
      die(`--project-id não parece um UUID: ${pid}`);
    }
    applyRegex(
      'app.config.js',
      new RegExp(`const EAS_PROJECT_ID = '${UUID_RE}';`),
      `const EAS_PROJECT_ID = '${pid}';`,
      {already: `const EAS_PROJECT_ID = '${pid}';`},
    );
    applyRegex(
      'app.json',
      new RegExp(`"projectId": "${UUID_RE}"`),
      `"projectId": "${pid}"`,
      // se o extra.eas foi removido antes do eas init, ok
      {optional: true, already: `"projectId": "${pid}"`},
    );
    applyRepl(
      'app.config.test.ts',
      '2d5b8137-12ec-45aa-9c23-56b6a1c522b7',
      pid,
      {all: true, optional: true},
    );
  }

  finishStats();
  console.log(`
Próximos passos:
  1. npm install                     (se ainda não rodou)
  2. cp .env.template .env           (preencha MAPBOX_ACCESS_TOKEN localmente)
  3. npm run build:translations && npm run build:intl-polyfills
  4. node ${process.argv[1]} verify
  5. node ${process.argv[1]} link-eas --owner ${owner}   (se não usou --project-id)
  6. node ${process.argv[1]} eas-env
  7. git commit + node ${process.argv[1]} release --yes`);
}

// ---------------------------------------------------------------- verify

function cmdVerify(args) {
  requireFiles('app.json', 'app.config.js');
  let failures = 0;

  // 1. sobras da identidade antiga (package id, scheme, host, owner)
  for (const [label, pattern] of [
    ['package id antigo', 'com.comapeo'],
    ['scheme antigo', 'comapeo://'],
    ['host antigo', 'app.comapeo.org'],
  ]) {
    const out = run(
      `git grep -nI --fixed-strings '${pattern}' -- . ':!package-lock.json' ':!.claude'`,
      {allowFail: true},
    ).trim();
    if (out) {
      failures++;
      console.error(`✖ sobras de ${label} (${pattern}):\n${out}`);
    } else {
      console.log(`✔ sem sobras de ${label} (${pattern})`);
    }
  }
  const appJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'),
  );
  if (appJson.expo.owner === 'digidem') {
    failures++;
    console.error('✖ app.json ainda com owner "digidem"');
  } else {
    console.log(`✔ owner do app.json: ${appJson.expo.owner}`);
  }

  // 2. config Expo avaliado (precisa de node_modules; não precisa de .env)
  if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    const cfg = run('APP_VARIANT=production npx expo config --type public', {
      allowFail: true,
    });
    // expo config imprime em formato inspect (aspas simples + cores ANSI),
    // então casa no valor puro
    const checks = [];
    if (args['app-name']) checks.push([args['app-name'], 'nome do app']);
    if (args['app-id']) checks.push([args['app-id'], 'package/bundle id']);
    if (args['domain']) checks.push([args['domain'], 'host de deep link']);
    for (const [needle, label] of checks) {
      if (cfg.includes(needle)) console.log(`✔ expo config contém ${label}: ${needle}`);
      else {
        failures++;
        console.error(`✖ expo config NÃO contém ${label}: ${needle}`);
      }
    }
    if (!checks.length && !cfg.includes('com.comapeo')) {
      console.log('✔ expo config avalia sem identidade antiga');
    }
  } else {
    console.log('… node_modules ausente: pulando avaliação do expo config (npm install)');
  }

  // 3. testes de config (precisam de .env e translations)
  if (
    fs.existsSync(path.join(ROOT, 'node_modules')) &&
    fs.existsSync(path.join(ROOT, '.env'))
  ) {
    if (!fs.existsSync(path.join(ROOT, 'translations/index.ts'))) {
      console.log('… translations/index.ts ausente, gerando (npm run build:translations)');
      run('npm run build:translations', {inherit: true});
    }
    console.log('Rodando npm run test:jest -- app.config.test.ts …');
    const out = run('npm run test:jest -- app.config.test.ts', {allowFail: true});
    if (/Tests:.*passed/.test(out) && !/failed/.test(out.split('Tests:')[1] || '')) {
      console.log('✔ app.config.test.ts passou');
    } else {
      failures++;
      console.error('✖ app.config.test.ts falhou (veja saída acima)');
      process.stderr.write(out.slice(-3000));
    }
  } else {
    console.log('… .env ou node_modules ausentes: pulando testes jest');
  }

  if (failures) die(`verify encontrou ${failures} problema(s).`);
  console.log('\n✔ verify: identidade rebrand verificada.');
}

// ---------------------------------------------------------------- link-eas

function cmdLinkEas(args) {
  requireFiles('app.json', 'app.config.js');
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    die('node_modules ausente — rode npm install antes (eas init avalia app.config.js que requer semver).');
  }
  const owner = args['owner'];
  const appJsonPath = path.join(ROOT, 'app.json');
  const cfg = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

  if (!owner) {
    if (!cfg.expo.owner || cfg.expo.owner === 'digidem') {
      die('link-eas requer --owner <conta-expo> (o owner atual é upstream/digidem).');
    }
  } else {
    cfg.expo.owner = owner;
  }

  // remove projectId upstream — senão o eas init tenta autorizar contra a entidade da digidem
  const stale = cfg.expo?.extra?.eas?.projectId;
  if (stale) {
    delete cfg.expo.extra.eas.projectId;
    if (cfg.expo.extra.eas && !Object.keys(cfg.expo.extra.eas).length) {
      delete cfg.expo.extra.eas;
    }
    if (cfg.expo.extra && !Object.keys(cfg.expo.extra).length) {
      delete cfg.expo.extra;
    }
    console.log(`… removendo projectId upstream ${stale} do app.json`);
  }
  fs.writeFileSync(appJsonPath, JSON.stringify(cfg, null, 2) + '\n');

  console.log('… eas whoami');
  run('eas whoami', {inherit: true, allowFail: false});

  console.log('… eas init --force (cria o projeto @<owner>/<slug> se necessário)');
  run('eas init --force', {inherit: true});

  const cfg2 = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const pid = cfg2.expo?.extra?.eas?.projectId;
  if (!pid) die('eas init terminou mas app.json ficou sem extra.eas.projectId.');

  applyRegex(
    'app.config.js',
    new RegExp(`const EAS_PROJECT_ID = '${UUID_RE}';`),
    `const EAS_PROJECT_ID = '${pid}';`,
    {already: `const EAS_PROJECT_ID = '${pid}';`},
  );
  applyRegex(
    'app.config.test.ts',
    new RegExp(`(expect\\(result\\.extra\\.eas\\.projectId\\)\\.toBe\\(\\n\\s*')${UUID_RE}`),
    `$1${pid}`,
    {already: `.toBe(\n          '${pid}',`},
  );
  applyRegex(
    'app.config.test.ts',
    new RegExp(`('https://u\\.expo\\.dev/')${UUID_RE}`),
    `$1${pid}`,
    {already: `https://u.expo.dev/${pid}`},
  );

  console.log(`\n✔ projeto EAS vinculado: ${pid} (owner ${cfg2.expo.owner}).`);
  console.log(`  Confira em https://expo.dev/accounts/${cfg2.expo.owner}/projects/${cfg2.expo.slug}`);
}

// ---------------------------------------------------------------- eas-env

function cmdEasEnv(args) {
  // Plano gratuito: só existem os ambientes production/preview/development.
  // Os builds EAS rodam nos servidores da Expo — secrets do GitHub NÃO chegam lá.
  const envs = ['--environment production', '--environment preview', '--environment development'].join(' ');
  const metricsUrl = args['metrics-url'] || 'https://metrics.invalid';
  const metricsKey = args['metrics-key'] || 'not-configured';

  console.log('… COMAPEO_METRICS_URL / COMAPEO_METRICS_API_KEY (placeholders — babel exige valor não-vazio)');
  run(
    `eas env:set --name COMAPEO_METRICS_URL --value "${metricsUrl}" ${envs} --non-interactive`,
    {inherit: true},
  );
  run(
    `eas env:set --name COMAPEO_METRICS_API_KEY --value "${metricsKey}" ${envs} --non-interactive`,
    {inherit: true},
  );

  if (args['mapbox-token']) {
    console.log('… MAPBOX_ACCESS_TOKEN (secret)');
    run(
      `eas env:set --name MAPBOX_ACCESS_TOKEN --value "${args['mapbox-token']}" --environment production --environment preview --environment development --visibility secret --non-interactive`,
      {inherit: true},
    );
  } else {
    console.log(
      '… MAPBOX_ACCESS_TOKEN não informado — registre em expo.dev → Project → Environment variables (ou passe --mapbox-token).',
    );
  }
  console.log('\n✔ variáveis EAS registradas. Conferência: eas env:list');
}

// ---------------------------------------------------------------- release

function cmdRelease(args) {
  requireFiles('package.json');
  if (!args.yes) {
    die('release cria branches, PR e merge. Confirme com --yes.');
  }
  // -uno: arquivos não-rastreados (ex. a própria skill em .claude/) não bloqueiam
  const status = run('git status --porcelain -uno').trim();
  if (status) die(`árvore de trabalho suja — commite ou descarte antes:\n${status}`);
  run('gh auth status', {inherit: true});

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.name === 'comapeo-mobile') {
    die('package.json ainda é "comapeo-mobile" — rode apply antes.');
  }
  const full = pkg.version; // ex.: 1.14.0-pre
  const base = full.split('-')[0]; // 1.14.0
  const parts = base.split('.');
  const ver = `${parts[1]}.${parts[2]}`; // ex.: 14.0
  const repo = run(
    'gh repo view --json nameWithOwner -q .nameWithOwner',
  ).trim();
  console.log(`release: ${repo} versão ${full} -> ${base} (branches v${ver})`);

  // forks nascem com Actions desativados — ativa (idempotente; -F manda booleano de verdade)
  run(
    `gh api -X PUT repos/${repo}/actions/permissions -F enabled=true -F allowed_actions=all`,
    {inherit: true},
  );

  run('git checkout develop', {inherit: true});
  run('git push origin develop', {inherit: true});
  run(`git checkout -b release/v${ver} develop`, {inherit: true});
  run(`git push origin release/v${ver}`, {inherit: true});
  run(`git checkout -b rc/v${ver} release/v${ver}`, {inherit: true});

  if (full !== base) {
    // tira o sufixo -pre/-dev e sincroniza o package-lock (nome/versão)
    pkg.version = base;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    run('npm install --package-lock-only --no-audit --no-fund', {inherit: true});
    run('git add package.json package-lock.json', {inherit: true});
    execFileSync(
      'git',
      [
        'commit',
        '-m',
        `chore: bump version to ${base} for release candidate\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
      ],
      {cwd: ROOT, stdio: 'inherit'},
    );
  }
  run(`git push origin rc/v${ver}`, {inherit: true});

  // build-release.yml dispara ao mesclar PR cujo base é release/**
  const prUrl = run(
    `gh pr create --repo ${repo} --base release/v${ver} --head rc/v${ver} --title "Release Candidate v${ver}" --body "Release candidate do fork ${pkg.name} (gerado pela skill rebrand-comapeo).\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"`,
  ).trim();
  console.log(`PR criado: ${prUrl}`);
  const prNum = prUrl.split('/').pop();
  run(`gh pr merge ${prNum} --repo ${repo} --merge`, {inherit: true});

  console.log(`
✔ PR mesclado em release/v${ver} — o workflow "Build Release" (build-release.yml)
  vai disparar um build EAS Android de produção. Acompanhe:
    gh run list --repo ${repo} --limit 8
    eas build:list --json --non-interactive --limit 3
  Jobs "Build Release Candidate", "Check PR to Release" e afins vão falhar sem o
  release-bot do upstream — é esperado e inofensivo.`);
}

// ---------------------------------------------------------------- build-status

function cmdBuildStatus() {
  const out = run('eas build:list --json --non-interactive --limit 3');
  let builds;
  try {
    builds = JSON.parse(out);
  } catch {
    die(`saída inesperada do eas build:list:\n${out.slice(0, 500)}`);
  }
  if (!builds.length) {
    console.log('Nenhum build ainda.');
    return;
  }
  for (const b of builds) {
    console.log(
      `- [${b.status}] ${b.platform} appVersion=${b.appVersion || '?'} profile=${b.buildProfile || '?'} id=${b.id}`,
    );
    console.log(`    https://expo.dev/builds/${b.id}`);
  }
}

// ---------------------------------------------------------------- main

const [sub, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (sub) {
  case 'apply':
    cmdApply(args);
    break;
  case 'verify':
    cmdVerify(args);
    break;
  case 'link-eas':
    cmdLinkEas(args);
    break;
  case 'eas-env':
    cmdEasEnv(args);
    break;
  case 'release':
    cmdRelease(args);
    break;
  case 'build-status':
    cmdBuildStatus();
    break;
  default:
    console.log(`uso: rebrand.mjs <apply|verify|link-eas|eas-env|release|build-status> [flags]

  apply --app-id org.exemplo --app-name "Nome" --domain app.exemplo.org --owner conta-expo
        [--slug s] [--scheme s] [--project-id UUID]
  verify [--app-id id --app-name nome --domain host]
  link-eas --owner conta-expo
  eas-env [--metrics-url U --metrics-key K] [--mapbox-token T]
  release --yes
  build-status`);
    process.exit(sub ? 1 : 0);
}
