import { DEFAULT_OG_IMAGE_PATH, SITE_NAME, type PageSeo } from '@orghive/shared';
import { absoluteUrl } from '@/lib/site-url';

export interface SeoProps {
  seo: PageSeo;
  /** For not-found and error pages, which should never appear in search results. */
  noindex?: boolean;
}

/**
 * Page title, meta description, canonical link and Open Graph / Twitter tags. React 19
 * hoists these into <head> and removes them when the page unmounts. index.html carries
 * the site defaults for crawlers that do not run JavaScript (see main.tsx).
 */
export function Seo({ seo, noindex = false }: SeoProps) {
  const url = absoluteUrl(seo.path);
  const image = absoluteUrl(seo.image);
  // Logos are square and read best as a small card; the default image is a 1200 x 630 banner.
  const card = seo.image === DEFAULT_OG_IMAGE_PATH ? 'summary_large_image' : 'summary';

  return (
    <>
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      {noindex ? <meta name="robots" content="noindex" /> : <link rel="canonical" href={url} />}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:alt" content={seo.imageAlt} />
      <meta name="twitter:card" content={card} />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={seo.imageAlt} />
    </>
  );
}
