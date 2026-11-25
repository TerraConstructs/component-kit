import { createRequire } from 'node:module'
import * as path from 'node:path'

/**
 * Load an optional peer dependency on demand, with a helpful error.
 *
 * Resolution starts at this package and falls back to the current working
 * directory (the consuming cdktn app).
 */
export function optionalRequire<T>(moduleName: string, feature: string): T {
  const requirers: NodeJS.Require[] = []
  if (typeof require === 'function') requirers.push(require)
  requirers.push(createRequire(path.join(process.cwd(), 'noop.js')))
  let lastError: unknown
  for (const req of requirers) {
    try {
      return req(moduleName) as T
    } catch (e) {
      lastError = e
    }
  }
  throw new Error(
    `The component configuration enables ${feature}, which requires the optional peer dependency "${moduleName}". Install it in your cdktn app (e.g. \`pnpm add ${moduleName}\`).`,
    { cause: lastError },
  )
}
