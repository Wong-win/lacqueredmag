# LacqueredMag

An editorial-style beauty magazine built with Astro. Print sensibility on a web page.

D2+B hybrid layout: Into-the-Gloss editorial rigour + i-D extreme restraint.

## Stack

- Astro 7 (static)
- Fraunces (display) + Inter (body), via `@fontsource-variable`
- Single-locked mono palette + lacquer oxblood accent
- Deploy target: Cloudflare Pages

## Local development

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
npm run preview  # serve built dist
```

## Project structure

```
src/
├── content.config.ts        # Zod schema (audit-safe)
├── layouts/Layout.astro     # html/head/body + GA4 is:inline
├── styles/global.css        # CSS vars + base typography
├── components/              # Header, Footer, CoverHero, IssueBand, TwoColumn,
│                            #   MagazineCard, Dropquote, ArticleBody, Newsletter
├── pages/                   # index, [...slug], 404, about, contact, privacy
└── content/articles/        # 6 launch editorial essays (.md)
```

## Conventions

- All category slugs: `skin` `makeup` `fragrance` `hair` `atelier`
- Frontmatter required fields enforced by Zod `min()` / `default()`
- No theme switching in v1 (single palette, single font set)
- Articles are flat /{slug}/ — no category prefix in URL

## Adding a new article

1. Create `src/content/articles/<slug>.md`
2. Fill frontmatter per `src/content.config.ts` schema
3. Body content 1,200-2,200 words for SEO depth
4. Include dropquote via `<Dropquote />` component placement

## Deploy

This site is deployed via Cloudflare Pages. See `/Users/wong/.claude/plans/stateless-forging-lollipop.md` for the deployment sequence.
