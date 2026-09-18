import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const runIdPattern = /^RUN-AXSE-AGENTIC-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function inside(root, path) {
  const relation = relative(root, path);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function directChild(root, path) {
  const relation = relative(root, path);
  return relation.length > 0 && relation !== ".." && !relation.includes(sep) && !isAbsolute(relation);
}

export async function resolveEvidenceGrantReferenceGroups({ runRoot, stagePrefix, references }) {
  if (!["04-user-journeys", "05-scenario-cases"].includes(stagePrefix) || !Array.isArray(references)) {
    throw new Error("EVIDENCE_GRANT_LOCATION_INVALID");
  }
  const resolvedRunRoot = resolve(runRoot);
  let runRootReal;
  let revisionDirectories;
  try {
    const runInfo = await lstat(resolvedRunRoot);
    if (!runInfo.isDirectory() || runInfo.isSymbolicLink()) throw new Error("EVIDENCE_GRANT_LOCATION_INVALID");
    runRootReal = await realpath(resolvedRunRoot);
    const entries = await readdir(resolvedRunRoot, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && (entry.name === stagePrefix || entry.name.startsWith(`${stagePrefix}-`)))
      .map((entry) => join(resolvedRunRoot, entry.name, "evidence-grants"))
      .sort();
    revisionDirectories = [];
    for (const grantDirectory of candidates) {
      try {
        const [directoryInfo, directoryReal] = await Promise.all([lstat(grantDirectory), realpath(grantDirectory)]);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !inside(runRootReal, directoryReal)) {
          throw new Error("EVIDENCE_GRANT_LOCATION_INVALID");
        }
        revisionDirectories.push(grantDirectory);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") continue;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "EVIDENCE_GRANT_LOCATION_INVALID") throw error;
    throw new Error("EVIDENCE_GRANT_LOCATION_INVALID");
  }

  const directoryByGrantId = new Map();
  for (const reference of references) {
    const grantId = reference && typeof reference === "object" ? reference.evidence_grant_id : undefined;
    if (typeof grantId !== "string" || !/^EVG-[A-Za-z0-9._-]+$/.test(grantId)) throw new Error("EVIDENCE_GRANT_LOCATION_INVALID");
    if (directoryByGrantId.has(grantId)) continue;
    const matches = [];
    let invalidLocation = false;
    for (const grantDirectory of revisionDirectories) {
      const grantPath = join(grantDirectory, `${grantId}.json`);
      try {
        const [grantInfo, grantReal] = await Promise.all([lstat(grantPath), realpath(grantPath)]);
        if (!grantInfo.isFile() || grantInfo.isSymbolicLink() || !inside(runRootReal, grantReal)) {
          invalidLocation = true;
          continue;
        }
        matches.push(grantDirectory);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") continue;
        invalidLocation = true;
      }
    }
    if (invalidLocation) throw new Error(`EVIDENCE_GRANT_LOCATION_INVALID:${grantId}`);
    if (matches.length === 0) throw new Error(`EVIDENCE_GRANT_LOCATION_MISSING:${grantId}`);
    if (matches.length > 1) throw new Error(`EVIDENCE_GRANT_LOCATION_DUPLICATE:${grantId}`);
    directoryByGrantId.set(grantId, matches[0]);
  }

  const referencesByDirectory = new Map();
  for (const reference of references) {
    const grantDirectory = directoryByGrantId.get(reference.evidence_grant_id);
    referencesByDirectory.set(grantDirectory, [...(referencesByDirectory.get(grantDirectory) ?? []), reference]);
  }
  return [...referencesByDirectory.entries()]
    .map(([grantDirectory, groupedReferences]) => ({ grantDirectory, references: groupedReferences }));
}

export function stableAgenticErrorCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^MODEL_CREDENTIAL_/.test(message)) return message;
  if (/429|rate.?limit/i.test(message)) return "PROVIDER_RATE_LIMIT";
  if (/timeout|timed.?out|ETIMEDOUT/i.test(message)) return "PROVIDER_TIMEOUT";
  if (/network|ECONN|socket|fetch failed/i.test(message)) return "PROVIDER_NETWORK_FAILURE";
  const stable = message.match(/^(?:AGENTIC|SOURCE|EVIDENCE|FACT|BUSINESS|USER|SCENARIO|GRAPH_SCENARIO|GOLDEN)_[A-Z0-9_]+/)?.[0];
  return stable || "AGENTIC_SOURCE_SURVEY_FAILED";
}

