/**
 * Resolve extensionless relative imports to `.ts` so `node --test` can load
 * app modules that Vite resolves and Node's type stripper does not.
 * `.tsx` is transpiled here because Node's type stripper does not accept JSX.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function withExtension(base) {
  if (existsSync(base)) return base;
  if (existsSync(`${base}.tsx`)) return `${base}.tsx`;
  if (existsSync(`${base}.ts`)) return `${base}.ts`;
  return `${base}.ts`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = withExtension(join(root, "src", specifier.slice(2)));
    return nextResolve(pathToFileURL(file).href, context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-zA-Z0-9]+$/.test(specifier)
  ) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : root;
    const tsFile = join(parent, `${specifier}.ts`);
    const tsxFile = join(parent, `${specifier}.tsx`);
    if (!existsSync(tsFile) && existsSync(tsxFile)) return nextResolve(`${specifier}.tsx`, context);
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.split("?")[0].split("#")[0].endsWith(".css")) {
    return { format: "module", source: "export default {}", shortCircuit: true };
  }
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const source = readFileSync(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: url,
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
