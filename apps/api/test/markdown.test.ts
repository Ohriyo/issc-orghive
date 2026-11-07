import { describe, expect, it } from 'vitest';
import { renderPostBody } from '#src/lib/markdown';

describe('renderPostBody', () => {
  it('renders the allowed Markdown', () => {
    const html = renderPostBody(
      '## Results\n\n**Bold** and *italic*.\n\n- one\n- two\n\n1. first\n\n> A quote',
    );
    expect(html).toContain('<h2>Results</h2>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
  });

  it('keeps headings between h2 and h4', () => {
    expect(renderPostBody('# Top')).toBe('<h2>Top</h2>');
    expect(renderPostBody('###### Deep')).toBe('<h4>Deep</h4>');
  });

  it('drops raw HTML, scripts and images', () => {
    const html = renderPostBody(
      'Hi <script>alert(1)</script><b onclick="x()">there</b>\n\n<iframe src="https://evil.test"></iframe>\n\n![x](https://evil.test/a.png)',
    );
    expect(html).not.toMatch(/<script|<iframe|<img|onclick|<b>/i);
    expect(html).toContain('Hi');
  });

  it('drops javascript: and data: links but keeps their text', () => {
    const html = renderPostBody('[click](javascript:alert(1)) [data](data:text/html,hi)');
    expect(html).not.toMatch(/javascript:|data:/i);
    expect(html).toContain('click');
  });

  it('opens web links in a new tab with noopener nofollow', () => {
    expect(renderPostBody('[site](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener nofollow">site</a></p>',
    );
    expect(renderPostBody('[mail](mailto:asit@example.com)')).toBe(
      '<p><a href="mailto:asit@example.com">mail</a></p>',
    );
  });

  it('is empty for an empty body', () => {
    expect(renderPostBody('   ')).toBe('');
  });
});
