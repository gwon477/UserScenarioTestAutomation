import ts from "typescript-compiler";
import type { FactBundle, SourceBehaviorRecord, SourceSnapshot, ValidationIssue } from "@scenarioforge/contracts";
import { auditTransitionCoverage, type TransitionCoverageAudit, type TransitionCoverageClaim, type TransitionObligation } from "../graph/transition-coverage-audit.js";
import { enrichSourceInteractionBehaviors } from "./source-cross-layer-metadata.js";

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

export type SourceInteractionBehavior = SourceBehaviorRecord;

const runtimeDependentCall = (symbol: string): boolean =>
  symbol === "fetch" || /(?:^|\.)(?:[A-Za-z0-9_$]*Api)\./.test(symbol);

export function sourceBehaviorTransitionObligations(behaviors: readonly SourceInteractionBehavior[]): TransitionObligation[] {
  return behaviors.flatMap((behavior) => {
    const scope = behavior.local_view_only ? "view" : behavior.journey_required ? "journey" : undefined;
    if (!scope || behavior.feasibility === "unresolved") return [];
    if (behavior.branches?.length) return behavior.branches.map((branch) => ({
      source_action_ref: behavior.element_id,
      branch_ref: branch.branch_ref,
      scope,
      outcome: branch.outcome,
      feasibility: branch.feasibility === "verified" ? "source-supported" : "runtime-unverified",
    }));
    const runtimeDependent = behavior.called_symbols.some(runtimeDependentCall);
    const normal: TransitionObligation = {
      source_action_ref: behavior.element_id,
      branch_ref: "normal:1",
      scope,
      outcome: "normal",
      feasibility: runtimeDependent ? "runtime-unverified" : "source-supported",
    };
    return behavior.explicit_failure
      ? [normal, {
        source_action_ref: behavior.element_id,
        branch_ref: "exception:1",
        scope,
        outcome: "exception",
        feasibility: "runtime-unverified",
      }]
      : [normal];
  });
}

export function createSourceTransitionObligationInventory(
  snapshot: Pick<SourceSnapshot, "source_snapshot_id" | "interactions">,
  behaviors: readonly SourceInteractionBehavior[],
) {
  const behaviorByElement = new Map(behaviors.map((behavior) => [behavior.element_id, behavior]));
  const obligations = sourceBehaviorTransitionObligations(behaviors);
  const obligatedActions = new Set(obligations.map((obligation) => obligation.source_action_ref));
  return {
    schema_version: 1 as const,
    artifact_type: "source-transition-obligations" as const,
    source_snapshot_ref: snapshot.source_snapshot_id,
    branch_inventory_status: "lower-bound" as const,
    obligations: obligations.map((obligation, index) => {
      const behavior = behaviorByElement.get(obligation.source_action_ref)!;
      return {
        transition_ref: `T${String(index + 1).padStart(3, "0")}`,
        ...obligation,
        source_ref: behavior.source_id,
        line: behavior.line,
      };
    }),
    unresolved_interactions: snapshot.interactions
      .filter((interaction) => !obligatedActions.has(interaction.element_id))
      .map((interaction) => ({
        source_action_ref: interaction.element_id,
        source_ref: interaction.source_id,
        line: interaction.line,
        kind: interaction.kind,
      })),
  };
}

export function factTransitionCoverageClaims(facts: Pick<FactBundle, "edges">): TransitionCoverageClaim[] {
  const ordinalByActionAndOutcome = new Map<string, number>();
  return [...facts.edges]
    .sort((left, right) => left.edge_id.localeCompare(right.edge_id))
    .map((edge) => {
      const key = `${edge.on}:${edge.kind}`;
      const ordinal = (ordinalByActionAndOutcome.get(key) ?? 0) + 1;
      ordinalByActionAndOutcome.set(key, ordinal);
      return {
        source_action_ref: edge.on,
        branch_ref: edge.source_branch_ref ?? `${edge.kind}:${ordinal}`,
        outcome: edge.kind,
        edge_ref: edge.edge_id,
      };
    });
}

export function auditFactSourceBehaviorTransitions(
  facts: Pick<FactBundle, "edges">,
  behaviors: readonly SourceInteractionBehavior[],
): TransitionCoverageAudit {
  return auditTransitionCoverage(sourceBehaviorTransitionObligations(behaviors), factTransitionCoverageClaims(facts));
}

