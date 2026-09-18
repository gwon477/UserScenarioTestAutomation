import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEvidenceGrantReferenceGroups } from "../../scripts/staged-agent-run-support.mjs";

const temporaryRoots: string[] = [];

async function temporaryRunRoot() {
  const root = await mkdtemp(join(tmpdir(), "scenarioforge-evidence-lineage-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("staged agent evidence-grant revision lookup", () => {
  it("groups inherited evidence by its exact stage-revision grant directory", async () => {
    const runRoot = await temporaryRunRoot();
    const original = join(runRoot, "04-user-journeys", "evidence-grants");
    const correction = join(runRoot, "04-user-journeys-transition-correction-02", "evidence-grants");
    await mkdir(original, { recursive: true });
    await mkdir(correction, { recursive: true });
    await writeFile(join(original, "EVG-original.json"), "{}\n");
    await writeFile(join(correction, "EVG-correction.json"), "{}\n");

    const groups = await resolveEvidenceGrantReferenceGroups({
      runRoot,
      stagePrefix: "04-user-journeys",
      references: [
        { evidence_grant_id: "EVG-original", marker: 1 },
        { evidence_grant_id: "EVG-correction", marker: 2 },
        { evidence_grant_id: "EVG-original", marker: 3 },
      ],
    });

    expect(groups.map((group) => ({ directory: group.grantDirectory, markers: group.references.map((reference) => reference.marker) })))
      .toEqual([
        { directory: original, markers: [1, 3] },
        { directory: correction, markers: [2] },
      ]);
  });

  it("fails closed for missing, duplicate, and linked grant files", async () => {
    const runRoot = await temporaryRunRoot();
    const first = join(runRoot, "05-scenario-cases-first", "evidence-grants");
    const second = join(runRoot, "05-scenario-cases-second", "evidence-grants");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(first, "EVG-duplicate.json"), "{}\n");
    await writeFile(join(second, "EVG-duplicate.json"), "{}\n");
    await symlink(join(first, "EVG-duplicate.json"), join(first, "EVG-linked.json"));

    await expect(resolveEvidenceGrantReferenceGroups({ runRoot, stagePrefix: "05-scenario-cases", references: [{ evidence_grant_id: "EVG-missing" }] }))
      .rejects.toThrow("EVIDENCE_GRANT_LOCATION_MISSING");
    await expect(resolveEvidenceGrantReferenceGroups({ runRoot, stagePrefix: "05-scenario-cases", references: [{ evidence_grant_id: "EVG-duplicate" }] }))
      .rejects.toThrow("EVIDENCE_GRANT_LOCATION_DUPLICATE");
    await expect(resolveEvidenceGrantReferenceGroups({ runRoot, stagePrefix: "05-scenario-cases", references: [{ evidence_grant_id: "EVG-linked" }] }))
      .rejects.toThrow("EVIDENCE_GRANT_LOCATION_INVALID");
  });

  it("rejects an evidence-grants directory reached through a symbolic link", async () => {
    const runRoot = await temporaryRunRoot();
    const original = join(runRoot, "05-scenario-cases-original", "evidence-grants");
    const linkedStage = join(runRoot, "05-scenario-cases-linked-directory");
    await mkdir(original, { recursive: true });
    await mkdir(linkedStage);
    await writeFile(join(original, "EVG-original.json"), "{}\n");
    await symlink(original, join(linkedStage, "evidence-grants"));

    await expect(resolveEvidenceGrantReferenceGroups({
      runRoot,
      stagePrefix: "05-scenario-cases",
      references: [{ evidence_grant_id: "EVG-original" }],
    })).rejects.toThrow("EVIDENCE_GRANT_LOCATION_INVALID");
  });
});
