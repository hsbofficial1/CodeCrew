/**
 * Multimodal network graph.
 *
 * A plain node-to-node graph cannot express transshipment: switching road to
 * rail at Dimapur costs four hours and a handling fee, and is only possible
 * because Dimapur actually has a rail terminal. So the search space is expanded
 * to (node, mode) pairs. Moving between two modes at the same node is an
 * explicit transfer arc that exists only where both terminals do.
 *
 * On top of that sit Dijkstra (with edge/vertex bans) and Yen's algorithm for
 * genuinely distinct alternative routings.
 */
import { EDGES, MODES, WINDING } from '../data/edges.js';
import { NODE_BY_ID, NODES } from '../data/nodes.js';
import { haversineKm } from './geo.js';

export const SOURCE = '__source__';
export const SINK = '__sink__';

export const vkey = (nodeId, mode) => `${nodeId}::${mode}`;
export const unkey = (v) => {
  const [nodeId, mode] = v.split('::');
  return { nodeId, mode };
};

/** Does this node have the terminal a given mode needs? Road reaches everywhere. */
export function supportsMode(node, mode) {
  if (mode === 'road') return true;
  if (mode === 'rail') return node.terminals.rail;
  if (mode === 'water') return node.terminals.river;
  if (mode === 'air') return node.terminals.air;
  return false;
}

/** Resolve an edge's length, deriving it from geometry when not tabulated. */
export function edgeLengthKm(edge) {
  if (edge.km) return edge.km;
  const a = NODE_BY_ID[edge.from];
  const b = NODE_BY_ID[edge.to];
  const factor = WINDING[edge.mode]?.[edge.terrain] ?? 1.3;
  return Math.round(haversineKm(a, b) * factor);
}

/**
 * Validate the dataset: every edge must join two known nodes that both carry the
 * terminal its mode requires. Called at start-up so a typo fails loudly.
 */
export function validateNetwork() {
  const problems = [];
  for (const e of EDGES) {
    const a = NODE_BY_ID[e.from];
    const b = NODE_BY_ID[e.to];
    if (!a) problems.push(`edge ${e.from}-${e.to} (${e.mode}): unknown node ${e.from}`);
    if (!b) problems.push(`edge ${e.from}-${e.to} (${e.mode}): unknown node ${e.to}`);
    if (!a || !b) continue;
    if (!supportsMode(a, e.mode)) problems.push(`${e.from} has no ${e.mode} terminal but a ${e.mode} edge starts there`);
    if (!supportsMode(b, e.mode)) problems.push(`${e.to} has no ${e.mode} terminal but a ${e.mode} edge ends there`);
  }
  return problems;
}

/**
 * Build the expanded adjacency list.
 * @returns {{ adj: Map<string, Array<object>>, vertices: string[] }}
 */
export function buildGraph({ allowedModes = ['road', 'rail', 'water', 'air'] } = {}) {
  /** @type {Map<string, Array<object>>} */
  const adj = new Map();
  const push = (from, arc) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(arc);
  };

  const modes = allowedModes.filter((m) => MODES[m]);

  // Corridor arcs (both directions - every link in this network is two-way).
  for (const edge of EDGES) {
    if (!modes.includes(edge.mode)) continue;
    const km = edgeLengthKm(edge);
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      push(vkey(from, edge.mode), {
        type: 'travel',
        to: vkey(to, edge.mode),
        edge,
        km,
        fromNode: from,
        toNode: to,
        mode: edge.mode,
      });
    }
  }

  // Transfer arcs between modes co-located at one node.
  for (const node of NODES) {
    const available = modes.filter((m) => supportsMode(node, m));
    for (const a of available) {
      for (const b of available) {
        if (a === b) continue;
        push(vkey(node.id, a), {
          type: 'transfer',
          to: vkey(node.id, b),
          km: 0,
          fromNode: node.id,
          toNode: node.id,
          fromMode: a,
          mode: b,
        });
      }
    }
  }

  return { adj, vertices: [...adj.keys()] };
}

/**
 * Attach virtual source/sink so a single Dijkstra run covers every start mode.
 *
 * Transfer arcs at the origin and destination are stripped first. Entering in
 * any supported mode is already free at the origin, so a road->air transfer
 * there describes the same physical journey as simply starting in the air -
 * leaving them in makes Yen's algorithm spend its alternatives on duplicates.
 */
export function attachEndpoints(adj, originId, destId, allowedModes) {
  const origin = NODE_BY_ID[originId];
  const dest = NODE_BY_ID[destId];

  for (const [v, arcs] of adj) {
    if (arcs.some((a) => a.type === 'transfer' && (a.fromNode === originId || a.fromNode === destId))) {
      adj.set(v, arcs.filter((a) => !(a.type === 'transfer' && (a.fromNode === originId || a.fromNode === destId))));
    }
  }

  adj.set(
    SOURCE,
    allowedModes
      .filter((m) => supportsMode(origin, m))
      .map((m) => ({ type: 'enter', to: vkey(originId, m), km: 0, fromNode: originId, toNode: originId, mode: m })),
  );
  for (const m of allowedModes) {
    if (!supportsMode(dest, m)) continue;
    const v = vkey(destId, m);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(v).push({ type: 'exit', to: SINK, km: 0, fromNode: destId, toNode: destId, mode: m });
  }
}

// ------------------------------------------------------------- binary heap

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    this.a.push(item);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].k <= this.a[i].k) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.a.length && this.a[l].k < this.a[s].k) s = l;
        if (r < this.a.length && this.a[r].k < this.a[s].k) s = r;
        if (s === i) break;
        [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
        i = s;
      }
    }
    return top;
  }
}

