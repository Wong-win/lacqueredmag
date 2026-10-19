import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { CATEGORIES } from '../content.config';

export async function GET(context) {
  const articles = await getCollection('articles');
  const sorted = articles.sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
  );

  return rss({
    title: 'LacqueredMag',
    description:
      'Editorial essays on skin, makeup, fragrance, hair, and the lacquered life. A print sensibility on a web page.',
    site: context.site,
    items: sorted.map((article) => ({
      title: article.data.title,
      pubDate: new Date(article.data.date),
      description: article.data.excerpt,
      link: `/${article.data.slug}/`,
    })),
    customData: '<language>en-us</language>',
    stylesheet: false,
  });
}
