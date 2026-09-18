import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript-compiler";
import type { SourceApiRecord, SourceFileRecord, SourceInteractionRecord, SourceRouteRecord, SourceShellRecord, SourceSnapshot } from "@scenarioforge/contracts";
import { apiId, elementId, screenId, sourceId } from "./deterministic-id.js";
import { analyzeSourceInteractionBehaviors } from "./source-interaction-behavior.js";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".swift", ".kt", ".java", ".cs", ".py", ".json"]);
const excludedDirectories = new Set([".git", ".scenarioforge", ".claude", ".history", ".cache", ".vite", ".turbo", ".venv", "venv", "__pycache__", "node_modules", "site-packages", "dist", "build", "out", "release", "coverage", ".next", "test", "tests", "fixtures", "__fixtures__", "mocks", "__mocks__", "generated"]);
const excludedFiles = new Set(["package-lock.json"]);
const excludedPath = (root: string, path: string): boolean => {
  const relativePath = posix(relative(root, path)).toLowerCase();
  return relativePath.includes("/data/runtime/")
    || relativePath.startsWith("data/runtime/")
    || /(?:^|[/_.-])golden(?:[/_.-]|$)/.test(relativePath)
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/.test(relativePath);
};

export type ScanRequest = { projectRoot: string; projectId: string; analysisRunId: string; sourceSnapshotId: string; now?: string };