/**
 * Dijkstra over the expanded graph.
 *
 * @param {Map<string, Array<object>>} adj
 * @param {string} source
 * @param {string} target
 * @param {(arc:object, fromVertex:string) => number} weightFn  must return >= 0
 * @param {{bannedVertices?:Set<string>, bannedArcs?:Set<string>}} bans
 * @returns {{ cost:number, arcs:object[], vertices:string[] } | null}
 */
export function dijkstra(adj, source, target, weightFn, bans = {}) {
  const bannedVertices = bans.bannedVertices ?? new Set();
  const bannedArcs = bans.bannedArcs ?? new Set();

  const dist = new Map([[source, 0]]);
  const prev = new Map();
  const settled = new Set();
  const heap = new MinHeap();
  heap.push({ k: 0, v: source });

  while (heap.size) {
    const { k, v } = heap.pop();
    if (settled.has(v)) continue;
    if (k > (dist.get(v) ?? Infinity)) continue;
    settled.add(v);
    if (v === target) break;

    for (const arc of adj.get(v) ?? []) {
      if (bannedVertices.has(arc.to)) continue;
      if (bannedArcs.has(arcId(v, arc))) continue;
      const w = weightFn(arc, v);
      if (!Number.isFinite(w)) continue;
      const nd = k + w;
      if (nd < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, nd);
        prev.set(arc.to, { from: v, arc });
        heap.push({ k: nd, v: arc.to });
      }
    }
  }

  if (!dist.has(target)) return null;

  const arcs = [];
  const vertices = [target];
  let cur = target;
  while (cur !== source) {
    const step = prev.get(cur);
    if (!step) return null;
    arcs.unshift(step.arc);
    vertices.unshift(step.from);
    cur = step.from;
  }
  return { cost: dist.get(target), arcs, vertices };
}

/**
 * Single-source Dijkstra to every reachable vertex. Used for network-wide
 * reachability, where running one search per destination would be wasteful.
 */
export function dijkstraFrom(adj, source, weightFn, bans = {}) {
  const bannedVertices = bans.bannedVertices ?? new Set();
  const bannedArcs = bans.bannedArcs ?? new Set();
  const dist = new Map([[source, 0]]);
  const settled = new Set();
  const heap = new MinHeap();
  heap.push({ k: 0, v: source });

  while (heap.size) {
    const { k, v } = heap.pop();
    if (settled.has(v)) continue;
    if (k > (dist.get(v) ?? Infinity)) continue;
    settled.add(v);
    for (const arc of adj.get(v) ?? []) {
      if (bannedVertices.has(arc.to)) continue;
      if (bannedArcs.has(arcId(v, arc))) continue;
      const w = weightFn(arc, v);
      if (!Number.isFinite(w)) continue;
      const nd = k + w;
      if (nd < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, nd);
        heap.push({ k: nd, v: arc.to });
      }
    }
  }
  return dist;
}

export const arcId = (fromVertex, arc) =>
  `${fromVertex}>${arc.to}#${arc.type}${arc.edge ? `@${arc.edge.from}-${arc.edge.to}-${arc.edge.mode}` : ''}`;

/**
 * Yen's algorithm for the K shortest loopless paths - this is what produces
 * genuinely different alternatives (a rail routing, a longer but drier road
 * routing) rather than three cosmetic variants of the same corridor.
 */
export function yenKShortest(adj, source, target, weightFn, K = 4) {
  const first = dijkstra(adj, source, target, weightFn);
  if (!first) return [];

  const accepted = [first];
  /** @type {Array<{cost:number, arcs:object[], vertices:string[]}>} */
  const candidates = [];

  for (let k = 1; k < K; k++) {
    const prevPath = accepted[k - 1];

    for (let i = 0; i < prevPath.arcs.length; i++) {
      const spurVertex = prevPath.vertices[i];
      const rootArcs = prevPath.arcs.slice(0, i);
      const rootVertices = prevPath.vertices.slice(0, i + 1);

      const bannedArcs = new Set();
      for (const p of [...accepted, ...candidates]) {
        const sameRoot =
          p.arcs.length > i &&
          rootArcs.every((a, j) => arcId(p.vertices[j], a) === arcId(p.vertices[j], p.arcs[j]));
        if (sameRoot) bannedArcs.add(arcId(p.vertices[i], p.arcs[i]));
      }
      const bannedVertices = new Set(rootVertices.slice(0, -1));

      const spur = dijkstra(adj, spurVertex, target, weightFn, { bannedArcs, bannedVertices });
      if (!spur) continue;

      const rootCost = rootArcs.reduce(
        (sum, a, j) => sum + weightFn(a, prevPath.vertices[j]),
        0,
      );
      const total = {
        cost: rootCost + spur.cost,
        arcs: [...rootArcs, ...spur.arcs],
        vertices: [...rootVertices.slice(0, -1), ...spur.vertices],
      };
      const sig = total.arcs.map((a, j) => arcId(total.vertices[j], a)).join('|');
      const known = [...accepted, ...candidates].some(
        (p) => p.arcs.map((a, j) => arcId(p.vertices[j], a)).join('|') === sig,
      );
      if (!known) candidates.push(total);
    }

    if (!candidates.length) break;
    candidates.sort((a, b) => a.cost - b.cost);
    accepted.push(candidates.shift());
  }

  return accepted;
}
