const JOURNEY_ROLES = new Set(["entry", "intermediate", "business-output", "exit"]);

function uniqueEvidence(values) {
  return [...new Map(values.map((entry) => [
    [entry?.evidence_grant_id, entry?.source_id, entry?.start_line, entry?.end_line, entry?.content_hash].join(":"),
    entry,
  ])).values()];
}

export function hydrateOpaqueEvidence(value, catalog) {
  const byRef = new Map((Array.isArray(catalog) ? catalog : [])
    .filter((entry) => typeof entry?.ref === "string" && entry?.evidence)
    .map((entry) => [entry.ref, entry.evidence]));
  const issues = [];
  function visit(node, owner = "root") {
    if (Array.isArray(node)) return node.map((entry, index) => visit(entry, `${owner}[${index}]`));
    if (!node || typeof node !== "object") return node;
    const copy = {};
    for (const [key, entry] of Object.entries(node)) {
      if (key === "evidence") continue;
      copy[key] = visit(entry, `${owner}.${key}`);
    }
    if (Array.isArray(node.evidence_refs)) {
      const evidence = [];
      for (const ref of node.evidence_refs) {
        const resolved = byRef.get(ref);
        if (!resolved) issues.push(`OPAQUE_EVIDENCE_REF_INVALID:${owner}:${String(ref)}`);
        else evidence.push(resolved);
      }
      copy.evidence = uniqueEvidence(evidence);
    }
    return copy;
  }
  return { value: visit(value), issues: [...new Set(issues)] };
}

export function hydrateSourceFindingEvidence(value, findings) {
  const byRef = new Map((Array.isArray(findings) ? findings : [])
    .filter((entry) => typeof entry?.finding_id === "string")
    .map((entry) => [entry.finding_id, Array.isArray(entry.evidence) ? entry.evidence : []]));
  const issues = [];
  function visit(node, owner = "root") {
    if (Array.isArray(node)) return node.map((entry, index) => visit(entry, `${owner}[${index}]`));
    if (!node || typeof node !== "object") return node;
    const copy = {};
    for (const [key, entry] of Object.entries(node)) {
      if (key === "evidence") continue;
      copy[key] = visit(entry, `${owner}.${key}`);
    }
    if (Array.isArray(node.source_finding_refs)) {
      const evidence = [];
      for (const ref of node.source_finding_refs) {
        const resolved = byRef.get(ref);
        if (!resolved) issues.push(`SOURCE_FINDING_REF_INVALID:${owner}:${String(ref)}`);
        else evidence.push(...resolved);
      }
      copy.evidence = uniqueEvidence(evidence);
    }
    return copy;
  }
  return { value: visit(value), issues: [...new Set(issues)] };
}

export function validateSourceMapCheckpoint(checkpoint, currentProvenance, currentSourceSelection) {
  const issues = [];
  if (checkpoint?.provenance?.prompt_contract_version !== currentProvenance?.prompt_contract_version) issues.push("CHECKPOINT_PROMPT_CONTRACT_MISMATCH");
  if (checkpoint?.provenance?.model_id !== currentProvenance?.model_id) issues.push("CHECKPOINT_MODEL_MISMATCH");
  if (checkpoint?.provenance?.source_root_hash !== currentProvenance?.source_root_hash) issues.push("CHECKPOINT_SOURCE_ROOT_MISMATCH");
  if (checkpoint?.provenance?.source_selection_digest !== currentProvenance?.source_selection_digest) issues.push("CHECKPOINT_SOURCE_SELECTION_DIGEST_MISMATCH");
  if (JSON.stringify(checkpoint?.source_selection) !== JSON.stringify(currentSourceSelection)) issues.push("CHECKPOINT_SOURCE_SELECTION_MISMATCH");
  if (!Array.isArray(checkpoint?.source_maps) || !checkpoint.source_maps.length) issues.push("CHECKPOINT_SOURCE_MAPS_INVALID");
  return [...new Set(issues)];
}

export function normalizeRawSourceMaps(rawMaps) {
  return (Array.isArray(rawMaps) ? rawMaps : []).map((map) => ({
    ...map,
    findings: (Array.isArray(map?.findings) ? map.findings : []).map((finding) => ({
      ...finding,
      api_links: (Array.isArray(finding?.api_links) ? finding.api_links : []).filter((link) => (
        typeof link?.method === "string" && Boolean(link.method.trim())
        && typeof link?.path === "string" && Boolean(link.path.trim())
      )),
    })),
  }));
}

