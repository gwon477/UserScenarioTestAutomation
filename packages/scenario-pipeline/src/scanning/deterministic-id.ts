import { createHash } from "node:crypto";

const slug = (value: string): string => value.toLowerCase().replace(/\[[^\]]+\]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root";
const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 8);

export const sourceId = (path: string): string => `SRC-${slug(path.replace(/\.[^.]+$/, ""))}-${shortHash(path)}`;
export const screenId = (route: string): string => `SCR-${slug(route)}`;
export const apiId = (method: string, path: string): string => `API-${method.toUpperCase()}-${slug(path)}`;
export const elementId = (screen: string, kind: string, label: string, sourcePath: string): string => `EL-${slug(screen.replace(/^SCR-/, ""))}-${slug(kind)}-${slug(label)}-${shortHash(sourcePath)}`;
export const edgeId = (ordinal: number): string => `E-${String(ordinal).padStart(4, "0")}`;
export const workflowId = (fromScreenId: string, elementId: string, guard = "always"): string => `WF-${slug(fromScreenId.replace(/^SCR-/, ""))}-${shortHash(`${fromScreenId}:${elementId}:${guard}`)}`;
export const scenarioId = (workflow: string, ordinal: number): string => `SCN-${slug(workflow.replace(/^WF-/, "")).toUpperCase()}-${String(ordinal).padStart(3, "0")}`;
