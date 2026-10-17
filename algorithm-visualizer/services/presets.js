// Built-in algorithm presets. Each preset ships source in both JavaScript and
// Python (if available) plus an optional explicit kind/mapping hint. When a
// hint is present we skip the LLM call and use it directly; the hint also
// serves as the "ground truth" a developer can compare the LLM's pick against.

export const PRESETS = [
  {
    id: 'bubble-sort',
    label: 'Bubble sort',
    languages: ['js', 'python'],
    hint: { kind: 'array', mapping: { array: 'arr', cursors: ['i', 'j'] } },
    sources: {
      js: `// Bubble sort — watch swaps progress from the back.
const arr = [5, 2, 8, 1, 9, 3, 7, 4, 6];
for (let i = 0; i < arr.length; i++) {
  for (let j = 0; j < arr.length - i - 1; j++) {
    if (arr[j] > arr[j + 1]) {
      const tmp = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = tmp;
    }
  }
}
`,
      python: `# Bubble sort — watch swaps progress from the back.
arr = [5, 2, 8, 1, 9, 3, 7, 4, 6]
for i in range(len(arr)):
    for j in range(len(arr) - i - 1):
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]
`,
    },
  },
  {
    id: 'quicksort',
    label: 'Quicksort',
    languages: ['js', 'python'],
    hint: { kind: 'array', mapping: { array: 'arr', cursors: ['i', 'j'] } },
    sources: {
      js: `// Quicksort (Lomuto partition) on a fixed array.
const arr = [7, 2, 1, 8, 6, 3, 5, 4];

function partition(lo, hi) {
  const pivot = arr[hi];
  let i = lo - 1;
  for (let j = lo; j < hi; j++) {
    if (arr[j] <= pivot) {
      i++;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }
  const t = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = t;
  return i + 1;
}

function quicksort(lo, hi) {
  if (lo < hi) {
    const p = partition(lo, hi);
    quicksort(lo, p - 1);
    quicksort(p + 1, hi);
  }
}

quicksort(0, arr.length - 1);
`,
      python: `arr = [7, 2, 1, 8, 6, 3, 5, 4]

def partition(lo, hi):
    pivot = arr[hi]
    i = lo - 1
    for j in range(lo, hi):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]
    arr[i+1], arr[hi] = arr[hi], arr[i+1]
    return i + 1

def quicksort(lo, hi):
    if lo < hi:
        p = partition(lo, hi)
        quicksort(lo, p-1)
        quicksort(p+1, hi)

quicksort(0, len(arr)-1)
`,
    },
  },
  {
    id: 'bfs',
    label: 'Breadth-first search',
    languages: ['js', 'python'],
    hint: { kind: 'graph', mapping: { adjacency: 'graph', frontier: 'queue', visited: 'visited' } },
    sources: {
      js: `// BFS over a small undirected graph starting from 'A'.
const graph = {
  A: ['B', 'C'],
  B: ['A', 'D', 'E'],
  C: ['A', 'F'],
  D: ['B'],
  E: ['B', 'F'],
  F: ['C', 'E'],
};

const visited = [];
let queue = ['A'];
while (queue.length > 0) {
  const node = queue.shift();
  if (!visited.includes(node)) {
    visited.push(node);
    for (const neighbour of graph[node]) {
      queue.push(neighbour);
    }
  }
}
`,
      python: `graph = {
    'A': ['B', 'C'],
    'B': ['A', 'D', 'E'],
    'C': ['A', 'F'],
    'D': ['B'],
    'E': ['B', 'F'],
    'F': ['C', 'E'],
}

visited = []
queue = ['A']
while queue:
    node = queue.pop(0)
    if node not in visited:
        visited.append(node)
        for neighbour in graph[node]:
            queue.append(neighbour)
`,
    },
  },
  {
    id: 'dfs',
    label: 'Depth-first search',
    languages: ['js', 'python'],
    hint: { kind: 'graph', mapping: { adjacency: 'graph', frontier: 'stack', visited: 'visited' } },
    sources: {
      js: `// Iterative DFS.
const graph = {
  A: ['B', 'C'],
  B: ['A', 'D', 'E'],
  C: ['A', 'F'],
  D: ['B'],
  E: ['B', 'F'],
  F: ['C', 'E'],
};

const visited = [];
let stack = ['A'];
while (stack.length > 0) {
  const node = stack.pop();
  if (!visited.includes(node)) {
    visited.push(node);
    for (const neighbour of graph[node]) {
      stack.push(neighbour);
    }
  }
}
`,
      python: `graph = {
    'A': ['B', 'C'],
    'B': ['A', 'D', 'E'],
    'C': ['A', 'F'],
    'D': ['B'],
    'E': ['B', 'F'],
    'F': ['C', 'E'],
}

visited = []
stack = ['A']
while stack:
    node = stack.pop()
    if node not in visited:
        visited.append(node)
        for neighbour in graph[node]:
            stack.append(neighbour)
`,
    },
  },
  {
    id: 'dijkstra',
    label: 'Dijkstra shortest path',
    languages: ['js'],
    hint: { kind: 'graph', mapping: { adjacency: 'graph', distances: 'dist' } },
    sources: {
      js: `// Dijkstra with a naive "find min" loop.
const graph = {
  A: { B: 4, C: 1 },
  B: { A: 4, C: 2, D: 5 },
  C: { A: 1, B: 2, D: 8 },
  D: { B: 5, C: 8 },
};
const nodes = Object.keys(graph);

const dist = {};
const visited = {};
for (const n of nodes) dist[n] = Infinity;
dist['A'] = 0;

for (let step = 0; step < nodes.length; step++) {
  let u = null;
  let minD = Infinity;
  for (const n of nodes) {
    if (!visited[n] && dist[n] < minD) { minD = dist[n]; u = n; }
  }
  if (u === null) break;
  visited[u] = true;
  for (const v of Object.keys(graph[u])) {
    const alt = dist[u] + graph[u][v];
    if (alt < dist[v]) dist[v] = alt;
  }
}
`,
    },
  },
  {
    id: 'knapsack',
    label: 'Knapsack DP',
    languages: ['js', 'python'],
    hint: { kind: 'grid', mapping: { table: 'dp' } },
    sources: {
      js: `// 0/1 knapsack DP — table shows optimal value at (i, w).
const weights = [2, 3, 4, 5];
const values  = [3, 4, 5, 6];
const capacity = 8;

const dp = [];
for (let i = 0; i <= weights.length; i++) {
  dp.push(new Array(capacity + 1).fill(0));
}

for (let i = 1; i <= weights.length; i++) {
  for (let w = 0; w <= capacity; w++) {
    if (weights[i - 1] <= w) {
      dp[i][w] = Math.max(dp[i - 1][w], dp[i - 1][w - weights[i - 1]] + values[i - 1]);
    } else {
      dp[i][w] = dp[i - 1][w];
    }
  }
}
`,
      python: `weights = [2, 3, 4, 5]
values  = [3, 4, 5, 6]
capacity = 8

dp = [[0] * (capacity + 1) for _ in range(len(weights) + 1)]
for i in range(1, len(weights) + 1):
    for w in range(capacity + 1):
        if weights[i-1] <= w:
            dp[i][w] = max(dp[i-1][w], dp[i-1][w - weights[i-1]] + values[i-1])
        else:
            dp[i][w] = dp[i-1][w]
`,
    },
  },
  {
    id: 'a-star',
    label: 'A* on a grid',
    languages: ['js'],
    hint: { kind: 'grid', mapping: { table: 'grid', cursor: 'current' } },
    sources: {
      js: `// A* on a 8×8 grid with obstacles. Each cell: 0 = open, 1 = wall.
const W = 8, H = 8;
const grid = [
  [0,0,0,0,0,0,0,0],
  [0,1,1,0,1,1,1,0],
  [0,0,1,0,0,0,1,0],
  [0,0,1,1,1,0,1,0],
  [0,0,0,0,0,0,1,0],
  [0,1,1,1,1,0,0,0],
  [0,0,0,1,0,0,1,0],
  [0,0,0,0,0,0,0,0],
];
const start = { x: 0, y: 0 };
const goal  = { x: 7, y: 7 };

function h(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function key(p) { return p.x + ',' + p.y; }

const open = [{ ...start, g: 0, f: h(start, goal) }];
const closed = {};

while (open.length > 0) {
  open.sort((a, b) => a.f - b.f);
  const current = open.shift();
  if (current.x === goal.x && current.y === goal.y) break;
  closed[key(current)] = true;
  const neighbours = [
    { x: current.x + 1, y: current.y },
    { x: current.x - 1, y: current.y },
    { x: current.x, y: current.y + 1 },
    { x: current.x, y: current.y - 1 },
  ];
  for (const n of neighbours) {
    if (n.x < 0 || n.y < 0 || n.x >= W || n.y >= H) continue;
    if (grid[n.y][n.x] === 1) continue;
    if (closed[key(n)]) continue;
    const g = current.g + 1;
    open.push({ x: n.x, y: n.y, g, f: g + h(n, goal) });
  }
}
`,
    },
  },
];

export function getPreset(id) {
  return PRESETS.find(p => p.id === id) || null;
}

export function listPresetsForLanguage(lang) {
  return PRESETS.filter(p => p.languages.includes(lang));
}