type ComponentUse = { owner?: string; attributes: Map<string, ts.Expression> };
type Analysis = {
  handlerLines: Set<number>;
  calledSymbols: Set<string>;
  localStateKeys: Set<string>;
  literalNavigationTargets: Set<string>;
  rootSymbols: Set<string>;
  stableOutcomes: Set<string>;
  explicitFailure: boolean;
  meaningfulCalls: Set<string>;
};

const lineAt = (source: ts.SourceFile, position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
const literalText = (node: ts.Node | undefined): string | undefined => node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const groupBy = <T, K>(items: readonly T[], keyFor: (item: T) => K): Map<K, T[]> => {
  const grouped = new Map<K, T[]>();
  items.forEach((item) => {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });
  return grouped;
};

function functionName(node: FunctionNode): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text;
  return ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined;
}

function enclosingComponentName(node: ts.Node | undefined): string | undefined {
  let cursor = node;
  while (cursor && !ts.isSourceFile(cursor)) {
    if (ts.isFunctionDeclaration(cursor) || ts.isFunctionExpression(cursor) || ts.isArrowFunction(cursor)) {
      const name = functionName(cursor);
      if (name && /^[A-Z][A-Za-z0-9_$]*$/.test(name)) return name;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function jsxExpression(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): ts.Expression | undefined {
  const attribute = opening.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  return attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
}

function nativeFormSubmitControl(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  const tag = ts.isIdentifier(opening.tagName) ? opening.tagName.text.toLowerCase() : "";
  const typeAttribute = opening.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === "type",
  );
  const type = typeAttribute?.initializer && ts.isStringLiteral(typeAttribute.initializer)
    ? typeAttribute.initializer.text.toLowerCase()
    : undefined;
  return tag === "button" ? type !== "button" && type !== "reset" : tag === "input" && type === "submit";
}

function bubblingJsxExpression(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  names: string[],
): ts.Expression | undefined {
  let cursor: ts.Node | undefined = opening.parent;
  while (cursor && !ts.isSourceFile(cursor)) {
    if (ts.isJsxElement(cursor) && cursor.openingElement !== opening) {
      const ancestorOpening = cursor.openingElement;
      if (ts.isIdentifier(ancestorOpening.tagName) && /^[A-Z]/.test(ancestorOpening.tagName.text)) return undefined;
      const handler = names.map((name) => jsxExpression(ancestorOpening, name)).find(Boolean);
      if (handler) return handler;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function componentProps(node: FunctionNode): Set<string> {
  const parameter = node.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return new Set();
  return new Set(parameter.name.elements.flatMap((element) => ts.isIdentifier(element.name) ? [element.name.text] : []));
}

function callSymbol(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = ts.isIdentifier(expression.expression) ? expression.expression.text : expression.expression.getText();
    return `${left}.${expression.name.text}`;
  }
  return undefined;
}

function normalizedTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

const normalizedStateKey = (value: string): string => value
  .replace(/^PRED-/i, "")
  .replace(/[^a-z0-9]+/gi, "")
  .toLowerCase();
export function sourceStateKeyMatchesPredicate(stateKey: string, predicateId: string): boolean {
  const normalizedState = normalizedStateKey(stateKey);
  const normalizedPredicate = normalizedStateKey(predicateId);
  if (!normalizedState) return false;
  if (normalizedPredicate.includes(normalizedState)) return true;
  const stateTokens = normalizedTokens(stateKey).filter((token) => !["state", "status", "value", "data", "info"].includes(token));
  return stateTokens.length > 0 && stateTokens.every((token) => normalizedPredicate.includes(token));
}
const stableOutcomeValue = (value: string): boolean =>
  /^(?:completed?|succeeded|success|done|ready|loaded|parsed|authenticated|exported|downloaded|generated)$/i.test(value);

const evidenceKey = (evidence: FactBundle["predicates"][number]["evidence"][number]): string =>
  `${evidence.source_id}:${evidence.path}:${evidence.start_line}:${evidence.end_line}:${evidence.content_hash}`;

export function validateFactCatalogSourceBehaviors(
  facts: Pick<FactBundle, "screens" | "predicates">,
  behaviors: SourceInteractionBehavior[],
): ValidationIssue[] {
  const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const issues: ValidationIssue[] = [];

  for (const behavior of behaviors) {
    if (!behavior.journey_required && !behavior.local_view_only) continue;
    const element = elements.get(behavior.element_id);
    if (!element) continue;
    if (element.interaction.action_kind === "unresolved" && behavior.feasibility !== "unresolved") {
      issues.push({
        code: "FACT_SOURCE_ACTION_UNRESOLVED",
        severity: "error",
        path: `$.screens.elements[id=${behavior.element_id}].interaction.action_kind`,
        message: `${behavior.element_id} at ${behavior.path}:${behavior.line} is a backend-classified ${behavior.local_view_only ? "view" : "journey"} action but its semantic action_kind remains unresolved.`,
      });
    }
    const elementEvidence = new Set(element.evidence.map(evidenceKey));
    const linkedPredicates = facts.predicates.filter((predicate) =>
      predicate.evidence.some((evidence) => elementEvidence.has(evidenceKey(evidence))));
    const requiredStateKeys = behavior.local_view_only ? behavior.local_state_keys : behavior.downstream_consumed_state_keys;
    const missing = requiredStateKeys.filter((stateKey) => !linkedPredicates.some((predicate) => sourceStateKeyMatchesPredicate(stateKey, predicate.pred_id)));
    if (missing.length) {
      issues.push({
        code: "FACT_SOURCE_STATE_PREDICATE_MISSING",
        severity: "error",
        path: `$.predicates[element=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${behavior.path}:${behavior.line} changes source-backed ${behavior.local_view_only ? "view" : "journey"} state without evidence-linked predicates; states=${missing.join("|")}.`,
      });
    }
    if (/(?:^|[_-])(?:download|export)(?:$|[_-])/i.test(element.interaction.action_kind)
      && !linkedPredicates.some((predicate) => /(?:download|export|output)/i.test(predicate.pred_id) && predicate.values.some(stableOutcomeValue))) {
      issues.push({
        code: "FACT_SOURCE_STABLE_OUTCOME_PREDICATE_MISSING",
        severity: "error",
        path: `$.predicates[element=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${behavior.path}:${behavior.line} is a source-backed ${element.interaction.action_kind} action without an evidence-linked stable success/output predicate value.`,
      });
    }
  }

  return issues;
}

export function analyzeSourceInteractionBehaviors(
  snapshot: SourceSnapshot,
  sourceByPath: ReadonlyMap<string, string>,
): SourceInteractionBehavior[] {
  const files = new Map(snapshot.files.map((file) => [file.source_id, file]));
  const output: SourceInteractionBehavior[] = [];

  for (const [sourceId, sourceInteractions] of groupBy(snapshot.interactions, (interaction) => interaction.source_id)) {
    const file = files.get(sourceId);
    const content = file ? sourceByPath.get(file.path) : undefined;
    if (!file || content === undefined || !/\.(?:[cm]?[jt]sx?)$/i.test(file.path)) continue;
    const source = ts.createSourceFile(file.path, content, ts.ScriptTarget.Latest, true, file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const definitions = new Map<string, FunctionNode>();
    const setterToState = new Map<string, string>();
    const propsByComponent = new Map<string, Set<string>>();
    const usesByComponent = new Map<string, ComponentUse[]>();
    const openingsByLine = new Map<number, Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement>>();

    const collect = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        const name = functionName(node);
        if (name) {
          definitions.set(name, node);
          if (/^[A-Z]/.test(name)) propsByComponent.set(name, componentProps(node));
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
        const callback = node.initializer.arguments[0];
        if (callback && (ts.isFunctionExpression(callback) || ts.isArrowFunction(callback))) definitions.set(node.name.text, callback);
      }
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements.length >= 2) {
        const state = node.name.elements[0];
        const setter = node.name.elements[1];
        if (state && setter && ts.isBindingElement(state) && ts.isBindingElement(setter) && ts.isIdentifier(state.name) && ts.isIdentifier(setter.name)) {
          setterToState.set(setter.name.text, state.name.text);
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = node;
        const line = lineAt(source, opening.getStart(source));
        openingsByLine.set(line, [...(openingsByLine.get(line) ?? []), opening]);
        if (ts.isIdentifier(opening.tagName) && /^[A-Z]/.test(opening.tagName.text)) {
          const attributes = new Map<string, ts.Expression>();
          opening.attributes.properties.forEach((property) => {
            if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name) || !property.initializer || !ts.isJsxExpression(property.initializer) || !property.initializer.expression) return;
            attributes.set(property.name.text, property.initializer.expression);
          });
          usesByComponent.set(opening.tagName.text, [...(usesByComponent.get(opening.tagName.text) ?? []), { owner: enclosingComponentName(opening.parent), attributes }]);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(source);

    const functionHasJourneySink = (node: FunctionNode, visited = new Set<number>()): boolean => {
      if (visited.has(node.pos)) return false;
      visited.add(node.pos);
      let found = false;
      const visit = (candidate: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(candidate)) {
          const symbol = callSymbol(candidate.expression);
          if (symbol === "fetch" || symbol === "dispatch" || symbol === "setPage" || /(?:^|\.)(?:[A-Za-z0-9_$]*Api)\./.test(symbol ?? "")) {
            found = true;
            return;
          }
          if (symbol && !symbol.includes(".")) {
            const dependency = definitions.get(symbol);
            if (dependency && functionHasJourneySink(dependency, visited)) {
              found = true;
              return;
            }
          }
        }
        ts.forEachChild(candidate, visit);
      };
      if (node.body) visit(node.body);
      return found;
    };
    const downstreamConsumedStates = new Set<string>();
    for (const [name, definition] of definitions) {
      if (/^[A-Z]/.test(name) || !functionHasJourneySink(definition)) continue;
      const body = definition.body?.getText(source) ?? "";
      for (const state of setterToState.values()) {
        if (new RegExp(`\\b${state.replace(/[$]/g, "\\$")}\\b`).test(body)) downstreamConsumedStates.add(state);
      }
    }

    for (const interaction of sourceInteractions) {
      const opening = (openingsByLine.get(interaction.line) ?? []).find((candidate) => {
        const tag = ts.isIdentifier(candidate.tagName) ? candidate.tagName.text.toLowerCase() : "";
        return tag === "input" || tag === "button" || tag === "a" || tag === "select" || tag === "textarea";
      });
      if (!opening) continue;
      const changeFirst = ["input", "checkbox", "radio", "file", "select", "textarea", "number", "range"].includes(interaction.kind);
      const eventNames = changeFirst ? ["onChange", "onInput", "onClick", "onKeyDown"] : ["onClick", "onSubmit", "onChange", "onKeyDown", "onInput"];
      const handler = eventNames.map((name) => jsxExpression(opening, name)).find(Boolean)
        ?? bubblingJsxExpression(opening, eventNames.filter((name) => name !== "onSubmit"))
        ?? (nativeFormSubmitControl(opening) ? bubblingJsxExpression(opening, ["onSubmit"]) : undefined);
      if (!handler) continue;

      const analysis: Analysis = {
        handlerLines: new Set([interaction.line]),
        calledSymbols: new Set(),
        localStateKeys: new Set(),
        literalNavigationTargets: new Set(),
        rootSymbols: new Set(),
        stableOutcomes: new Set(),
        explicitFailure: false,
        meaningfulCalls: new Set(),
      };
      const visited = new Set<string>();

      const analyze = (node: ts.Node, component: string | undefined, root = false): void => {
        if (ts.isCatchClause(node)) analysis.explicitFailure = true;
        if (ts.isThrowStatement(node)) analysis.explicitFailure = true;
        if (ts.isStringLiteralLike(node) && /^(?:FAILED|PARTIALLY_FAILED)$/i.test(node.text)) analysis.explicitFailure = true;
        if (ts.isCallExpression(node)) {
          const symbol = callSymbol(node.expression);
          if (symbol) {
            const simple = symbol.includes(".") ? undefined : symbol;
            const isProp = Boolean(simple && component && propsByComponent.get(component)?.has(simple));
            analysis.calledSymbols.add(symbol);
            if (root) analysis.rootSymbols.add(symbol);
            if (setterToState.has(symbol)) analysis.localStateKeys.add(setterToState.get(symbol)!);
            else if (isProp && symbol !== "setPage" && /^set[A-Z]/.test(symbol)) {
              const state = symbol.slice(3);
              analysis.localStateKeys.add(`${state[0]!.toLowerCase()}${state.slice(1)}`);
            }
            if (!/^set[A-Z]/.test(symbol) && /(?:download|export)/i.test(symbol)) analysis.stableOutcomes.add("downloaded");
            if (symbol === "setPage") {
              const target = literalText(node.arguments[0]);
              if (target) analysis.literalNavigationTargets.add(target);
            }

            const definition = simple ? definitions.get(simple) : undefined;
            if (definition) {
              const key = `${simple}:${definition.pos}`;
              if (!visited.has(key)) {
                visited.add(key);
                analysis.handlerLines.add(lineAt(source, definition.getStart(source)));
                if (definition.body) analyze(definition.body, enclosingComponentName(definition.parent) ?? component);
              }
            } else if (isProp && simple) {
              for (const use of usesByComponent.get(component!) ?? []) {
                const bound = use.attributes.get(simple);
                if (!bound) continue;
                const key = `${component}:${simple}:${bound.pos}`;
                if (visited.has(key)) continue;
                visited.add(key);
                if (ts.isIdentifier(bound) && definitions.has(bound.text)) {
                  const boundDefinition = definitions.get(bound.text)!;
                  analysis.handlerLines.add(lineAt(source, boundDefinition.getStart(source)));
                  if (boundDefinition.body) analyze(boundDefinition.body, enclosingComponentName(boundDefinition.parent) ?? use.owner);
                } else {
                  analyze(bound, use.owner);
                }
              }
            } else if (!/^set[A-Z]/.test(symbol) && !/^(?:stopPropagation|preventDefault|forEach|map|flatMap|filter|find|some|every|includes|has|add|delete|at|slice)$/.test(symbol.split(".").at(-1) ?? "") && !["String", "Boolean", "Number"].includes(symbol)) {
              analysis.meaningfulCalls.add(symbol);
            }
          }
        }
        ts.forEachChild(node, (child) => analyze(child, component, root && !ts.isCallExpression(node)));
      };
      const handlerComponent = enclosingComponentName(opening.parent);
      if (ts.isIdentifier(handler) && definitions.has(handler.text)) {
        analysis.rootSymbols.add(handler.text);
        const definition = definitions.get(handler.text)!;
        analysis.handlerLines.add(lineAt(source, definition.getStart(source)));
        if (definition.body) analyze(definition.body, enclosingComponentName(definition.parent) ?? handlerComponent);
      } else if (ts.isIdentifier(handler) && handlerComponent && propsByComponent.get(handlerComponent)?.has(handler.text)) {
        analysis.rootSymbols.add(handler.text);
        for (const use of usesByComponent.get(handlerComponent) ?? []) {
          const bound = use.attributes.get(handler.text);
          if (!bound) continue;
          if (ts.isIdentifier(bound) && definitions.has(bound.text)) {
            const definition = definitions.get(bound.text)!;
            analysis.handlerLines.add(lineAt(source, definition.getStart(source)));
            if (definition.body) analyze(definition.body, enclosingComponentName(definition.parent) ?? use.owner);
          } else {
            analyze(bound, use.owner);
          }
        }
      } else {
        analyze(handler, handlerComponent, true);
      }

      const viewNamed = analysis.rootSymbols.size > 0
        && analysis.meaningfulCalls.size === 0
        && [...analysis.rootSymbols].every((symbol) => symbol !== "setPage" && /(?:filter|search|query|page|refresh|viewresults|menu|expand|collapse|close)/i.test(symbol));
      const consumedStateKeys = [...analysis.localStateKeys].filter((key) => downstreamConsumedStates.has(key));
      const viewStateOnly = analysis.localStateKeys.size > 0
        && analysis.meaningfulCalls.size === 0
        && [...analysis.rootSymbols].every((symbol) => /^set[A-Z]/.test(symbol))
        && consumedStateKeys.length === 0;
      const localViewOnly = analysis.literalNavigationTargets.size === 0 && (viewNamed || viewStateOnly);
      const journeyRequired = !localViewOnly && (
        interaction.kind === "file"
        || analysis.explicitFailure
        || analysis.literalNavigationTargets.size > 0
        || consumedStateKeys.length > 0
        || [...analysis.calledSymbols].some((symbol) => symbol === "setPage" || symbol === "dispatch" || /(?:^|\.)(?:[A-Za-z0-9_$]*Api)\./.test(symbol))
      );
      output.push({
        element_id: interaction.element_id,
        source_id: interaction.source_id,
        path: file.path,
        line: interaction.line,
        handler_lines: [...analysis.handlerLines].sort((left, right) => left - right),
        called_symbols: [...analysis.calledSymbols].sort(),
        local_state_keys: [...analysis.localStateKeys].sort(),
        downstream_consumed_state_keys: consumedStateKeys.sort(),
        literal_navigation_targets: [...analysis.literalNavigationTargets].sort(),
        stable_outcomes: [...analysis.stableOutcomes].sort(),
        explicit_failure: analysis.explicitFailure,
        local_view_only: localViewOnly,
        journey_required: journeyRequired,
      });
    }
  }
  const sorted = output.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.element_id.localeCompare(right.element_id));
  return enrichSourceInteractionBehaviors(snapshot, sourceByPath, sorted);
}

function targetMatchesLiteral(target: string, route: string | undefined, title: string): boolean {
  const expected = target.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const actual = `${route ?? ""} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return Boolean(expected) && actual.includes(expected);
}

export function validateFactSourceBehaviors(facts: FactBundle, behaviors: SourceInteractionBehavior[]): ValidationIssue[] {
  const issues: ValidationIssue[] = validateFactCatalogSourceBehaviors(facts, behaviors);
  const screens = new Map(facts.screens.map((screen) => [screen.screen_id, screen]));
  const elements = new Map(facts.screens.flatMap((screen) => screen.elements.map((element) => [element.id, element] as const)));
  const edgesByElement = groupBy(facts.edges, (edge) => edge.on);

  for (const behavior of behaviors) {
    const edges = edgesByElement.get(behavior.element_id) ?? [];
    const anchor = `${behavior.path}:${behavior.line}`;
    if (behavior.feasibility === "unresolved") {
      if (edges.length) issues.push({
        code: "FACT_UNRESOLVED_CONNECTION_EDGE_FORBIDDEN",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} has unresolved cross-layer metadata and cannot own a guessed FACT edge.`,
      });
      continue;
    }
    if (!edges.length) {
      if (behavior.journey_required || behavior.local_view_only) issues.push({
        code: "FACT_SOURCE_ACTION_MISSING",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} is a backend-derived ${behavior.local_view_only ? "view" : "journey"} action but has no FACT edge; handlers=${behavior.called_symbols.join("|") || "native"}.`,
      });
      continue;
    }
    const normalEdges = edges.filter((edge) => edge.kind === "normal");
    const lastingViewState = (behavior.view_state?.states ?? []).some((state) => !["loading", "error"].includes(state.facet));
    if (behavior.journey_required && !behavior.local_view_only && normalEdges.length
      && normalEdges.every((edge) => edge.from.split("[")[0] === edge.to.split("[")[0])
      && !(behavior.stable_outcomes ?? []).length && !lastingViewState) {
      issues.push({
        code: "FACT_JOURNEY_ACTION_SELF_LOOP_ONLY",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} is a journey action, but every normal edge returns to ${normalEdges[0].from.split("[")[0]} without a stable outcome or lasting view state. Point its normal edge at the screen the handler actually reaches.`,
      });
    }
    const transitionAudit = auditFactSourceBehaviorTransitions(facts, [behavior]);
    const branchByRef = new Map((behavior.branches ?? []).map((branch) => [branch.branch_ref, branch]));
    if (behavior.source_refs !== undefined && behavior.branches !== undefined) {
      edges.filter((edge) => !edge.source_branch_ref).forEach((edge) => issues.push({
        code: "FACT_SOURCE_BRANCH_REF_MISSING",
        severity: "error",
        path: `$.edges[edge_id=${edge.edge_id}].source_branch_ref`,
        message: `${edge.edge_id} for ${behavior.element_id} at ${anchor} must identify its backend-owned source branch.`,
      }));
    }
    edges.filter((edge) => edge.source_branch_ref && branchByRef.get(edge.source_branch_ref)?.outcome !== edge.kind).forEach((edge) => issues.push({
      code: "FACT_SOURCE_BRANCH_OUTCOME_MISMATCH",
      severity: "error",
      path: `$.edges[edge_id=${edge.edge_id}].kind`,
      message: `${edge.edge_id} claims ${edge.source_branch_ref} as ${edge.kind}, but the backend branch inventory has ${branchByRef.get(edge.source_branch_ref!)?.outcome ?? "no such branch"}. ${behavior.element_id} owns ${branchByRef.size ? [...branchByRef.entries()].map(([ref, branch]) => `${ref}=${branch.outcome}`).join(", ") : "no backend branch, so it must not own an edge"}.`,
    }));
    for (const [branchRef, branchEdges] of groupBy(edges.filter((edge) => edge.source_branch_ref), (edge) => edge.source_branch_ref!)) {
      branchEdges.slice(1).forEach((edge) => issues.push({
        code: "FACT_SOURCE_BRANCH_DUPLICATE",
        severity: "error",
        path: `$.edges[edge_id=${edge.edge_id}].source_branch_ref`,
        message: `${edge.edge_id} duplicates backend branch ${branchRef} for ${behavior.element_id} at ${anchor}.`,
      }));
    }
    const missingBranches = transitionAudit.missing_obligations.filter((obligation) =>
      edges.some((edge) => edge.kind === obligation.outcome));
    if (missingBranches.length) issues.push({
      code: "FACT_SOURCE_BRANCH_MISSING",
      severity: "error",
      path: `$.edges[on=${behavior.element_id}]`,
      message: `${behavior.element_id} at ${anchor} is missing backend-enumerated branches ${missingBranches.map((branch) => branch.branch_ref).join("|")}.`,
    });
    if (behavior.branches !== undefined) {
      transitionAudit.unknown_claims
        .filter((claim) => claim.source_action_ref === behavior.element_id)
        .forEach((claim) => issues.push({
          code: "FACT_SOURCE_BRANCH_UNSUPPORTED",
          severity: "error",
          path: `$.edges[edge_id=${claim.edge_ref}]`,
          message: `${claim.edge_ref} for ${behavior.element_id} at ${anchor} is absent from the backend branch inventory (${claim.branch_ref}).`,
        }));
    }
    if ((behavior.journey_required || behavior.local_view_only) && !edges.some((edge) => edge.kind === "normal")) {
      issues.push({
        code: "FACT_NORMAL_EDGE_MISSING",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} is a backend-derived ${behavior.local_view_only ? "view" : "journey"} action but has no normal outcome edge.`,
      });
    }
    if (behavior.literal_navigation_targets.length) {
      const mismatched = edges.filter((edge) => edge.kind === "normal" && (() => {
        const target = screens.get(edge.to);
        return !target || !behavior.literal_navigation_targets.some((literal) => targetMatchesLiteral(literal, target.route, target.title));
      })());
      if (mismatched.length) issues.push({
        code: "FACT_LITERAL_NAVIGATION_TARGET_MISMATCH",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} navigates to ${behavior.literal_navigation_targets.join("|")}, but FACT targets ${[...new Set(mismatched.map((edge) => edge.to))].join("|")}.`,
      });
    }
    if (behavior.local_view_only) {
      const crossScreen = edges.filter((edge) => edge.from !== edge.to);
      if (crossScreen.length) issues.push({
        code: "FACT_LOCAL_VIEW_TRANSITION_UNSUPPORTED",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} only changes local view state but FACT targets ${[...new Set(crossScreen.map((edge) => edge.to))].join("|")}.`,
      });
      const unsupportedEffects = edges.filter((edge) => edge.from === edge.to && edge.effect
        && edge.effect.split(" && ").some((clause) => {
          const separator = clause.indexOf("=");
          const predicateId = separator < 0 ? clause : clause.slice(0, separator);
          return !behavior.local_state_keys.some((stateKey) => sourceStateKeyMatchesPredicate(stateKey, predicateId));
        }));
      if (unsupportedEffects.length) issues.push({
        code: "FACT_LOCAL_VIEW_EFFECT_UNSUPPORTED",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}].effect`,
        message: `${behavior.element_id} at ${anchor} only changes ${behavior.local_state_keys.join("|")}, but FACT claims ${[...new Set(unsupportedEffects.map((edge) => edge.effect))].join("|")}.`,
      });
    }
    if (behavior.explicit_failure && edges.some((edge) => edge.kind === "normal") && !edges.some((edge) => edge.kind === "exception")) {
      issues.push({
        code: "FACT_EXCEPTION_EDGE_MISSING",
        severity: "error",
        path: `$.edges[on=${behavior.element_id}]`,
        message: `${behavior.element_id} at ${anchor} resolves to a handler with an explicit failure branch but has no exception edge.`,
      });
    }
    if (!elements.has(behavior.element_id)) continue;
  }
  return issues;
}
