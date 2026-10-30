/**
 * True when giving `taskId` the dependencies `dependsOn` would close a loop: some dependency
 * (directly or through other tasks) already depends on `taskId`. `others` maps the other tasks
 * of the plan to their dependencies. Iterative, so a long chain cannot overflow the stack.
 */
export function createsCycle(
  taskId: string,
  dependsOn: readonly string[],
  others: ReadonlyMap<string, readonly string[]>,
): boolean {
  const seen = new Set<string>();
  const stack = [...dependsOn];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(others.get(id) ?? []));
  }
  return false;
}