export function applySourceFindingRepair(rawMaps, repair) {
  const corrections = new Map((Array.isArray(repair?.corrections) ? repair.corrections : [])
    .filter((entry) => typeof entry?.source_finding_ref === "string" && entry?.replacement && typeof entry.replacement === "object")
    .map((entry) => [entry.source_finding_ref, entry.replacement]));
  return (Array.isArray(rawMaps) ? rawMaps : []).map((map) => ({
    ...map,
    findings: (Array.isArray(map?.findings) ? map.findings : []).map((finding) => {
      const replacement = corrections.get(finding?.finding_id);
      return replacement ? { ...replacement, finding_id: finding.finding_id } : finding;
    }),
  }));
}

export function validateSolutionJourneyCoverage(candidate, findings) {
  const issues = [];
  const linkedFindings = Array.isArray(findings) ? findings : [];
  const rolesById = new Map(linkedFindings.map((finding) => [finding.finding_id, new Set(finding.journey_roles ?? [])]));
  const authenticationEntryIds = new Set(linkedFindings.filter((finding) => (
    (finding.journey_roles ?? []).includes("entry")
    && /authenticat|log[\s_-]?in|sign[\s_-]?in|credential|로그인|인증/i.test([
      finding.workflow_goal,
      finding.entry,
      ...(finding.ordered_actions ?? []).flatMap((action) => [action?.action, action?.observable_outcome]),
    ].filter(Boolean).join(" "))
  )).map((finding) => finding.finding_id));
  const journeyRecoveryIds = new Set(linkedFindings.filter((finding) => (
    finding.scope === "journey" && finding.recovery_capable === true && finding.recovery_scope === "journey"
  )).map((finding) => finding.finding_id));
  const journeys = Array.isArray(candidate?.journeys) ? candidate.journeys : [];
  const hasBoundaries = (journey) => {
    const refs = new Set(Array.isArray(journey?.source_finding_refs) ? journey.source_finding_refs : []);
    const roles = new Set([...refs].flatMap((ref) => [...(rolesById.get(ref) ?? [])]));
    const hasAuthenticationEntry = !authenticationEntryIds.size || [...authenticationEntryIds].some((ref) => refs.has(ref));
    return hasAuthenticationEntry && roles.has("entry") && roles.has("business-output") && roles.has("exit");
  };
  if (!journeys.some((journey) => journey.kind === "normal" && hasBoundaries(journey))) issues.push("SOLUTION_NORMAL_JOURNEY_MISSING");
  if (journeyRecoveryIds.size && !journeys.some((journey) => (
    journey.kind === "recovery"
    && hasBoundaries(journey)
    && [...journeyRecoveryIds].some((ref) => (journey.source_finding_refs ?? []).includes(ref))
  ))) issues.push("SOLUTION_RECOVERY_JOURNEY_MISSING");
  return issues;
}

export function buildLinkedSourceSkeleton(rawMaps, semanticPatch) {
  const rawFindings = (Array.isArray(rawMaps) ? rawMaps : [])
    .flatMap((map) => Array.isArray(map?.findings) ? map.findings : []);
  const annotations = new Map((Array.isArray(semanticPatch?.annotations) ? semanticPatch.annotations : [])
    .filter((entry) => typeof entry?.source_finding_ref === "string")
    .map((entry) => [entry.source_finding_ref, entry]));
  const uiFindings = rawFindings.filter((finding) => (
    finding?.surface === "ui" && finding?.visible_to_user === true && finding?.executable === true
  ));
  const findings = uiFindings.map((raw, index) => {
    const annotation = annotations.get(raw.finding_id) ?? {};
    const recoveryScope = raw.recovery_capable === true ? annotation.recovery_scope : "none";
    return {
      ...raw,
      finding_id: `LF-${String(index + 1).padStart(3, "0")}`,
      source_finding_refs: [raw.finding_id],
      scope: recoveryScope === "journey" ? "journey" : annotation.scope,
      executable: true,
      journey_roles: Array.isArray(annotation.journey_roles) ? annotation.journey_roles : [],
      recovery_capable: raw.recovery_capable === true,
      recovery_scope: recoveryScope,
    };
  });
  const supportingRefs = rawFindings
    .filter((finding) => !(finding?.surface === "ui" && finding?.visible_to_user === true && finding?.executable === true))
    .map((finding) => finding.finding_id)
    .filter((id) => typeof id === "string");
  return {
    schema_version: 1,
    findings,
    unresolved: supportingRefs.length ? [{
      description: "Non-UI source findings retained outside user-journey synthesis.",
      source_finding_refs: supportingRefs,
      evidence: [],
    }] : [],
  };
}

