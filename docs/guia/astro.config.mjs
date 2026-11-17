import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://transistir.com',
  base: '/coiab-app',
  // Astro 7 (Vite 8 + Rolldown) resolves Markdown files against the topmost
  // tsconfig in the folder chain. This repo's root tsconfig extends a React
  // Native package that is not installed here, so pin the guide's own config.
  vite: {tsconfig: './tsconfig.json'},
  integrations: [
    starlight({
      title: 'Guia COIAB',
      defaultLocale: 'root',
      locales: {
        root: {label: 'Português', lang: 'pt-BR'},
      },
      sidebar: [
        {label: 'Visão geral', link: '/'},
        {label: 'Primeiros passos', link: '/primeiros-passos/'},
        {label: 'Organização', link: '/organizacao/'},
        {label: 'Criar uma observação', link: '/criar-observacao/'},
      ],
    }),
  ],
});
