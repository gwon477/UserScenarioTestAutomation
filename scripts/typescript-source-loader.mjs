import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import ts from "typescript-compiler";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.endsWith(".js") || !context.parentURL?.startsWith("file:")) throw error;
    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    await access(candidate, constants.R_OK);
    return nextResolve(candidate.href, context);
  }
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  const transformed = ts.transpileModule(source, {
    fileName: new URL(url).pathname,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: true,
    },
  });
  return { format: "module", source: transformed.outputText, shortCircuit: true };
}
