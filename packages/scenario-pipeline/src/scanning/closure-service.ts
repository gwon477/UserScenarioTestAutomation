import { extname, posix } from "node:path";
import type { SourceFileRecord, SourceSnapshot } from "@scenarioforge/contracts";

export type SourceClosure = { source_ids: string[]; files: SourceFileRecord[]; truncated: boolean; estimated_chars: number };

const candidatesFor = (from: string, imported: string): string[] => {
  if (!imported.startsWith(".")) return [];
  const base = posix.normalize(posix.join(posix.dirname(from), imported));
  if (extname(base)) return [base];
  return [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"].flatMap((extension) => [`${base}${extension}`, `${base}/index${extension}`]);
};

export class ClosureService {
  build(snapshot: SourceSnapshot, entrySourceIds: string[], budgetChars = 120_000): SourceClosure {
    const byId = new Map(snapshot.files.map((file) => [file.source_id, file]));
    const byPath = new Map(snapshot.files.map((file) => [file.path, file]));
    const entryIds = new Set(entrySourceIds);
    const prioritizeEntries = (left: string, right: string): number => Number(entryIds.has(right)) - Number(entryIds.has(left)) || left.localeCompare(right);
    const queue = [...entryIds].sort(prioritizeEntries);
    const selected: SourceFileRecord[] = [];
    const visited = new Set<string>();
    let chars = 0;
    let truncated = false;
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const file = byId.get(id);
      if (!file) throw new Error("SOURCE_ID_NOT_FOUND");
      if (chars + file.size_bytes > budgetChars) { truncated = true; continue; }
      selected.push(file); chars += file.size_bytes;
      for (const imported of file.imports) {
        const target = candidatesFor(file.path, imported).map((path) => byPath.get(path)).find(Boolean);
        if (target && !visited.has(target.source_id)) queue.push(target.source_id);
      }
      queue.sort(prioritizeEntries);
    }
    return { source_ids: selected.map((file) => file.source_id), files: selected, truncated, estimated_chars: chars };
  }
}
