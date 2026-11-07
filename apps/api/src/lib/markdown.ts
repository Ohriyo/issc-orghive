import rehypeSanitize, { type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/*
 * Post bodies (docs/DOMAIN_RULES.md, "Organization posts"): limited Markdown, rendered and
 * sanitized here on the server, so the browser only ever receives this allow-list. Raw HTML
 * in the source is dropped (remark-rehype never passes it through), as are images, embeds
 * and scripts. Links may be http(s) or mailto; web links open in a new tab with
 * rel="noopener nofollow".
 */

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Only what the spec allows: headings, bold and italic, lists, links, quotes. */
export const POST_BODY_SCHEMA: SanitizeSchema = {
  tagNames: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'blockquote'],
  attributes: { a: ['href'] },
  protocols: { href: ['http', 'https', 'mailto'] },
  // Dropped with their content; every other unknown element keeps only its text.
  strip: ['script', 'style', 'iframe', 'object', 'embed'],
  // Never prefix or rewrite anything: there are no ids or names to clobber.
  clobber: [],
  clobberPrefix: '',
  required: {},
  ancestors: {},
};

function walk(node: HastNode, visit: (node: HastNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** The page has its own h1 (the post title), so a body's headings start at h2 and stop at h4. */
function demoteHeadings() {
  return (tree: HastNode) =>
    walk(tree, (node) => {
      if (node.type !== 'element' || !node.tagName) return;
      if (node.tagName === 'h1') node.tagName = 'h2';
      else if (node.tagName === 'h5' || node.tagName === 'h6') node.tagName = 'h4';
    });
}

/** Web links leave Orghive: open them in a new tab without handing over the window or rank. */
function externalLinks() {
  return (tree: HastNode) =>
    walk(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href === 'string' && /^https?:\/\//i.test(href)) {
        node.properties = { ...node.properties, target: '_blank', rel: ['noopener', 'nofollow'] };
      }
    });
}

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(demoteHeadings)
  .use(rehypeSanitize, POST_BODY_SCHEMA)
  .use(externalLinks)
  .use(rehypeStringify);

/** Safe HTML for a post body. Empty for an empty body. */
export function renderPostBody(markdown: string): string {
  if (!markdown.trim()) return '';
  return String(processor.processSync(markdown)).trim();
}
