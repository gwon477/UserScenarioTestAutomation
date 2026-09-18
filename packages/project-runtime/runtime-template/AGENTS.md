# ScenarioForge Runtime Agents

Follow the loaded `WORK_PROTOCOL.md`, then call `work.getContext` for the server-scoped work before acting. `WORK_STATE.md` is a backend projection and is never read or written through agent file tools. The top-level harness routes work; generation and execution resources are isolated and must never be loaded into the same session.