export function composeJourneyCandidate(taxonomy, journeyAssembly) {
  return {
    schema_version: 1,
    project_name: taxonomy?.project_name ?? "",
    classifications: Array.isArray(taxonomy?.classifications) ? taxonomy.classifications : [],
    workflows: Array.isArray(taxonomy?.workflows) ? taxonomy.workflows : [],
    journeys: Array.isArray(journeyAssembly?.journeys) ? journeyAssembly.journeys : [],
    unresolved: [
      ...(Array.isArray(taxonomy?.unresolved) ? taxonomy.unresolved : []),
      ...(Array.isArray(journeyAssembly?.unresolved) ? journeyAssembly.unresolved : []),
    ],
  };
}

export function applyJourneyRepair(candidate, repair) {
  const unresolved = [
    ...(Array.isArray(candidate?.unresolved) ? candidate.unresolved : []),
    ...(Array.isArray(repair?.unresolved) ? repair.unresolved : []),
  ];
  return {
    ...candidate,
    journeys: Array.isArray(repair?.journeys) ? repair.journeys : [],
    unresolved: [...new Map(unresolved.map((entry) => [JSON.stringify(entry), entry])).values()],
  };
}

export function meaningfulReviewIssues(review) {
  return (Array.isArray(review?.issues) ? review.issues : []).filter((issue) => {
    if (typeof issue?.code === "string" && issue.code.trim()) return true;
    if (typeof issue?.detail === "string" && issue.detail.trim()) return true;
    return (Array.isArray(issue?.evidence) ? issue.evidence : []).some((citation) => (
      typeof citation?.path === "string" && Boolean(citation.path.trim())
    ));
  });
}

export function normalizeLinkedRecovery(rawMaps, linkedMap) {
  const rawById = new Map((Array.isArray(rawMaps) ? rawMaps : [])
    .flatMap((map) => Array.isArray(map?.findings) ? map.findings : [])
    .filter((finding) => typeof finding?.finding_id === "string")
    .map((finding) => [finding.finding_id, finding]));
  const value = structuredClone(linkedMap);
  const corrections = [];
  for (const finding of Array.isArray(value?.findings) ? value.findings : []) {
    const refs = Array.isArray(finding?.source_finding_refs) ? finding.source_finding_refs : [];
    const hasVisibleRecoverySource = refs.some((ref) => {
      const raw = rawById.get(ref);
      return raw?.surface === "ui" && raw?.visible_to_user === true && raw?.recovery_capable === true;
    });
    if (finding?.recovery_capable === true && !hasVisibleRecoverySource) {
      finding.recovery_capable = false;
      finding.recovery_scope = "none";
      corrections.push(`LINKED_RECOVERY_DOWNGRADED:${finding.finding_id}`);
    } else if (finding?.recovery_capable === false && !finding.recovery_scope) {
      finding.recovery_scope = "none";
    }
  }
  return { value, corrections };
}

/**
 * Validate the boundary between chunk-local source extraction and journey synthesis.
 * The linker may merge findings, but it may not lose executable UI behavior or
 * promote backend-only behavior into a user journey.
 */