export function validateScenarioCaseCorrectionOptions({ gapFilename, priorDirectory, resumeDirectory }) {
  const hasGap = gapFilename !== undefined;
  const hasPrior = priorDirectory !== undefined;
  const hasResume = resumeDirectory !== undefined;
  if (hasGap !== hasPrior || hasResume && !hasPrior) throw new Error("SCENARIO_CASE_CORRECTION_INPUT_INVALID");
  if (!hasGap) return { gapFilename: "orchestrator-next-stage-gaps.json", priorDirectory: null, resumeDirectory: null };
  if (!/^orchestrator-[a-z0-9][a-z0-9-]{0,80}-gaps\.json$/.test(gapFilename)
    || !/^05-scenario-cases-[a-z0-9][a-z0-9-]{0,80}$/.test(priorDirectory)
    || hasResume && !/^05-scenario-cases-[a-z0-9][a-z0-9-]{0,80}$/.test(resumeDirectory)) {
    throw new Error("SCENARIO_CASE_CORRECTION_INPUT_INVALID");
  }
  return { gapFilename, priorDirectory, resumeDirectory: resumeDirectory ?? null };
}

export function validateScenarioCaseJourneyDirectory(journeyDirectory) {
  const value = journeyDirectory ?? "04-user-journeys";
  if (!/^04-user-journeys(?:-[a-z0-9][a-z0-9-]{0,80})?$/.test(value)) throw new Error("SCENARIO_CASE_JOURNEY_INPUT_INVALID");
  return value;
}

export function validateUserJourneyTransitionCorrectionOptions({ priorDirectory, outputDirectory }) {
  const hasPrior = priorDirectory !== undefined;
  const hasOutput = outputDirectory !== undefined;
  if (hasPrior !== hasOutput) throw new Error("USER_JOURNEY_TRANSITION_CORRECTION_INPUT_INVALID");
  if (!hasPrior) return null;
  const directoryPattern = /^04-user-journeys(?:-[a-z0-9][a-z0-9-]{0,80})?$/;
  if (!directoryPattern.test(priorDirectory)
    || !directoryPattern.test(outputDirectory)
    || outputDirectory === "04-user-journeys"
    || outputDirectory === priorDirectory) {
    throw new Error("USER_JOURNEY_TRANSITION_CORRECTION_INPUT_INVALID");
  }
  return { priorDirectory, outputDirectory };
}

export async function validateUserJourneyTransitionCorrectionPaths({ runRoot, priorRoot, outputRoot }) {
  const resolvedRunRoot = resolve(runRoot);
  const resolvedPriorRoot = resolve(priorRoot);
  const resolvedOutputRoot = resolve(outputRoot);
  if (!directChild(resolvedRunRoot, resolvedPriorRoot) || !directChild(resolvedRunRoot, resolvedOutputRoot)) {
    throw new Error("USER_JOURNEY_TRANSITION_CORRECTION_PATH_INVALID");
  }
  try {
    const [runInfo, priorInfo, runReal, priorReal] = await Promise.all([
      lstat(resolvedRunRoot),
      lstat(resolvedPriorRoot),
      realpath(resolvedRunRoot),
      realpath(resolvedPriorRoot),
    ]);
    if (!runInfo.isDirectory() || runInfo.isSymbolicLink()
      || !priorInfo.isDirectory() || priorInfo.isSymbolicLink()
      || !inside(runReal, priorReal)) {
      throw new Error("USER_JOURNEY_TRANSITION_CORRECTION_PATH_INVALID");
    }
    try {
      await lstat(resolvedOutputRoot);
      throw new Error("USER_JOURNEY_TRANSITION_CORRECTION_PATH_INVALID");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "USER_JOURNEY_TRANSITION_CORRECTION_PATH_INVALID") throw error;
    throw new Error("USER_JOURNEY_TRANSITION_CORRECTION_PATH_INVALID");
  }
}

