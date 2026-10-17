import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const CATEGORY_SLUGS = ['skin', 'makeup', 'fragrance', 'hair', 'atelier'] as const;

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string().min(10),
    date: z.coerce.date(),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    image: z.string().url(),
    imageAlt: z.string().min(5),
    imageCaption: z.string().optional(),
    categories: z.array(z.string()).default([]),
    categorySlugs: z.array(z.enum(CATEGORY_SLUGS)).default([]),
    excerpt: z.string().min(40).max(220),
    author: z.string().default('Lacquered Editorial'),
    kicker: z.enum(['ESSAY', 'INTERVIEW', 'REVIEW', 'GUIDE', 'DISPATCH', 'ARCHIVE']).optional(),
    dek: z.string().optional(),
    issueNumber: z.number().int().positive().optional(),
    pinned: z.boolean().optional(),
  }),
});

export const collections = { articles };

export const CATEGORIES = {
  skin:      { label: 'Skin',      slug: 'skin',      color: '#8B2A1F' },
  makeup:    { label: 'Makeup',    slug: 'makeup',    color: '#6B1E13' },
  fragrance: { label: 'Fragrance', slug: 'fragrance', color: '#A66A4A' },
  hair:      { label: 'Hair',      slug: 'hair',      color: '#3E2A20' },
  atelier:   { label: 'Atelier',   slug: 'atelier',   color: '#0A0A0A' },
} as const;

export { CATEGORY_SLUGS };
