import { execFileSync } from 'node:child_process'
import type {
  ComponentConfig,
  ComponentConfigSource,
  ComponentIdentity,
} from '@tcons/component'
import {
  dependencyName,
  mapAtmosComponent,
  terraformDependencies,
} from './mapping'
import type { AtmosComponentDescription, AtmosDependencyBackend } from './types'

/**
 * Runs a binary and returns its stdout (injectable for tests).
 */
export type AtmosExec = (
  file: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
) => string

export interface AtmosSourceOptions {
  /**
   * Atmos component.
   * @default process.env.ATMOS_COMPONENT (set by Atmos hooks)
   */
  readonly component?: string
  /**
   * Atmos stack.
   * @default process.env.ATMOS_STACK (set by Atmos hooks)
   */
  readonly stack?: string
  /**
   * The atmos binary.
   * @default process.env.ATMOS_BIN ?? 'atmos'
   */
  readonly atmosBin?: string
  /**
   * Working directory for atmos.
   * @default process.cwd()
   */
  readonly cwd?: string
  /**
   * Sets `ATMOS_BASE_PATH` for atmos.
   * @default inherited from the environment
   */
  readonly basePath?: string
  /**
   * Sets `ATMOS_CLI_CONFIG_PATH` for atmos.
   * @default inherited from the environment
   */
  readonly cliConfigPath?: string
  /**
   * Extra environment variables for atmos (merged over `process.env`).
   */
  readonly env?: Record<string, string | undefined>
  /**
   * Extra arguments for `atmos describe component`
   * (e.g. `['--skip', 'terraform.output']`).
   */
  readonly extraArgs?: string[]
  /**
   * Override (parts of) the identity derived from `vars`.
   */
  readonly identity?: Partial<ComponentIdentity>
  /**
   * @internal command runner, for tests
   */
  readonly exec?: AtmosExec
}

/** The atmos binary could not be executed (ENOENT). */
export class AtmosNotFoundError extends Error {
  constructor(
    public readonly bin: string,
    cause?: unknown,
  ) {
    super(`The atmos binary "${bin}" was not found`, { cause })
    this.name = 'AtmosNotFoundError'
  }
}

const defaultExec: AtmosExec = (file, args, options) =>
  execFileSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })

const describeCache = new Map<string, AtmosComponentDescription>()

/** Clear the per-process `atmos describe component` cache. */
export function clearAtmosDescribeCache(): void {
  describeCache.clear()
}

/**
 * Resolve the Atmos component and stack from options or the
 * `ATMOS_COMPONENT` / `ATMOS_STACK` environment variables.
 */
export function resolveAtmosTarget(
  options: Pick<AtmosSourceOptions, 'component' | 'stack'> = {},
  env: NodeJS.ProcessEnv = process.env,
): { component: string; stack: string } | undefined {
  const component = options.component ?? env.ATMOS_COMPONENT
  const stack = options.stack ?? env.ATMOS_STACK
  return component && stack ? { component, stack } : undefined
}

/**
 * Loads the component configuration from `atmos describe component`.
 *
 * Runs `atmos describe component <c> -s <s> --format json
 * --provenance=false --query .` (`--query .` returns the full component
 * section; without it Atmos 1.234 omits computed sections such as
 * `backend_type`, `remote_state_backend`, `workspace`), then describes every
 * terraform dependency in `dependencies.components` to resolve its
 * `remote_state_backend` (falling back to `backend`). Results are cached per
 * process.
 */
export class AtmosSource implements ComponentConfigSource {
  private readonly exec: AtmosExec
  private readonly bin: string

  constructor(private readonly options: AtmosSourceOptions = {}) {
    this.exec = options.exec ?? defaultExec
    this.bin = options.atmosBin ?? process.env.ATMOS_BIN ?? 'atmos'
  }

  public load(): ComponentConfig {
    const target = resolveAtmosTarget(this.options)
    if (!target) {
      throw new Error(
        'AtmosSource needs a component and stack: pass { component, stack } or set ATMOS_COMPONENT and ATMOS_STACK (Atmos hooks set them)',
      )
    }
    const desc = this.describe(target.component, target.stack)
    const stack = desc.atmos_stack ?? target.stack
    const dependencyBackends: Record<string, AtmosDependencyBackend> = {}
    for (const dep of terraformDependencies(desc)) {
      const name = dependencyName(dep)!
      const depDesc = this.describe(name, dep.stack ?? stack)
      const useRemote =
        !!depDesc.remote_state_backend_type &&
        depDesc.remote_state_backend &&
        Object.keys(depDesc.remote_state_backend).length > 0
      dependencyBackends[name] = {
        backend_type: useRemote
          ? depDesc.remote_state_backend_type
          : depDesc.backend_type,
        backend: useRemote ? depDesc.remote_state_backend : depDesc.backend,
        workspace: depDesc.workspace,
      }
    }
    return mapAtmosComponent(desc, dependencyBackends, {
      identity: this.options.identity,
    })
  }

  /**
   * `atmos describe component <component> -s <stack>`, cached per process.
   */
  public describe(component: string, stack: string): AtmosComponentDescription {
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.options.env }
    if (this.options.basePath) env.ATMOS_BASE_PATH = this.options.basePath
    if (this.options.cliConfigPath) {
      env.ATMOS_CLI_CONFIG_PATH = this.options.cliConfigPath
    }
    const args = [
      'describe',
      'component',
      component,
      '-s',
      stack,
      '--format',
      'json',
      '--provenance=false',
      '--query',
      '.',
      ...(this.options.extraArgs ?? []),
    ]
    const key = JSON.stringify([
      this.bin,
      this.options.cwd ?? process.cwd(),
      env.ATMOS_BASE_PATH,
      env.ATMOS_CLI_CONFIG_PATH,
      args,
    ])
    const cached = describeCache.get(key)
    if (cached) return cached

    let stdout: string
    try {
      stdout = this.exec(this.bin, args, { cwd: this.options.cwd, env })
    } catch (e: any) {
      if (e?.code === 'ENOENT') throw new AtmosNotFoundError(this.bin, e)
      const stderr = e?.stderr ? String(e.stderr).trim() : ''
      throw new Error(
        `\`${this.bin} ${args.join(' ')}\` failed${stderr ? `:\n${stderr}` : `: ${e?.message ?? e}`}`,
        { cause: e },
      )
    }
    let desc: AtmosComponentDescription
    try {
      desc = JSON.parse(stdout)
    } catch (e) {
      throw new Error(
        `Could not parse the JSON output of \`${this.bin} ${args.join(' ')}\``,
        { cause: e },
      )
    }
    describeCache.set(key, desc)
    return desc
  }
}
