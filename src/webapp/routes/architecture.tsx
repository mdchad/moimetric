import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { CodePanel } from '#src/webapp/components/architecture/CodePanel.tsx';
import {
  type ArchNode,
  CANVAS_H,
  CANVAS_W,
  EDGES,
  KIND_LABELS,
  NODE_H,
  NODE_W,
  type NodeKind,
  NODES,
} from '#src/webapp/components/architecture/data.ts';
import { getSessionUser } from '#src/webapp/data/auth.ts';
import 'highlight.js/styles/github-dark.css';

export const Route = createFileRoute('/architecture')({
  beforeLoad: async () => {
    const user = await getSessionUser();
    if (!user) {
      throw redirect({ to: '/login' });
    }
  },
  component: ArchitecturePage,
});

const DEFAULT_NODE_ID = 'domain';

const KIND_STYLES: Record<NodeKind, { box: string; badge: string }> = {
  web: {
    box: 'border-sky-400/60 bg-sky-950/60 hover:border-sky-300',
    badge: 'bg-sky-500/15 text-sky-300',
  },
  domain: {
    box: 'border-violet-400/60 bg-violet-950/60 hover:border-violet-300',
    badge: 'bg-violet-500/15 text-violet-300',
  },
  aws: {
    box: 'border-orange-400/60 bg-orange-950/50 hover:border-orange-300',
    badge: 'bg-orange-500/15 text-orange-300',
  },
  data: {
    box: 'border-emerald-400/60 bg-emerald-950/60 hover:border-emerald-300',
    badge: 'bg-emerald-500/15 text-emerald-300',
  },
  external: {
    box: 'border-dashed border-zinc-500 bg-zinc-900 hover:border-zinc-300',
    badge: 'bg-zinc-500/15 text-zinc-300',
  },
};

interface Point {
  x: number;
  y: number;
}

// Attach the arrow to the side of the box facing the other node.
const anchor = (from: ArchNode, to: ArchNode): Point => {
  const HALF = 2;
  const fromCx = from.x + NODE_W / HALF;
  const fromCy = from.y + NODE_H / HALF;
  const dx = to.x + NODE_W / HALF - fromCx;
  const dy = to.y + NODE_H / HALF - fromCy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: fromCx + Math.sign(dx) * (NODE_W / HALF), y: fromCy };
  }
  return { x: fromCx, y: fromCy + Math.sign(dy) * (NODE_H / HALF) };
};

const edgePath = (from: ArchNode, to: ArchNode): string => {
  const HALF = 2;
  const start = anchor(from, to);
  const end = anchor(to, from);
  const horizontal = Math.abs(end.x - start.x) > Math.abs(end.y - start.y);
  if (horizontal) {
    const midX = (start.x + end.x) / HALF;
    return `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
  }
  const midY = (start.y + end.y) / HALF;
  return `M ${start.x} ${start.y} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`;
};

const edgeMidpoint = (from: ArchNode, to: ArchNode): Point => {
  const HALF = 2;
  const start = anchor(from, to);
  const end = anchor(to, from);
  return { x: (start.x + end.x) / HALF, y: (start.y + end.y) / HALF };
};

function ArchitecturePage() {
  const [selectedId, setSelectedId] = useState(DEFAULT_NODE_ID);
  const [activePath, setActivePath] = useState<string | null>(null);

  const nodeById = new Map(NODES.map((node) => [node.id, node]));
  const selected = nodeById.get(selectedId) ?? NODES[0];
  const codePath = activePath ?? selected.files[0].path;

  const selectNode = (id: string) => {
    setSelectedId(id);
    setActivePath(null); // reset to the node's first file
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Main column: diagram + explanation */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Architecture</h1>
          <p className="text-sm text-zinc-400">
            The live map of the codebase. Click a box to read its explanation here and its source on
            the right. Arrows are real call/data relationships.
          </p>
        </header>

        {/* Diagram */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
            <svg width={CANVAS_W} height={CANVAS_H} className="absolute inset-0" aria-hidden="true">
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="#52525b" />
                </marker>
                <marker
                  id="arrow-active"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="#a78bfa" />
                </marker>
              </defs>
              {EDGES.map((edge) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) {
                  return null;
                }
                const active = edge.from === selectedId || edge.to === selectedId;
                const mid = edgeMidpoint(from, to);
                return (
                  <g key={`${edge.from}->${edge.to}`}>
                    <path
                      d={edgePath(from, to)}
                      fill="none"
                      stroke={active ? '#a78bfa' : '#3f3f46'}
                      strokeWidth={active ? 2 : 1.25}
                      markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow)'}
                    />
                    {active ? (
                      <text
                        x={mid.x}
                        y={mid.y - 6}
                        textAnchor="middle"
                        className="select-none"
                        fill="#c4b5fd"
                        fontSize="11"
                        paintOrder="stroke"
                        stroke="#09090b"
                        strokeWidth="3"
                      >
                        {edge.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>

            {NODES.map((node) => {
              const style = KIND_STYLES[node.kind];
              const isSelected = node.id === selectedId;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => selectNode(node.id)}
                  className={`absolute rounded-lg border p-2 text-left transition-all ${style.box} ${
                    isSelected ? 'ring-2 ring-violet-400 ring-offset-2 ring-offset-zinc-950' : ''
                  }`}
                  style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                >
                  <span className="block truncate text-sm font-semibold">{node.title}</span>
                  <span className="block truncate font-mono text-[11px] text-zinc-400">
                    {node.subtitle}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(KIND_LABELS) as NodeKind[]).map((kind) => (
            <span
              key={kind}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLES[kind].badge}`}
            >
              {KIND_LABELS[kind]}
            </span>
          ))}
        </div>

        {/* Explanation */}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLES[selected.kind].badge}`}
            >
              {KIND_LABELS[selected.kind]}
            </span>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-300">{selected.summary}</p>
          {selected.invariants && selected.invariants.length > 0 ? (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Invariants
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
                {selected.invariants.map((invariant) => (
                  <li key={invariant}>{invariant}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Source files
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {selected.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setActivePath(file.path)}
                  className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                    file.path === codePath
                      ? 'border-violet-400/60 bg-violet-950/50 text-violet-200'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {file.path}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Right panel: source code */}
      <aside className="hidden w-[44rem] shrink-0 border-l border-zinc-800 bg-zinc-950 lg:block">
        <CodePanel files={selected.files} activePath={codePath} onSelect={setActivePath} />
      </aside>
    </div>
  );
}
