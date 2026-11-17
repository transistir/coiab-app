import {defineCollection} from 'astro:content';
import {docsLoader} from '@astrojs/starlight/loaders';
import {docsSchema} from '@astrojs/starlight/schema';

// Starlight needs the docs collection declared explicitly in the project.
export const collections = {
  docs: defineCollection({loader: docsLoader(), schema: docsSchema()}),
};