export function validateLinkedSourceMap(rawMaps, linkedMap) {
  const issues = [];
  const rawFindings = (Array.isArray(rawMaps) ? rawMaps : [])
    .flatMap((map) => Array.isArray(map?.findings) ? map.findings : []);
  const rawById = new Map(rawFindings
    .filter((finding) => typeof finding?.finding_id === "string")
    .map((finding) => [finding.finding_id, finding]));
  const linkedFindings = Array.isArray(linkedMap?.findings) ? linkedMap.findings : [];
  const unresolved = Array.isArray(linkedMap?.unresolved) ? linkedMap.unresolved : [];

  if (linkedMap?.schema_version !== 1) issues.push("LINKED_MAP_SCHEMA_VERSION_INVALID");
  if (!Array.isArray(linkedMap?.findings)) issues.push("LINKED_MAP_FINDINGS_INVALID");
  if (!Array.isArray(linkedMap?.unresolved)) issues.push("LINKED_MAP_UNRESOLVED_INVALID");

  const assigned = new Set();
  const uiAssignmentCounts = new Map();
  const recoveryAssigned = new Set();
  const linkedIds = new Set();
  for (const finding of linkedFindings) {
    const id = typeof finding?.finding_id === "string" && finding.finding_id.trim()
      ? finding.finding_id
      : "unknown";
    if (linkedIds.has(id)) issues.push(`LINKED_FINDING_ID_DUPLICATE:${id}`);
    linkedIds.add(id);
    const refs = Array.isArray(finding?.source_finding_refs) ? finding.source_finding_refs : [];
    if (!refs.length) issues.push(`LINKED_SOURCE_REFS_EMPTY:${id}`);
    for (const ref of refs) {
      if (!rawById.has(ref)) issues.push(`LINKED_SOURCE_REF_INVALID:${id}:${ref}`);
      else {
        assigned.add(ref);
        const raw = rawById.get(ref);
        if (raw?.surface === "ui" && raw?.visible_to_user === true && raw?.executable === true) {
          uiAssignmentCounts.set(ref, (uiAssignmentCounts.get(ref) ?? 0) + 1);
        }
      }
      if (finding?.recovery_capable === true) recoveryAssigned.add(ref);
    }
    const roles = Array.isArray(finding?.journey_roles) ? finding.journey_roles : [];
    for (const role of roles) if (!JOURNEY_ROLES.has(role)) issues.push(`LINKED_JOURNEY_ROLE_INVALID:${id}:${role}`);
    if (!["journey", "supporting", "internal"].includes(finding?.scope)) issues.push(`LINKED_SCOPE_INVALID:${id}`);
    if (typeof finding?.executable !== "boolean") issues.push(`LINKED_EXECUTABLE_INVALID:${id}`);
    if (typeof finding?.workflow_goal !== "string" || !finding.workflow_goal.trim()) issues.push(`LINKED_WORKFLOW_GOAL_EMPTY:${id}`);
    if (typeof finding?.recovery_capable !== "boolean") issues.push(`LINKED_RECOVERY_CAPABILITY_INVALID:${id}`);
    if (!Array.isArray(finding?.evidence) || !finding.evidence.length) issues.push(`LINKED_EVIDENCE_EMPTY:${id}`);
    if (finding?.recovery_capable === true && !["local", "journey"].includes(finding?.recovery_scope)) {
      issues.push(`LINKED_RECOVERY_SCOPE_INVALID:${id}`);
    }
    if (finding?.recovery_scope === "journey" && finding?.scope !== "journey") {
      issues.push(`LINKED_RECOVERY_JOURNEY_SCOPE_INVALID:${id}`);
    }
    if (finding?.recovery_capable === true && !refs.some((ref) => {
      const raw = rawById.get(ref);
      return raw?.surface === "ui" && raw?.visible_to_user === true && raw?.recovery_capable === true;
    })) {
      issues.push(`LINKED_RECOVERY_UI_SOURCE_MISSING:${id}`);
    }
    if (finding?.recovery_capable !== true && finding?.recovery_scope && finding.recovery_scope !== "none") {
      issues.push(`LINKED_RECOVERY_SCOPE_INVALID:${id}`);
    }
    if (finding?.scope === "journey") {
      if (!roles.length) issues.push(`LINKED_JOURNEY_ROLES_EMPTY:${id}`);
      const uiSources = refs.filter((ref) => {
        const raw = rawById.get(ref);
        return raw?.surface === "ui" && raw?.visible_to_user === true;
      });
      if (!uiSources.length) issues.push(`LINKED_JOURNEY_UI_SOURCE_MISSING:${id}`);
      if (uiSources.length !== 1) issues.push(`LINKED_UI_SOURCE_COUNT_INVALID:${id}:${uiSources.length}`);
      if (finding?.executable !== true) issues.push(`LINKED_JOURNEY_NOT_EXECUTABLE:${id}`);
    }
  }

  for (const item of unresolved) {
    for (const ref of Array.isArray(item?.source_finding_refs) ? item.source_finding_refs : []) {
      if (!rawById.has(ref)) issues.push(`LINKED_UNRESOLVED_REF_INVALID:${ref}`);
    }
  }

  for (const finding of rawFindings) {
    if (finding?.surface !== "ui" || finding?.visible_to_user !== true || finding?.executable !== true) continue;
    if (!assigned.has(finding.finding_id)) issues.push(`EXECUTABLE_UI_FINDING_UNASSIGNED:${finding.finding_id}`);
    if ((uiAssignmentCounts.get(finding.finding_id) ?? 0) > 1) issues.push(`EXECUTABLE_UI_FINDING_ASSIGNED_MULTIPLE:${finding.finding_id}`);
    if (finding?.recovery_capable === true && !recoveryAssigned.has(finding.finding_id)) {
      issues.push(`RECOVERY_UI_FINDING_UNASSIGNED:${finding.finding_id}`);
    }
  }

  return [...new Set(issues)];
}