export async function validateScenarioCaseCorrectionPaths({ runRoot, gapPath, priorRoot, resumeRoot, journeyRoot: requestedJourneyRoot }) {
  const resolvedRunRoot = resolve(runRoot);
  const journeyRoot = resolve(requestedJourneyRoot ?? join(resolvedRunRoot, "04-user-journeys"));
  const resolvedGapPath = resolve(gapPath);
  const resolvedPriorRoot = priorRoot ? resolve(priorRoot) : null;
  const resolvedResumeRoot = resumeRoot ? resolve(resumeRoot) : null;
  if (!directChild(resolvedRunRoot, journeyRoot)
    || !directChild(journeyRoot, resolvedGapPath)
    || (resolvedPriorRoot && !directChild(resolvedRunRoot, resolvedPriorRoot))
    || (resolvedResumeRoot && !directChild(resolvedRunRoot, resolvedResumeRoot))) {
    throw new Error("SCENARIO_CASE_CORRECTION_PATH_INVALID");
  }

  try {
    const [runRootInfo, journeyRootInfo, gapInfo, runRootReal, journeyRootReal, gapReal] = await Promise.all([
      lstat(resolvedRunRoot),
      lstat(journeyRoot),
      lstat(resolvedGapPath),
      realpath(resolvedRunRoot),
      realpath(journeyRoot),
      realpath(resolvedGapPath),
    ]);
    if (!runRootInfo.isDirectory() || runRootInfo.isSymbolicLink()
      || !journeyRootInfo.isDirectory() || journeyRootInfo.isSymbolicLink()
      || !gapInfo.isFile() || gapInfo.isSymbolicLink()
      || !inside(runRootReal, journeyRootReal) || !inside(journeyRootReal, gapReal)) {
      throw new Error("SCENARIO_CASE_CORRECTION_PATH_INVALID");
    }
    if (resolvedPriorRoot) {
      const [priorInfo, priorReal] = await Promise.all([lstat(resolvedPriorRoot), realpath(resolvedPriorRoot)]);
      if (!priorInfo.isDirectory() || priorInfo.isSymbolicLink() || !inside(runRootReal, priorReal)) {
        throw new Error("SCENARIO_CASE_CORRECTION_PATH_INVALID");
      }
    }
    if (resolvedResumeRoot) {
      const [resumeInfo, resumeReal] = await Promise.all([lstat(resolvedResumeRoot), realpath(resolvedResumeRoot)]);
      if (!resumeInfo.isDirectory() || resumeInfo.isSymbolicLink() || !inside(runRootReal, resumeReal)) {
        throw new Error("SCENARIO_CASE_CORRECTION_PATH_INVALID");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SCENARIO_CASE_CORRECTION_PATH_INVALID") throw error;
    throw new Error("SCENARIO_CASE_CORRECTION_PATH_INVALID");
  }
}

export async function validateStagedProbeScope({ repositoryRoot, projectRoot, outputRoot, runId }) {
  if (!runIdPattern.test(runId)) throw new Error("AGENTIC_RUN_ID_INVALID");
  const repository = resolve(repositoryRoot);
  const expectedProject = join(repository, "test_project_source", "axse-agents");
  const expectedOutputParent = join(repository, "docs", "validation", "axse-agentic-analysis");
  if (resolve(projectRoot) !== expectedProject) throw new Error("AGENTIC_PROJECT_SCOPE_INVALID");
  const [repositoryReal, expectedProjectReal, suppliedProjectReal, outputParentReal, projectStat] = await Promise.all([
    realpath(repository),
    realpath(expectedProject),
    realpath(projectRoot),
    realpath(expectedOutputParent),
    stat(projectRoot),
  ]);
  if (!projectStat.isDirectory() || suppliedProjectReal !== expectedProjectReal || !inside(repositoryReal, suppliedProjectReal)) throw new Error("AGENTIC_PROJECT_SCOPE_INVALID");
  if (!inside(repositoryReal, outputParentReal) || resolve(outputRoot) !== join(expectedOutputParent, runId)) throw new Error("AGENTIC_OUTPUT_PATH_INVALID");
  return { repositoryRoot: repository, projectRoot: expectedProject, outputParent: expectedOutputParent, outputRoot: join(expectedOutputParent, runId) };
}

export async function executeProbeLifecycle({ runId, execute, dispose, writeFailure, reportFailure }) {
  let stage = "credential";
  try {
    const value = await execute((nextStage) => { stage = nextStage; });
    return { ok: true, value };
  } catch (error) {
    const errorCode = stableAgenticErrorCode(error);
    reportFailure(`${runId} failed at ${stage}: ${errorCode}`);
    try {
      await writeFailure({ schema_version: 1, run_id: runId, stage, error_code: errorCode });
    } catch {
      reportFailure(`${runId} failure artifact write failed: FAILURE_ARTIFACT_WRITE_FAILED`);
    }
    return { ok: false, stage, errorCode };
  } finally {
    try {
      await dispose();
    } catch {
      reportFailure(`${runId} cleanup failed: AGENTIC_SESSION_DISPOSE_FAILED`);
    }
  }
}

export async function promptWithDeadline({ prompt, abort, timeoutMs, schedule = setTimeout, cancel = clearTimeout }) {
  let timeout;
  try {
    await Promise.race([
      Promise.resolve().then(prompt),
      new Promise((_, reject) => { timeout = schedule(() => reject(new Error("PROVIDER_TIMEOUT")), timeoutMs); }),
    ]);
  } catch (error) {
    if (stableAgenticErrorCode(error) === "PROVIDER_TIMEOUT") await abort().catch(() => undefined);
    throw error;
  } finally {
    cancel(timeout);
  }
}
