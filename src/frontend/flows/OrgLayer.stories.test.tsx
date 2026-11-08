import * as fs from 'node:fs';
import * as path from 'node:path';

import meta from './OrgLayer.stories';
import {withPtBrLocale} from '../../../.rnstorybook/decorators/withPtBrLocale';

const CATALOG = path.join(__dirname, '../../../messages/en-US/primary.json');

test('en-US descreve as áreas como "Monitoring and Alerts"', () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const msg = catalog['$1screens.OrganizationSetup.createIntroBody']
    .message as string;

  expect(msg).toBe(
    'Your Territory will have Monitoring and Alerts, with categories ready to use. You can create it without internet.',
  );
});

test('as stories do org-layer fixam o locale em pt-BR', () => {
  expect(meta.decorators).toContain(withPtBrLocale);
});
