import type { ModelBinding } from "./model-binding.js";
import { assertModelBinding } from "./model-binding.js";

export type ModelRoleBindings = {
  author: ModelBinding;
  reviewer?: ModelBinding;
  assurance: "independent-reviewer" | "single-model";
};

export function createModelRoleBindings(author: ModelBinding, reviewer?: ModelBinding): ModelRoleBindings {
  if (author.role !== "author") throw new Error("AUTHOR_ROLE_REQUIRED");
  assertModelBinding(author);
  if (reviewer) {
    if (reviewer.role !== "reviewer") throw new Error("REVIEWER_ROLE_REQUIRED");
    assertModelBinding(reviewer);
  }
  return Object.freeze({ author: Object.freeze({ ...author }), reviewer: reviewer ? Object.freeze({ ...reviewer }) : undefined, assurance: reviewer ? "independent-reviewer" : "single-model" });
}