async function walk(root: string, cursor = root): Promise<string[]> {
  const entries = await readdir(cursor, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name.toLowerCase())) continue;
    const path = join(cursor, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, path)));
    else if (entry.isFile() && !excludedFiles.has(entry.name) && !excludedPath(root, path) && sourceExtensions.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

const posix = (path: string): string => path.split(sep).join("/");
const lineAt = (source: ts.SourceFile, position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
const literalText = (node: ts.Node | undefined): string | undefined => node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const interactiveJsxTags = new Set(["button", "a", "input", "select", "textarea"]);
type JsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const cleanLabel = (value: string): string => value.replace(/\s+/g, " ").trim();
const readableParts = (values: string[]): string => [...new Set(values.map(cleanLabel).filter(Boolean))].join(" / ");

function jsxTagName(opening: JsxOpening): string | undefined {
  return ts.isIdentifier(opening.tagName) ? opening.tagName.text.toLowerCase() : undefined;
}

function jsxAttribute(opening: JsxOpening, name: string): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
}

function expressionLabels(expression: ts.Expression | undefined): string[] {
  if (!expression) return [];
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return expressionLabels(expression.expression);
  if (ts.isConditionalExpression(expression)) return [...expressionLabels(expression.whenTrue), ...expressionLabels(expression.whenFalse)];
  if (ts.isTemplateExpression(expression)) {
    const parts = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
    return [cleanLabel(parts.join(" "))].filter(Boolean);
  }
  if (ts.isBinaryExpression(expression)) return [...expressionLabels(expression.left), ...expressionLabels(expression.right)];
  return [];
}

function jsxAttributeLabel(opening: JsxOpening, name: string): string | undefined {
  const initializer = jsxAttribute(opening, name)?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return cleanLabel(initializer.text) || undefined;
  if (!ts.isJsxExpression(initializer)) return undefined;
  const label = readableParts(expressionLabels(initializer.expression));
  return label || undefined;
}

function jsxAttributeIdentity(opening: JsxOpening, name: string): string | undefined {
  const initializer = jsxAttribute(opening, name)?.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  return ts.isJsxExpression(initializer) && initializer.expression && ts.isIdentifier(initializer.expression)
    ? initializer.expression.text
    : undefined;
}

function jsxTextParts(node: ts.Node, excluded?: ts.Node): string[] {
  if (node === excluded) return [];
  if (ts.isJsxText(node)) return [node.text];
  if (ts.isJsxExpression(node)) return expressionLabels(node.expression);
  if (ts.isJsxElement(node)) return node.children.flatMap((child) => jsxTextParts(child, excluded));
  return [];
}

const semanticLabel = (value: string): boolean => /[\p{L}\p{N}]/u.test(value);

function ownJsxLabel(opening: JsxOpening): string | undefined {
  if (!ts.isJsxOpeningElement(opening) || !ts.isJsxElement(opening.parent) || opening.parent.openingElement !== opening) return undefined;
  const label = readableParts(opening.parent.children.flatMap((child) => jsxTextParts(child)));
  return label && semanticLabel(label) ? label : undefined;
}

function associatedJsxLabel(opening: JsxOpening): string | undefined {
  let cursor: ts.Node | undefined = opening.parent;
  while (cursor && !ts.isSourceFile(cursor)) {
    if (ts.isJsxElement(cursor) && jsxTagName(cursor.openingElement) === "label") {
      const label = readableParts(cursor.children.flatMap((child) => jsxTextParts(child, opening)));
      return label || undefined;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function interactionKind(tag: string, opening: JsxOpening): string {
  if (tag !== "input") return tag;
  const inputType = jsxAttributeLabel(opening, "type")?.toLowerCase();
  if (["checkbox", "radio", "file", "range", "number"].includes(inputType ?? "")) return inputType!;
  if (["button", "submit", "reset"].includes(inputType ?? "")) return "button";
  return "input";
}

function interactionRole(tag: string, kind: string): string {
  if (tag === "a") return "link";
  if (kind === "select") return "combobox";
  if (kind === "number") return "spinbutton";
  if (kind === "range") return "slider";
  if (["checkbox", "radio", "button"].includes(kind)) return kind;
  return "textbox";
}

function linkedJsxLabels(source: ts.SourceFile): Map<string, string> {
  const labels = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === "label") {
      const htmlFor = jsxAttributeIdentity(node.openingElement, "htmlFor");
      const label = readableParts(node.children.flatMap((child) => jsxTextParts(child)));
      if (htmlFor && label) labels.set(htmlFor, label);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return labels;
}

function interactionLabel(opening: JsxOpening, kind: string, linkedLabels: Map<string, string>): string {
  const linkedLabel = jsxAttributeIdentity(opening, "id");
  return jsxAttributeLabel(opening, "aria-label")
    ?? (linkedLabel ? linkedLabels.get(linkedLabel) : undefined)
    ?? ownJsxLabel(opening)
    ?? associatedJsxLabel(opening)
    ?? jsxAttributeLabel(opening, "title")
    ?? jsxAttributeLabel(opening, "placeholder")
    ?? kind;
}

function importsOf(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => ts.isImportDeclaration(statement) ? [literalText(statement.moduleSpecifier)!] : []).filter(Boolean).sort();
}

function pageComponentName(node: ts.Node | undefined): string | undefined {
  let cursor = node;
  while (cursor && !ts.isSourceFile(cursor)) {
    const name = ts.isFunctionDeclaration(cursor) || ts.isFunctionExpression(cursor)
      ? cursor.name?.text
      : ts.isArrowFunction(cursor) && ts.isVariableDeclaration(cursor.parent) && ts.isIdentifier(cursor.parent.name)
        ? cursor.parent.name.text
        : undefined;
    if (name && /^[A-Z][A-Za-z0-9_$]*Page$/.test(name)) return name;
    cursor = cursor.parent;
  }
  return undefined;
}

function enclosingComponentName(node: ts.Node | undefined): string | undefined {
  let cursor = node;
  while (cursor && !ts.isSourceFile(cursor)) {
    const name = ts.isFunctionDeclaration(cursor) || ts.isFunctionExpression(cursor)
      ? cursor.name?.text
      : ts.isArrowFunction(cursor) && ts.isVariableDeclaration(cursor.parent) && ts.isIdentifier(cursor.parent.name)
        ? cursor.parent.name.text
        : undefined;
    if (name && /^[A-Z][A-Za-z0-9_$]*$/.test(name)) return name;
    cursor = cursor.parent;
  }
  return undefined;
}

function apiCallOf(call: ts.CallExpression): { method: string; path: string } | undefined {
  if (ts.isIdentifier(call.expression) && call.expression.text === "fetch") {
    const path = literalText(call.arguments[0]);
    if (!path) return undefined;
    const options = call.arguments[1];
    const methodProperty = options && ts.isObjectLiteralExpression(options)
      ? options.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && ((ts.isIdentifier(property.name) && property.name.text === "method") || (ts.isStringLiteralLike(property.name) && property.name.text === "method")))
      : undefined;
    return { method: literalText(methodProperty?.initializer)?.toUpperCase() ?? "GET", path };
  }

  const bareMethodCall = ts.isIdentifier(call.expression);
  const method = bareMethodCall
    ? call.expression.text.toUpperCase()
    : ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === "axios"
      ? call.expression.name.text.toUpperCase()
      : undefined;
  const path = literalText(call.arguments[0]);
  if (bareMethodCall && path && !/^(?:https?:\/\/|\/)/i.test(path)) return undefined;
  return method && httpMethods.has(method) && path ? { method, path } : undefined;
}

function containedPageComponents(element: ts.JsxElement): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (opening && opening !== element.openingElement && ts.isIdentifier(opening.tagName) && /^[A-Z][A-Za-z0-9_$]*Page$/.test(opening.tagName.text)) {
      names.add(opening.tagName.text);
    }
    ts.forEachChild(node, visit);
  };
  element.children.forEach(visit);
  return [...names].sort();
}

