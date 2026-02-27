export interface BuildNode<T> {
  children: Map<string, BuildNode<T>>;
  maxRelevance: number;
  terminal: T | null;
}

export function buildRadixTrie<T>(
  items: T[],
  getKey: (item: T) => string,
  getRelevance: (item: T) => number
): BuildNode<T> {
  const root: BuildNode<T> = {
    children: new Map(),
    maxRelevance: 0,
    terminal: null,
  };

  for (const item of items) {
    let node = root;
    let key = getKey(item);
    let created = false;

    while (key.length > 0) {
      let found = false;
      for (const [edge, child] of node.children) {
        let common = 0;
        const limit = Math.min(key.length, edge.length);
        while (
          common < limit &&
          key.charCodeAt(common) === edge.charCodeAt(common)
        ) {
          common++;
        }

        if (common === 0) {
          continue;
        }

        if (common === edge.length) {
          node = child;
          key = key.substring(common);
          found = true;
          break;
        }

        // Partial match — split edge
        const splitNode: BuildNode<T> = {
          children: new Map(),
          maxRelevance: 0,
          terminal: null,
        };
        node.children.delete(edge);
        node.children.set(edge.substring(0, common), splitNode);
        splitNode.children.set(edge.substring(common), child);
        node = splitNode;
        key = key.substring(common);
        found = true;
        break;
      }

      if (!found) {
        const leaf: BuildNode<T> = {
          children: new Map(),
          maxRelevance: getRelevance(item),
          terminal: item,
        };
        node.children.set(key, leaf);
        created = true;
        break;
      }
    }

    if (!created) {
      node.terminal = item;
    }
  }

  function computeMax(node: BuildNode<T>): number {
    let max = node.terminal ? getRelevance(node.terminal) : 0;
    for (const child of node.children.values()) {
      max = Math.max(max, computeMax(child));
    }
    node.maxRelevance = max;
    return max;
  }
  computeMax(root);

  return root;
}
