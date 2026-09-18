import ts from "typescript-compiler";
import type {
  SourceApiConnectionRecord,
  SourceBehaviorBranchRecord,
  SourceBehaviorRecord,
  SourceCodeReference,
  SourceSnapshot,
  SourceViewStateFacet,
} from "@scenarioforge/contracts";

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
type ClientOperation = { symbol: string; method: string; path: string; sourceRef: SourceCodeReference };
type BackendFailure = { status: number; guardKey?: string; sourceRef: SourceCodeReference };
type BackendEndpoint = {
  method: string;
  path: string;
  handler: string;
  services: string[];
  authGuards: string[];
  successStatuses: number[];
  failures: BackendFailure[];
  sourceRef: SourceCodeReference;
};

const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const lineAt = (source: ts.SourceFile, position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
const nameText = (name: ts.PropertyName | ts.BindingName | undefined): string | undefined =>
  name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) ? name.text : undefined;

function callSymbol(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${expression.expression.getText()}.${expression.name.text}`;
  return undefined;
}

function pathPattern(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return `${node.head.text}${node.templateSpans.map((span, index) => {
      const tokens = span.expression.getText()
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      const urlBase = index === 0 && node.head.text === ""
        && tokens.some((token) => ["base", "url", "origin", "host", "endpoint"].includes(token));
      return `${urlBase ? "{url-base}" : "{}"}${span.literal.text}`;
    }).join("")}`;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = pathPattern(node.left);
    const right = pathPattern(node.right);
    return left === undefined && right === undefined ? undefined : `${left ?? "{}"}${right ?? "{}"}`;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["encodeURIComponent", "String"].includes(node.expression.text)) return "{}";
  return undefined;
}

function methodFromOptions(node: ts.Expression | undefined): string {
  if (!node || !ts.isObjectLiteralExpression(node)) return "GET";
  const property = node.properties.find((entry): entry is ts.PropertyAssignment =>
    ts.isPropertyAssignment(entry) && nameText(entry.name) === "method",
  );
  return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text.toUpperCase() : "GET";
}

function httpCall(call: ts.CallExpression): { method: string; path: string } | undefined {
  const symbol = callSymbol(call.expression);
  if (!symbol) return undefined;
  const leaf = symbol.split(".").at(-1)!;
  const directMethod = leaf.toUpperCase();
  const path = pathPattern(call.arguments[0]);
  if (!path || !path.includes("/")) return undefined;
  if (leaf === "fetch") return { method: methodFromOptions(call.arguments[1]), path };
  if (httpMethods.has(directMethod)) return { method: directMethod, path };
  if (/^(?:request|send|call)$/i.test(leaf)) return { method: methodFromOptions(call.arguments[1]), path };
  return undefined;
}

function httpCalls(node: ts.Node): Array<{ call: ts.CallExpression; method: string; path: string }> {
  const found: Array<{ call: ts.CallExpression; method: string; path: string }> = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate)) {
      const operation = httpCall(candidate);
      if (operation) found.push({ call: candidate, ...operation });
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function referenceFor(snapshot: SourceSnapshot, path: string, line: number): SourceCodeReference | undefined {
  const file = snapshot.files.find((entry) => entry.path === path);
  return file ? {
    source_id: file.source_id,
    source_snapshot_id: snapshot.source_snapshot_id,
    path: file.path,
    line,
    content_hash: file.content_hash,
  } : undefined;
}

function parseTypescriptFile(path: string, content: string): ts.SourceFile {
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function collectClientOperations(snapshot: SourceSnapshot, sourceByPath: ReadonlyMap<string, string>): ClientOperation[] {
  const operations: ClientOperation[] = [];
  for (const [path, content] of sourceByPath) {
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(path)) continue;
    const source = parseTypescriptFile(path, content);
    const add = (symbol: string, node: ts.Node): void => {
      for (const found of httpCalls(node)) {
        const sourceRef = referenceFor(snapshot, path, lineAt(source, found.call.getStart(source)));
        if (sourceRef) operations.push({ symbol, method: found.method, path: normalizeClientPath(found.path), sourceRef });
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) add(node.name.text, node.initializer);
        if (ts.isObjectLiteralExpression(node.initializer)) {
          for (const property of node.initializer.properties) {
            const propertyName = nameText(property.name);
            if (!propertyName) continue;
            if (ts.isMethodDeclaration(property)) add(`${node.name.text}.${propertyName}`, property);
            if (ts.isPropertyAssignment(property) && (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))) {
              add(`${node.name.text}.${propertyName}`, property.initializer);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Map(operations.map((entry) => [`${entry.symbol}:${entry.method}:${entry.path}`, entry])).values()]
    .sort((left, right) => left.symbol.localeCompare(right.symbol)
      || left.method.localeCompare(right.method)
      || left.path.localeCompare(right.path));
}

function collectFunctionTargets(sourceByPath: ReadonlyMap<string, string>, operations: readonly ClientOperation[]): Map<string, ClientOperation[]> {
  const byFunction = new Map<string, ClientOperation[]>();
  const operationFor = (symbol: string): ClientOperation[] => {
    const exact = operations.filter((entry) => entry.symbol === symbol);
    if (exact.length) return exact;
    const leaf = symbol.split(".").at(-1);
    const suffix = operations.filter((entry) => entry.symbol.split(".").at(-1) === leaf);
    return suffix.length === 1 ? suffix : [];
  };
  for (const [path, content] of sourceByPath) {
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(path)) continue;
    const source = parseTypescriptFile(path, content);
    const inspect = (name: string, node: FunctionNode): void => {
      const targets: ClientOperation[] = [];
      const visit = (candidate: ts.Node): void => {
        if (ts.isCallExpression(candidate)) {
          const symbol = callSymbol(candidate.expression);
          if (symbol) targets.push(...operationFor(symbol));
        }
        ts.forEachChild(candidate, visit);
      };
      if (node.body) visit(node.body);
      if (targets.length) byFunction.set(name, [...new Map(targets.map((entry) => [entry.symbol, entry])).values()]);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) inspect(node.name.text, node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        inspect(node.name.text, node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return byFunction;
}

function localCallBindings(path: string, sourceByPath: ReadonlyMap<string, string>): Map<string, string> {
  const content = sourceByPath.get(path);
  const bindings = new Map<string, string>();
  if (!content || !/\.(?:[cm]?[jt]sx?)$/i.test(path)) return bindings;
  const source = parseTypescriptFile(path, content);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const symbol = callSymbol(node.initializer.expression);
      if (symbol) bindings.set(node.name.text, symbol);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

function normalizeClientPath(path: string): string {
  const withoutQuery = path.split("?")[0]!.replace(/^\{url-base\}(?=\/|$)/, "");
  return withoutQuery.replace(/([^/])\{\}/g, "$1").replace(/\/+/g, "/");
}

function pathMatches(clientPath: string, backendPath: string): boolean {
  const segments = (value: string) => normalizeClientPath(value).split("/").filter(Boolean).map((part) => /^\{[^}]*\}$/.test(part) || part === "{}" ? "{}" : part);
  const left = segments(clientPath);
  const right = segments(backendPath);
  return left.length > 0 && left.length === right.length
    && left.every((part, index) => part === "{}" || right[index] === "{}" || part === right[index]);
}

const pathSegmentCount = (path: string): number => normalizeClientPath(path).split("/").filter(Boolean).length;

const indentation = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;
const normalizedCondition = (condition: string): string => condition.replace(/\s+/g, " ").trim().slice(0, 180);
const authorizationDependency = (symbol: string): boolean =>
  /(?:auth|authoriz|permission|privilege|role|require|principal|identity|current_?user|access)/i.test(symbol);

function pythonRouterPrefixes(lines: readonly string[]): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const assignment = lines[index]!.match(/^\s*([A-Za-z_]\w*)\s*=\s*(?:(?:[A-Za-z_]\w*)\.)*APIRouter\s*\(/);
    if (!assignment) continue;
    let end = index;
    let balance = 0;
    do {
      const current = lines[end] ?? "";
      balance += (current.match(/\(/g) ?? []).length - (current.match(/\)/g) ?? []).length;
      end += 1;
    } while (end < lines.length && balance > 0);
    const prefix = lines.slice(index, end).join("\n").match(/\bprefix\s*=\s*["']([^"']+)["']/)?.[1];
    if (prefix) prefixes.set(assignment[1]!, prefix);
    index = end - 1;
  }
  return prefixes;
}

function prefixedRoutePath(prefix: string | undefined, path: string): string {
  return normalizeClientPath(`${prefix ?? ""}/${path}`);
}

function guardKey(condition: string, status?: number): string {
  const normalized = normalizedCondition(condition);
  if (status === 401 || status === 403) return `authorization:${normalized}`;
  if (/\bstage\b/i.test(normalized)) return `stage:${normalized}`;
  if (/\b(?:decision|approve|approved|reject|rejected)\b/i.test(normalized)) return `decision:${normalized}`;
  if (/\bstatus\b/i.test(normalized)) return `business-status:${normalized}`;
  return `condition:${normalized}`;
}

function collectBackendEndpoints(snapshot: SourceSnapshot, sourceByPath: ReadonlyMap<string, string>): BackendEndpoint[] {
  const endpoints: BackendEndpoint[] = [];
  for (const [path, content] of sourceByPath) {
    if (!path.endsWith(".py")) continue;
    const lines = content.split(/\r?\n/);
    const routerPrefixes = pythonRouterPrefixes(lines);
    for (let index = 0; index < lines.length; index += 1) {
      const routeStart = lines[index]!.match(/^\s*@([A-Za-z_]\w*)\.(get|post|put|patch|delete)\(/i);
      if (!routeStart) continue;
      let decoratorEnd = index;
      let balance = 0;
      do {
        const current = lines[decoratorEnd] ?? "";
        balance += (current.match(/\(/g) ?? []).length - (current.match(/\)/g) ?? []).length;
        decoratorEnd += 1;
      } while (decoratorEnd < lines.length && balance > 0);
      const decorator = lines.slice(index, decoratorEnd).join("\n");
      const declaredRoutePath = decorator.match(/\(\s*["']([^"']+)["']/)?.[1];
      if (!declaredRoutePath) continue;
      const routePath = prefixedRoutePath(routerPrefixes.get(routeStart[1]!), declaredRoutePath);
      let defIndex = decoratorEnd;
      while (defIndex < lines.length && !/^\s*(?:async\s+)?def\s+/.test(lines[defIndex]!)) defIndex += 1;
      if (defIndex >= lines.length || lines.slice(index + 1, defIndex).some((line) => /^\s*@\w+\.(?:get|post|put|patch|delete)\(/i.test(line))) continue;
      let signatureEnd = defIndex;
      while (signatureEnd + 1 < lines.length && !/\)\s*(?:->\s*[^:]+)?\s*:\s*$/.test(lines[signatureEnd]!)) signatureEnd += 1;
      const definition = lines.slice(defIndex, signatureEnd + 1).join("\n");
      const handler = definition.match(/(?:async\s+)?def\s+([A-Za-z_]\w*)/)?.[1];
      if (!handler) continue;
      const defIndent = indentation(lines[defIndex]!);
      let end = signatureEnd + 1;
      while (end < lines.length) {
        const candidate = lines[end]!;
        if (candidate.trim() && indentation(candidate) <= defIndent) break;
        end += 1;
      }
      const bodyLines = lines.slice(signatureEnd + 1, end);
      const body = bodyLines.join("\n");
      const sourceRef = referenceFor(snapshot, path, defIndex + 1);
      if (!sourceRef) continue;
      const authGuards = [...new Set(`${decorator}\n${definition}`.match(/Depends\(\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\)/g)?.map((match) => match.match(/Depends\(\s*([^\s)]+)/)![1]!) ?? [])]
        .filter(authorizationDependency)
        .sort();
      const services = new Set<string>();
      for (const match of body.matchAll(/\b([A-Za-z_]\w*)\([^\n)]*\)\.([A-Za-z_]\w*)\s*\(/g)) services.add(`${match[1]}.${match[2]}`);
      for (const match of body.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
        if (!["router", "HTTPException"].includes(match[1]!)) services.add(`${match[1]}.${match[2]}`);
      }
      const failures: BackendFailure[] = [];
      const conditions: Array<{ indent: number; condition: string }> = [];
      for (let offset = 0; offset < bodyLines.length; offset += 1) {
        const line = bodyLines[offset]!;
        const currentIndent = indentation(line);
        while (conditions.length && conditions.at(-1)!.indent >= currentIndent && line.trim()) conditions.pop();
        const condition = line.match(/^\s*(?:if|elif)\s+(.+):\s*$/)?.[1];
        if (condition) conditions.push({ indent: currentIndent, condition });
        if (!/raise\s+HTTPException\s*\(/.test(line)) continue;
        const block = bodyLines.slice(offset, offset + 8).join("\n");
        const status = Number(block.match(/status_code\s*=\s*(\d{3})/)?.[1] ?? block.match(/HTTPException\s*\(\s*(\d{3})/)?.[1]);
        if (!Number.isInteger(status)) continue;
        failures.push({
          status,
          ...(conditions.at(-1) ? { guardKey: guardKey(conditions.at(-1)!.condition, status) } : {}),
          sourceRef: { ...sourceRef, line: signatureEnd + offset + 2 },
        });
      }
      const successStatus = Number(decorator.match(/status_code\s*=\s*(\d{3})/)?.[1] ?? 200);
      endpoints.push({
        method: routeStart[2]!.toUpperCase(),
        path: routePath,
        handler,
        services: [...services].sort(),
        authGuards,
        successStatuses: [successStatus],
        failures,
        sourceRef,
      });
      index = end - 1;
    }
  }
  return endpoints;
}

function stateFacet(key: string): SourceViewStateFacet {
  if (/tab/i.test(key)) return "tab";
  if (/(?:modal|dialog|open)$/i.test(key)) return "modal";
  if (/(?:select|selected|selection|current)/i.test(key)) return "selection";
  if (/(?:load|loading|pending|requesting|saving)/i.test(key)) return "loading";
  if (/(?:error|failure|failed)/i.test(key)) return "error";
  return "state";
}

function nextViewStates(behavior: SourceBehaviorRecord, sourceByPath: ReadonlyMap<string, string>): string[] {
  const content = sourceByPath.get(behavior.path);
  if (!content) return behavior.literal_navigation_targets.map((target) => `screen:${target}`);
  const source = parseTypescriptFile(behavior.path, content);
  const setterToState = new Map<string, string>();
  const handlerLines = new Set(behavior.handler_lines);
  const output = new Set(behavior.literal_navigation_targets.map((target) => `screen:${target}`));
  const collectSetters = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements.length > 1) {
      const state = node.name.elements[0];
      const setter = node.name.elements[1];
      if (state && setter && ts.isBindingElement(state) && ts.isBindingElement(setter) && ts.isIdentifier(state.name) && ts.isIdentifier(setter.name)) setterToState.set(setter.name.text, state.name.text);
    }
    ts.forEachChild(node, collectSetters);
  };
  collectSetters(source);
  const collectValues = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && setterToState.has(node.expression.text)) {
      const value = node.arguments[0];
      if (value && (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value) || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword)) {
        output.add(`${setterToState.get(node.expression.text)}:${value.getText(source).replace(/^["']|["']$/g, "")}`);
      }
    }
    ts.forEachChild(node, collectValues);
  };
  const visitFunctions = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && handlerLines.has(lineAt(source, node.getStart(source)))) collectValues(node);
    ts.forEachChild(node, visitFunctions);
  };
  visitFunctions(source);
  return [...output].sort();
}