function extractInventories(content: string, path: string, record: SourceFileRecord): { routes: SourceRouteRecord[]; apis: SourceApiRecord[]; interactions: SourceInteractionRecord[]; shells: SourceShellRecord[] } {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const linkedLabels = linkedJsxLabels(source);
  record.imports = importsOf(source);
  const routes: SourceRouteRecord[] = [];
  const apis: SourceApiRecord[] = [];
  const interactions: SourceInteractionRecord[] = [];
  const shells: SourceShellRecord[] = [];
  const routeMatches = [...content.matchAll(/(?:<Route\b[^>]*\bpath\s*=\s*["']|\bpath\s*:\s*["'])(\/[^"']*)["']/g)];
  for (const match of routeMatches) routes.push({ screen_id: screenId(match[1]), route: match[1], source_id: record.source_id, line: content.slice(0, match.index).split("\n").length });
  const explicitDefaultScreen = routes[0]?.screen_id;
  const componentScreens = new Set<string>();
  const helperOwners = new Map<string, Set<string>>();
  const collectHelperOwners = (node: ts.Node): void => {
    const opening = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (opening && ts.isIdentifier(opening.tagName) && /^[A-Z]/.test(opening.tagName.text)) {
      const owner = pageComponentName(opening);
      if (owner && opening.tagName.text !== owner) {
        const owners = helperOwners.get(opening.tagName.text) ?? new Set<string>();
        owners.add(owner);
        helperOwners.set(opening.tagName.text, owners);
      }
    }
    ts.forEachChild(node, collectHelperOwners);
  };
  collectHelperOwners(source);
  const ownedPageComponent = (node: ts.Node): string | undefined => {
    const direct = pageComponentName(node);
    if (direct) return direct;
    const helper = enclosingComponentName(node);
    const owners = helper ? helperOwners.get(helper) : undefined;
    return owners?.size === 1 ? [...owners][0] : undefined;
  };
  const visit = (node: ts.Node): void => {
    if (!explicitDefaultScreen && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
      const componentName = pageComponentName(node);
      if (componentName && !componentScreens.has(componentName)) {
        componentScreens.add(componentName);
        routes.push({ screen_id: screenId(`component:${componentName}`), route: `component:${componentName}`, source_id: record.source_id, line: lineAt(source, node.getStart(source)) });
      }
    }
    if (ts.isCallExpression(node)) {
      const api = apiCallOf(node);
      if (api) {
        const componentName = explicitDefaultScreen ? undefined : ownedPageComponent(node);
        const targetScreen = explicitDefaultScreen ?? (componentName ? screenId(`component:${componentName}`) : undefined);
        apis.push({ api_id: apiId(api.method, api.path), ...(targetScreen ? { screen_id: targetScreen } : {}), method: api.method, path: api.path, source_id: record.source_id, line: lineAt(source, node.getStart(source)) });
      }
    }
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName) && /^[A-Z][A-Za-z0-9_$]*$/.test(node.openingElement.tagName.text)
      && !/Page$/.test(node.openingElement.tagName.text)) {
      const contained = containedPageComponents(node);
      const shellScreen = explicitDefaultScreen ?? (ownedPageComponent(node.openingElement) ? screenId(`component:${ownedPageComponent(node.openingElement)}`) : undefined);
      const containedScreens = contained.map((name) => screenId(`component:${name}`)).filter((id) => id !== shellScreen);
      if (shellScreen && containedScreens.length) {
        shells.push({ shell_screen_id: shellScreen, contained_screen_ids: containedScreens, source_id: record.source_id, line: lineAt(source, node.getStart(source)) });
      }
    }
    const opening = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (opening) {
      const tag = jsxTagName(opening);
      if (tag && interactiveJsxTags.has(tag)) {
        const kind = interactionKind(tag, opening);
        const label = interactionLabel(opening, kind, linkedLabels);
        const line = lineAt(source, opening.getStart(source));
        const testId = jsxAttributeLabel(opening, "data-testid") ?? jsxAttributeLabel(opening, "data-test") ?? jsxAttributeLabel(opening, "testID");
        const candidates: SourceInteractionRecord["target_candidates"] = [];
        if (testId) candidates.push({ by: "test-id", value: testId });
        if (kind === "file") candidates.push({ by: "css", value: 'input[type="file"]' });
        else candidates.push({ by: "role-name", role: interactionRole(tag, kind), name: label });
        const sourcePosition = opening.getStart(source);
        const componentName = explicitDefaultScreen ? undefined : ownedPageComponent(opening);
        const targetScreen = explicitDefaultScreen ?? (componentName ? screenId(`component:${componentName}`) : undefined);
        interactions.push({ element_id: elementId(targetScreen ?? record.source_id, kind, label, `${path}:${sourcePosition}`), screen_id: targetScreen, kind, label, source_id: record.source_id, line, target_candidates: candidates });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { routes, apis, interactions, shells };
}

export class SourceScanner {
  async scan(request: ScanRequest): Promise<SourceSnapshot> {
    const root = resolve(request.projectRoot);
    const files: SourceFileRecord[] = [];
    const routes: SourceRouteRecord[] = [];
    const apis: SourceApiRecord[] = [];
    const interactions: SourceInteractionRecord[] = [];
    const shells: SourceShellRecord[] = [];
    const sourceByPath = new Map<string, string>();
    const i18n: Record<string, string> = {};
    const uiStacks = new Set<string>();
    for (const absolutePath of await walk(root)) {
      const path = posix(relative(root, absolutePath));
      const content = await readFile(absolutePath, "utf8");
      sourceByPath.set(path, content);
      const record: SourceFileRecord = { source_id: sourceId(path), path, language: extname(path).slice(1) || "unknown", content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`, size_bytes: Buffer.byteLength(content), imports: [] };
      files.push(record);
      if (/\.(tsx|jsx)$/.test(path)) uiStacks.add("react");
      if (path.endsWith(".vue")) uiStacks.add("vue");
      if (path.endsWith(".svelte")) uiStacks.add("svelte");
      if (/\.swift$/.test(path)) uiStacks.add("swiftui");
      if (/\.(kt|java)$/.test(path)) uiStacks.add("android");
      if (/\.cs$/.test(path)) uiStacks.add("dotnet-desktop");
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
        const found = extractInventories(content, path, record);
        routes.push(...found.routes); apis.push(...found.apis); interactions.push(...found.interactions); shells.push(...found.shells);
      }
      if (path.endsWith(".json") && /(?:locales?|i18n|messages?)/i.test(path)) {
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") i18n[key] = value;
        } catch {}
      }
    }
    const fileHashes = files.map((file) => `${file.path}:${file.content_hash}`).join("\n");
    const snapshot: SourceSnapshot = {
      schema_version: 1, project_id: request.projectId, analysis_run_id: request.analysisRunId, source_snapshot_id: request.sourceSnapshotId,
      created_at: request.now ?? new Date().toISOString(), root_hash: `sha256:${createHash("sha256").update(fileHashes).digest("hex")}`,
      ui_stacks: [...uiStacks].sort(), unsupported_ui_stacks: [], files, routes, apis, interactions, shells, i18n,
    };
    snapshot.source_behaviors = analyzeSourceInteractionBehaviors(snapshot, sourceByPath);
    return snapshot;
  }
}
