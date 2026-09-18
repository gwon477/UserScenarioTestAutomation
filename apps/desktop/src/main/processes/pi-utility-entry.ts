import { parentPort } from "node:worker_threads";
import { FakePiSessionDriver, PiRuntimeHost } from "@scenarioforge/pi-runtime";

type UtilityCommand =
  | { type: "create"; requestId: string; input: Parameters<PiRuntimeHost["create"]>[0] }
  | { type: "prompt"; requestId: string; sessionId: string; input: Parameters<PiRuntimeHost["prompt"]>[1] }
  | { type: "abort"; requestId: string; sessionId: string }
  | { type: "dispose"; requestId: string; sessionId: string };

const host = new PiRuntimeHost(new FakePiSessionDriver(), (candidate) => parentPort?.postMessage({ type: "candidate", candidate }));

parentPort?.on("message", async (command: UtilityCommand) => {
  try {
    const result = command.type === "create"
      ? await host.create(command.input)
      : command.type === "prompt"
        ? await host.prompt(command.sessionId, command.input)
        : command.type === "abort"
          ? await host.abort(command.sessionId)
          : await host.dispose(command.sessionId);
    parentPort?.postMessage({ type: "result", requestId: command.requestId, result });
  } catch (error) {
    parentPort?.postMessage({ type: "error", requestId: command.requestId, message: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
  }
});
