export interface TopFrecencyEntry {
  count: number;
  trigger: string;
}

function isBetter(
  trigger: string,
  count: number,
  other: TopFrecencyEntry
): boolean {
  return (
    count > other.count || (count === other.count && trigger < other.trigger)
  );
}

export function buildTopFrecency(
  counts: Record<string, number>,
  limit: number
): TopFrecencyEntry[] {
  if (limit <= 0) {
    return [];
  }

  const top = Object.entries(counts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([trigger, count]) => ({ trigger, count }))
    .sort((a, b) => b.count - a.count || a.trigger.localeCompare(b.trigger));

  if (top.length > limit) {
    top.length = limit;
  }
  return top;
}

export function updateTopFrecencyOnIncrement(
  top: TopFrecencyEntry[],
  trigger: string,
  count: number,
  limit: number
): void {
  if (limit <= 0 || count <= 0) {
    return;
  }

  let idx = -1;
  for (let i = 0; i < top.length; i++) {
    if (top[i].trigger === trigger) {
      idx = i;
      break;
    }
  }

  if (idx === -1) {
    if (top.length < limit) {
      top.push({ trigger, count });
      idx = top.length - 1;
    } else if (isBetter(trigger, count, top[top.length - 1])) {
      top[top.length - 1] = { trigger, count };
      idx = top.length - 1;
    } else {
      return;
    }
  } else {
    top[idx].count = count;
  }

  while (idx > 0 && isBetter(top[idx].trigger, top[idx].count, top[idx - 1])) {
    const prev = top[idx - 1];
    top[idx - 1] = top[idx];
    top[idx] = prev;
    idx--;
  }
}

export function serializeTopFrecency(top: readonly TopFrecencyEntry[]): string {
  if (top.length === 0) {
    return "";
  }
  let out = `${top[0].trigger}:${top[0].count}`;
  for (let i = 1; i < top.length; i++) {
    out += `.${top[i].trigger}:${top[i].count}`;
  }
  return out;
}
