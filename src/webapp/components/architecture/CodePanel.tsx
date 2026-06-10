import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import { useEffect, useState } from 'react';
import type { ArchFile } from './data.ts';

hljs.registerLanguage('typescript', typescript);

// Module-level cache: raw source per path, loaded once per session.
const sourceCache = new Map<string, string>();

interface CodePanelProps {
  files: ArchFile[];
  activePath: string;
  onSelect: (path: string) => void;
}

const fileName = (path: string): string => path.split('/').pop() ?? path;

export function CodePanel({ files, activePath, onSelect }: CodePanelProps) {
  const [html, setHtml] = useState<string | null>(null);

  const active = files.find((file) => file.path === activePath) ?? files[0];

  useEffect(() => {
    let cancelled = false;
    const cached = sourceCache.get(active.path);
    const render = (source: string) => {
      if (!cancelled) {
        setHtml(hljs.highlight(source, { language: 'typescript' }).value);
      }
    };
    if (cached !== undefined) {
      render(cached);
    } else {
      setHtml(null);
      active
        .load()
        .then((source) => {
          sourceCache.set(active.path, source);
          render(source);
        })
        .catch(() => {
          if (!cancelled) {
            setHtml(hljs.highlight('// failed to load source', { language: 'typescript' }).value);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onSelect(file.path)}
            title={file.path}
            className={`rounded-md px-2 py-1 font-mono text-xs transition-colors ${
              file.path === active.path
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {fileName(file.path)}
          </button>
        ))}
      </div>
      <p className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-zinc-500">
        {active.path}
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {html === null ? (
          <p className="p-4 font-mono text-xs text-zinc-500">Loading source…</p>
        ) : (
          <pre className="p-4 text-xs leading-relaxed">
            {/* Source is build-time embedded repo code run through highlight.js — trusted input. */}
            {/* oxlint-disable-next-line no-danger */}
            <code className="hljs language-typescript" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        )}
      </div>
    </div>
  );
}
