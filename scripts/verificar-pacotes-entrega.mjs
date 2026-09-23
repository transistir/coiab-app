#!/usr/bin/env node
// @ts-check

/**
 * Gate de ENTREGA dos pacotes `.comapeocat` (Decisão A/A3, SPEC B `:313` —
 * nada inventado é entregue): roda em `eas-build-post-install` logo depois de
 * `npm run build:manifestos-pacotes`. Se `APP_VARIANT` for uma variante de
 * entrega (`production` ou `preRelease`) e QUALQUER `ref.versao` do manifesto
 * terminar em `-interino`, imprime as áreas e sai 1 — a build para no hook.
 *
 * Par do gate de runtime em `src/frontend/lib/organization/pacotesInstalados.ts`
 * (`PERMITE_PACOTES_INTERINOS`): o mesmo sufixo canônico `-interino`
 * (`SUFIXO_INTERINO`). Desenvolvimento e releaseCandidate são descartáveis e
 * permitidos lá; variantes desconhecidas/ausentes aqui não são variante de
 * entrega conhecida e seguem o comportamento especificado (só production e
 * preRelease recusam).
 */

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFESTO = path.join(
  PROJECT_ROOT,
  'src',
  'frontend',
  'lib',
  'organization',
  'manifestos.generated.json',
);

/** Variantes que podem alcançar aparelhos de campo — recusam o interino. */
const VARIANTES_DE_ENTREGA = new Set(['production', 'preRelease']);
const SUFIXO_INTERINO = '-interino';

const variante = process.env.APP_VARIANT ?? '';
if (!VARIANTES_DE_ENTREGA.has(variante)) {
  process.exit(0);
}

// O manifesto é gerado pelo passo anterior do hook; ausente ou ilegível é
// falha alta (exit 1) — uma entrega sem manifesto não passa.
const manifesto = JSON.parse(await readFile(MANIFESTO, 'utf-8'));

const areasInterinas = Object.keys(manifesto)
  .filter(area => area !== '//')
  .filter(
    area =>
      String(manifesto[area]?.ref?.versao ?? '').endsWith(SUFIXO_INTERINO),
  );

if (areasInterinas.length === 0) {
  process.exit(0);
}

for (const area of areasInterinas) {
  console.error(
    `APP_VARIANT=${variante} não entrega pacote interino: '${area}' versão ${manifesto[area].ref.versao}`,
  );
}
console.error(
  `Build de entrega interrompida: troque os pacotes interinos pelos aprovados da #30 (assets/categorias/README.md).`,
);
process.exit(1);
