import * as fs from 'node:fs';
import * as path from 'node:path';

// Issue #130: guarda da troca de terminologia visível "organização"/"Organization"
// → "território"/"Territory". Só VALORES são verificados — ids de mensagem,
// chaves de catálogo, descrições, tipos, rotas e nomes internos continuam
// "organization" e não podem ser renomeados:
//
// 1) nenhum valor de mensagem nos catálogos fonte (messages/en-US e pt-BR)
//    nem nos catálogos de runtime (translations/en.json e pt.json) menciona
//    organização/organization;
// 2) nenhum `defaultMessage` em src/frontend menciona organização/organization.
//
// Exceção (texto jurídico de privacidade, que não fala de território):
// - chaves de catálogo sob `screens.PrivacyPolicy.` (inclusive em `$1`), e o
//   diretório-fonte que define esse namespace. Nenhuma outra exceção é
//   aceita: "non-profit organization" / "organização sem fins lucrativos"
//   também precisam ser reescritos fora da política de privacidade.
//
// Rode RED antes da renomeação e GREEN depois.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TERMO = /organiza(ção|ções|tion|tions)\b/i;

function ehNamespacePrivacidade(chave: string): boolean {
  return chave.replace(/^\$1/, '').startsWith('screens.PrivacyPolicy.');
}

/** Valor de uma entrada de catálogo fonte: apenas `message`, nunca `description`. */
function valorDaEntrada(entrada: unknown): string | undefined {
  if (!entrada || typeof entrada !== 'object') {
    return undefined;
  }
  const mensagem = (entrada as {message?: unknown}).message;
  return typeof mensagem === 'string' ? mensagem : undefined;
}

/** Coleta toda string folha de um JSON de runtime (formato crowdin:
 * `[{"type":0,"value":"..."}]`). Nomes de chave NÃO são valores. */
function valoresString(json: unknown): string[] {
  const valores: string[] = [];
  const visita = (no: unknown): void => {
    if (typeof no === 'string') {
      valores.push(no);
      return;
    }
    if (Array.isArray(no)) {
      no.forEach(visita);
      return;
    }
    if (no && typeof no === 'object') {
      Object.values(no).forEach(visita);
    }
  };
  visita(json);
  return valores;
}

function lerJson(relativo: string): unknown {
  const caminho = path.join(REPO_ROOT, relativo);
  expect(fs.existsSync(caminho)).toBe(true);
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

function arquivosFonte(dir: string, encontrados: string[] = []): string[] {
  for (const entrada of fs.readdirSync(dir, {withFileTypes: true})) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules') {
        continue;
      }
      arquivosFonte(caminho, encontrados);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entrada.name) && !/\.d\.ts$/.test(entrada.name)) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

describe('terminologia visível (#130): organização → território', () => {
  test('catálogos fonte não mantêm organização/organization em valores', () => {
    const ofensores: string[] = [];
    for (const arquivo of [
      'messages/en-US/primary.json',
      'messages/en-US/secondary.json',
      'messages/pt-BR/primary.json',
      'messages/pt-BR/secondary.json',
    ]) {
      const catalogo = lerJson(arquivo) as Record<string, unknown>;
      for (const [chave, entrada] of Object.entries(catalogo)) {
        if (ehNamespacePrivacidade(chave)) {
          continue;
        }
        const valor = valorDaEntrada(entrada);
        if (valor && TERMO.test(valor)) {
          ofensores.push(`${arquivo} :: ${chave} => ${valor}`);
        }
      }
    }
    expect(ofensores).toEqual([]);
  });

  test('translations/en.json e pt.json não mantêm organização/organization em valores', () => {
    const ofensores: string[] = [];
    for (const arquivo of ['translations/en.json', 'translations/pt.json']) {
      const catalogo = lerJson(arquivo) as Record<string, unknown>;
      for (const [chave, entrada] of Object.entries(catalogo)) {
        if (ehNamespacePrivacidade(chave)) {
          continue;
        }
        for (const valor of valoresString(entrada)) {
          if (TERMO.test(valor)) {
            ofensores.push(`${arquivo} :: ${chave} => ${valor}`);
          }
        }
      }
    }
    expect(ofensores).toEqual([]);
  });

  test('defaultMessage e props visíveis literais em src/frontend não mantêm organização/organization', () => {
    const ofensores: string[] = [];
    // `defaultMessage` (formatjs) e props que o usuário lê: rótulo de
    // acessibilidade, placeholder de campo e `placeholderText`. Só o VALOR
    // literal entre aspas é verificado; identificadores, ids, testIDs, rotas
    // e nomes internos ficam de fora porque não são esses nomes de prop.
    const padraoDefaultMessage =
      /defaultMessage:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    const padraoPropVisivel =
      /(?<![A-Za-z0-9_$])(?:accessibilityLabel|placeholderText|placeholder)\s*[=:]\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    const privacidade = path.join(
      'src',
      'frontend',
      'screens',
      'PrivacyPolicy',
    );
    for (const caminho of arquivosFonte(
      path.join(REPO_ROOT, 'src', 'frontend'),
    )) {
      const relativo = path.relative(REPO_ROOT, caminho);
      // O namespace `screens.PrivacyPolicy.*` inteiro vive neste diretório.
      if (relativo.startsWith(privacidade + path.sep)) {
        continue;
      }
      const conteudo = fs.readFileSync(caminho, 'utf8');
      for (const achado of conteudo.matchAll(padraoDefaultMessage)) {
        const valor = achado[2] ?? '';
        if (valor && TERMO.test(valor)) {
          ofensores.push(`${relativo} => ${valor.replace(/\s+/g, ' ')}`);
        }
      }
      // Comentários podem citar uma prop como exemplo; não é texto visível.
      const semComentarios = conteudo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const achado of semComentarios.matchAll(padraoPropVisivel)) {
        const valor = achado[2] ?? '';
        if (valor && TERMO.test(valor)) {
          ofensores.push(`${relativo} => ${valor.replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(ofensores).toEqual([]);
  });
});
