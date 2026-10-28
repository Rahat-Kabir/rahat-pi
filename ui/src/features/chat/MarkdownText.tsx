import Markdown, { type Components } from 'react-markdown';

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-300">{children}</blockquote>
  ),
  code: ({ children }) => <code className="rounded bg-slate-200 px-1 font-mono text-[0.85em] dark:bg-slate-700">{children}</code>,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-slate-200 p-2 font-mono text-xs dark:bg-slate-900 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline dark:text-indigo-400">{children}</a>
  ),
  // An image would load as soon as it renders, so a prompt-injected image URL could
  // leak chat text to another server. Show it as text instead.
  img: ({ alt, src }) => <span className="text-slate-500">[image: {alt || 'untitled'} ({src})]</span>,
  hr: () => <hr className="my-3 border-slate-300 dark:border-slate-600" />,
};

// Model text as Markdown. Raw HTML stays text (no rehype-raw), and react-markdown's
// default URL check drops unsafe links such as javascript:.
export function MarkdownText({ text }: { text: string }) {
  return <Markdown components={components}>{text}</Markdown>;
}