function frontendGuards(behavior: SourceBehaviorRecord, sourceByPath: ReadonlyMap<string, string>): string[] {
  const line = sourceByPath.get(behavior.path)?.split(/\r?\n/)[behavior.line - 1] ?? "";
  const expression = line.match(/disabled\s*=\s*\{([^}]+)\}/)?.[1];
  if (!expression) return [];
  return [...new Set(expression.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])]
    .filter((token) => !["true", "false", "null", "undefined"].includes(token))
    .map((token) => `frontend:${token}`)
    .sort();
}

const uniqueRefs = (refs: Array<SourceCodeReference | undefined>): SourceCodeReference[] => [...new Map(refs.filter((ref): ref is SourceCodeReference => Boolean(ref)).map((ref) => [`${ref.source_id}:${ref.line}`, ref])).values()]
  .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);

export function enrichSourceInteractionBehaviors(
  snapshot: SourceSnapshot,
  sourceByPath: ReadonlyMap<string, string>,
  behaviors: readonly SourceBehaviorRecord[],
): SourceBehaviorRecord[] {
  const operations = collectClientOperations(snapshot, sourceByPath);
  const functionTargets = collectFunctionTargets(sourceByPath, operations);
  const endpoints = collectBackendEndpoints(snapshot, sourceByPath);
  const operationFor = (symbol: string, bindings: ReadonlyMap<string, string>): ClientOperation[] => {
    const exact = operations.filter((entry) => entry.symbol === symbol);
    if (exact.length) return exact;
    const root = symbol.split(".")[0]!;
    const bound = bindings.get(root);
    if (bound && functionTargets.has(bound)) return functionTargets.get(bound)!;
    const leaf = symbol.split(".").at(-1)!;
    const suffix = operations.filter((entry) => entry.symbol.split(".").at(-1) === leaf);
    return suffix.length === 1 ? suffix : [];
  };

  return behaviors.map((behavior) => {
    const interaction = snapshot.interactions.find((entry) => entry.element_id === behavior.element_id);
    const frontendRef = referenceFor(snapshot, behavior.path, behavior.line);
    const handlerRefs = behavior.handler_lines.map((line) => referenceFor(snapshot, behavior.path, line));
    const bindings = localCallBindings(behavior.path, sourceByPath);
    const unresolved: string[] = [];
    const selectedOperations = new Map<string, ClientOperation>();
    for (const symbol of behavior.called_symbols) {
      const matched = operationFor(symbol, bindings);
      matched.forEach((entry) => selectedOperations.set(`${entry.symbol}:${entry.method}:${entry.path}`, entry));
      if (!matched.length && /(?:^|\.)(?:[A-Za-z0-9_$]*Api)\./.test(symbol)) unresolved.push(`API_CLIENT_OPERATION_UNRESOLVED:${symbol}`);
    }
    const responseStates = [...behavior.local_state_keys].sort();
    const nextStates = nextViewStates(behavior, sourceByPath);
    const connections: SourceApiConnectionRecord[] = [];
    for (const operation of selectedOperations.values()) {
      const candidates = endpoints.filter((endpoint) => endpoint.method === operation.method && pathMatches(operation.path, endpoint.path));
      const exactLength = candidates.filter((endpoint) => pathSegmentCount(operation.path) === pathSegmentCount(endpoint.path));
      const matches = exactLength.length ? exactLength : candidates;
      const endpoint = matches.length === 1 ? matches[0] : undefined;
      if (!endpoint) unresolved.push(`${matches.length > 1 ? "BACKEND_ENDPOINT_AMBIGUOUS" : "BACKEND_ENDPOINT_UNRESOLVED"}:${operation.method}:${operation.path}`);
      const sourceRefs = uniqueRefs([operation.sourceRef, endpoint?.sourceRef]);
      connections.push({
        api_symbol: operation.symbol,
        method: operation.method,
        path: operation.path,
        source_refs: sourceRefs,
        ...(endpoint ? { backend: {
          route_method: endpoint.method,
          route_path: endpoint.path,
          handler_symbol: endpoint.handler,
          service_symbols: endpoint.services,
          auth_guards: endpoint.authGuards,
          success_statuses: endpoint.successStatuses,
          failure_statuses: [...new Set(endpoint.failures.map((failure) => failure.status))].sort((left, right) => left - right),
          source_refs: [endpoint.sourceRef],
        } } : {}),
        feasibility: endpoint ? (responseStates.length || nextStates.length ? "verified" : "inferred") : "unresolved",
      });
    }
    const branches: SourceBehaviorBranchRecord[] = [];
    let normalOrdinal = 0;
    let exceptionOrdinal = 0;
    for (const connection of connections) {
      const endpoint = endpoints.find((entry) => connection.backend && entry.handler === connection.backend.handler_symbol && entry.path === connection.backend.route_path);
      for (const status of endpoint?.successStatuses ?? []) branches.push({
        branch_ref: `normal:${++normalOrdinal}`,
        outcome: "normal",
        guard_keys: [],
        response_status: status,
        business_outcome: endpoint!.handler,
        feasibility: connection.feasibility,
        source_refs: connection.source_refs,
      });
      for (const authGuard of endpoint?.authGuards ?? []) branches.push({
        branch_ref: `exception:${++exceptionOrdinal}`,
        outcome: "exception",
        guard_keys: [`authorization:${authGuard}`],
        feasibility: "inferred",
        source_refs: [endpoint!.sourceRef],
      });
      for (const failure of endpoint?.failures ?? []) branches.push({
        branch_ref: `exception:${++exceptionOrdinal}`,
        outcome: "exception",
        guard_keys: failure.guardKey ? [failure.guardKey] : [],
        response_status: failure.status,
        feasibility: "verified",
        source_refs: [failure.sourceRef],
      });
    }
    const outcomeEvidenced = behavior.literal_navigation_targets.length > 0 || (behavior.stable_outcomes ?? []).length > 0;
    if (!branches.length && (!unresolved.length || outcomeEvidenced) && (behavior.journey_required || behavior.local_view_only)) branches.push({
      branch_ref: "normal:1",
      outcome: "normal",
      guard_keys: [],
      feasibility: unresolved.length ? "inferred" : "verified",
      source_refs: uniqueRefs([frontendRef, ...handlerRefs]),
    });
    if (behavior.explicit_failure && !branches.some((branch) => branch.outcome === "exception")) branches.push({
      branch_ref: "exception:1",
      outcome: "exception",
      guard_keys: ["frontend:failure"],
      feasibility: "verified",
      source_refs: uniqueRefs([frontendRef, ...handlerRefs]),
    });
    const personaGuards = [...new Set(connections.flatMap((connection) => connection.backend?.auth_guards ?? []))].sort();
    const entryGuards = [...new Set([...frontendGuards(behavior, sourceByPath), ...personaGuards.map((guard) => `authorization:${guard}`)])].sort();
    const sourceRefs = uniqueRefs([frontendRef, ...handlerRefs, ...connections.flatMap((connection) => connection.source_refs), ...branches.flatMap((branch) => branch.source_refs)]);
    const feasibility = unresolved.length
      ? connections.some((connection) => connection.feasibility !== "unresolved") || outcomeEvidenced ? "inferred" : "unresolved"
      : connections.length ? connections.every((connection) => connection.feasibility === "verified") ? "verified" : "inferred"
        : "verified";
    return {
      ...behavior,
      ...(interaction?.screen_id ? { screen_id: interaction.screen_id } : {}),
      entry_guards: entryGuards,
      persona_guards: personaGuards,
      view_state: {
        ...(interaction?.screen_id ? { screen_id: interaction.screen_id } : {}),
        states: responseStates.map((key) => ({ key, facet: stateFacet(key) })),
      },
      api_connections: connections,
      response_consumer: { state_keys: responseStates, next_view_states: nextStates, source_refs: uniqueRefs([frontendRef, ...handlerRefs]) },
      feasibility,
      branches,
      source_refs: sourceRefs,
      unresolved: [...new Set(unresolved)].sort(),
      explicit_failure: behavior.explicit_failure || branches.some((branch) => branch.outcome === "exception"),
      journey_required: behavior.journey_required || connections.length > 0 || unresolved.length > 0,
    };
  });
}
