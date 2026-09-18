import { describe, expect, it } from "vitest";

import packageJson from "../../../../package.json";
import { readFileSync } from "node:fs";
import { IPC_CHANNELS } from "./desktop-api";

describe("workspace scripts", () => {
  it("delegates desktop commands from the repository root", () => {
    expect(packageJson.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(packageJson.scripts.build).toContain("@scenarioforge/desktop");
    expect(packageJson.scripts.test).toContain("--workspaces");
  });

  it("does not expose raw Pi events to the Renderer", () => {
    expect(Object.keys(IPC_CHANNELS)).not.toContain("piRawEvent");
    expect(readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8")).not.toMatch(/PiRawEvent|agent_end|message_update/);
  });
});
