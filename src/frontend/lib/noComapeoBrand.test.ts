import * as fs from 'node:fs';
import * as path from 'node:path';

// Issue #20: guarda da troca de marca. Três invariantes:
// 1) os assets de imagem CoMapeo*.svg removidos no grupo 1e não voltam a
//    src/frontend/images;
// 2) nenhum valor de string em translations/en.json e pt.json (nem no catálogo
//    fonte messages/en-US e pt-BR) menciona "CoMapeo";
// 3) as telas de onboarding (AuthScreen, IntroToCoMapeo, DataPrivacy) não
//    importam CoMapeoLogo/CoMapeoText/CoMapeoShield.
// Rode RED antes dos grupos 1 e 2 e GREEN depois.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const IMAGES_DIR = path.join(REPO_ROOT, 'src', 'frontend', 'images');

/** Coleta toda string folha de um JSON arbitrário (formato crowdin aninha
 * valores em `[{"type":0,"value":"..."}]`). Nomes de chave NÃO são valores. */
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

describe('des-CoMapeo (#20): guarda de marca', () => {
  test('src/frontend/images não contém mais arquivos CoMapeo*.svg', () => {
    expect(fs.existsSync(IMAGES_DIR)).toBe(true);
    const sobras = fs
      .readdirSync(IMAGES_DIR)
      .filter(nome => /^CoMapeo/i.test(nome));
    expect(sobras).toEqual([]);
  });

  test('translations/en.json e pt.json não citam "CoMapeo" em valores', () => {
    for (const arquivo of ['en.json', 'pt.json']) {
      const caminho = path.join(REPO_ROOT, 'translations', arquivo);
      expect(fs.existsSync(caminho)).toBe(true);
      const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      const comMarca = valoresString(conteudo).filter(
        v =>
          v.includes('CoMapeo') ||
          v.includes('Comapeo') ||
          v.includes('COMAPEO'),
      );
      expect(comMarca).toEqual([]);
    }
  });

  test('catálogo fonte messages/en-US e pt-BR não cita "CoMapeo" em valores', () => {
    for (const arquivo of [
      'messages/en-US/primary.json',
      'messages/en-US/secondary.json',
      'messages/pt-BR/primary.json',
      'messages/pt-BR/secondary.json',
    ]) {
      const conteudo = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, arquivo), 'utf8'),
      );
      const comMarca = valoresString(conteudo).filter(
        v =>
          v.includes('CoMapeo') ||
          v.includes('Comapeo') ||
          v.includes('COMAPEO'),
      );
      expect(comMarca).toEqual([]);
    }
  });

  test('telas de onboarding não importam assets CoMapeo', () => {
    const telas = [
      'src/frontend/screens/AuthScreen.tsx',
      'src/frontend/screens/Onboarding/IntroToCoMapeo.tsx',
      'src/frontend/screens/Onboarding/DataPrivacy.tsx',
    ];
    const ofensores = telas.filter(tela =>
      /CoMapeo(Logo|Text|Shield)/.test(
        fs.readFileSync(path.join(REPO_ROOT, tela), 'utf8'),
      ),
    );
    expect(ofensores).toEqual([]);
  });
});
