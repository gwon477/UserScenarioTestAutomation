# ScenarioForge Work Protocol

- Protocol version and hash must match the active WorkContext.
- Read the current WorkContext before beginning each root or child work.
- Use only the input IDs and evidence grants assigned to the current work.
- Write only under `.scenarioforge/staging/{workId}/`.
- Submit structured artifacts and request completion; never mark a stage complete directly.
- Canonical state, index, final artifacts, and `WORK_STATE.md` are read-only to agent file tools.
- A natural-language completion response, Pi `agent_end`, or reviewer pass does not complete a stage.
- Report schema, permission, path, and ID failures without inventing missing facts.
