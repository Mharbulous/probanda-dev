// Resolve hook: a relative "./x.js" import that does not exist resolves to "./x.ts".
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(url))) return next(specifier.slice(0, -3) + ".ts", context);
  }
  return next(specifier, context);
}
