import type {
  AwsProviderConfig,
  Backend,
  ComponentConfig,
  ComponentIdentity,
  MainModuleConfig,
  ModuleConfig,
  ProvidersConfig,
} from '@tcons/component'
import type {
  AtmosComponentDescription,
  AtmosDependency,
  AtmosDependencyBackend,
} from './types'

/** `settings` key holding cdktn specific component settings. */
export const SETTINGS_KEY = 'component_kit'

export interface AtmosMappingOptions {
  /**
   * Override (parts of) the identity derived from `vars`.
   */
  readonly identity?: Partial<ComponentIdentity>
}

const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isEmpty = (v: unknown) => !isObject(v) || Object.keys(v).length === 0

function componentLabel(desc: AtmosComponentDescription): string {
  const c = desc.atmos_component ?? desc.component ?? '<unknown>'
  const s = desc.atmos_stack ?? desc.stack
  return s ? `${c} (stack ${s})` : c
}

/** The remote state name of a dependency entry. */
export function dependencyName(dep: AtmosDependency): string | undefined {
  return dep.component ?? dep.name
}

/**
 * Dependencies of a component that produce remote state: entries of
 * `dependencies.components` with a name and kind terraform (or no kind).
 */
export function terraformDependencies(
  desc: AtmosComponentDescription,
): AtmosDependency[] {
  return (desc.dependencies?.components ?? []).filter(
    (d) =>
      dependencyName(d) !== undefined &&
      (d.kind === undefined || d.kind === 'terraform'),
  )
}

function roleArnOf(v: Record<string, any>): string | undefined {
  const ar = Array.isArray(v.assume_role) ? v.assume_role[0] : v.assume_role
  return (isObject(ar) ? ar.role_arn : undefined) ?? v.role_arn
}

/**
 * Map an Atmos `backend_type` + `backend` section to a Backend.
 *
 * `workspace_key_prefix` (always set by Atmos) is only kept when the
 * workspace is not `default`: with workspaces disabled the state path is
 * just `key`, as with fogg.
 */
export function mapAtmosBackend(
  type: string | undefined,
  backend: Record<string, any> | undefined,
  workspace: string | undefined,
  label: string,
): Backend {
  if (type !== 's3') {
    throw new Error(
      `Unsupported Atmos backend_type "${type ?? ''}" for ${label}: only "s3" is supported`,
    )
  }
  const b = backend ?? {}
  for (const required of ['bucket', 'key', 'region']) {
    if (!b[required]) {
      throw new Error(`Atmos S3 backend of ${label} has no "${required}"`)
    }
  }
  const nonDefaultWorkspace =
    workspace && workspace !== 'default' ? workspace : undefined
  return {
    type: 's3',
    bucket: b.bucket,
    key: b.key,
    region: b.region,
    dynamodbTable: b.dynamodb_table || undefined,
    useLockfile:
      typeof b.use_lockfile === 'boolean' ? b.use_lockfile : undefined,
    profile: b.profile || undefined,
    roleArn: roleArnOf(b),
    encrypt: typeof b.encrypt === 'boolean' ? b.encrypt : true,
    workspaceKeyPrefix: nonDefaultWorkspace
      ? b.workspace_key_prefix
      : undefined,
    workspace: nonDefaultWorkspace,
  }
}

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!isObject(v)) return undefined
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([k, value]) => [
        k,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]),
  )
}

function mapAwsProvider(
  p: Record<string, any>,
  vars: Record<string, any>,
  label: string,
): AwsProviderConfig {
  const region = p.region ?? vars.region
  if (!region) {
    throw new Error(
      `Atmos providers.aws of ${label} has no region (set providers.aws.region or vars.region)`,
    )
  }
  let defaultTags: AwsProviderConfig['defaultTags']
  if (p.default_tags !== undefined && p.default_tags !== null) {
    const tags = stringRecord(p.default_tags?.tags)
    defaultTags = tags && Object.keys(tags).length > 0 ? tags : true
  }
  const ignore = p.ignore_tags
  return {
    region,
    alias: p.alias || undefined,
    profile: p.profile || undefined,
    roleArn: roleArnOf(p),
    defaultTags,
    ignoreTags: isObject(ignore)
      ? { keys: ignore.keys, keyPrefixes: ignore.key_prefixes }
      : undefined,
  }
}

function mapProviders(
  providers: Record<string, any> | undefined,
  vars: Record<string, any>,
  label: string,
): ProvidersConfig {
  const result: {
    aws?: AwsProviderConfig
    awsRegional?: AwsProviderConfig[]
    datadog?: object
    cloudflare?: { config: Record<string, unknown> }
  } = {}
  for (const [name, value] of Object.entries(providers ?? {})) {
    if (value === null || value === undefined) continue
    switch (name) {
      case 'aws': {
        const entries: Record<string, any>[] = Array.isArray(value)
          ? value
          : [value]
        const defaultIndex = entries.findIndex((e) => !e?.alias)
        if (defaultIndex >= 0) {
          result.aws = mapAwsProvider(entries[defaultIndex], vars, label)
        }
        const regional = entries.filter((_, i) => i !== defaultIndex)
        if (regional.length > 0) {
          result.awsRegional = regional.map((e) =>
            mapAwsProvider(e, vars, label),
          )
        }
        break
      }
      case 'datadog':
        result.datadog = {}
        break
      case 'cloudflare':
        result.cloudflare = { config: isObject(value) ? value : {} }
        break
      default:
        throw new Error(
          `Unsupported provider "${name}" in the Atmos providers section of ${label} (supported: aws, datadog, cloudflare)`,
        )
    }
  }
  return result
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

/**
 * Derive the identity from Atmos vars (see README "Mapping convention").
 */
export function mapIdentity(
  desc: AtmosComponentDescription,
  overrides: Partial<ComponentIdentity> = {},
): ComponentIdentity {
  const vars = desc.vars ?? {}
  const tags = isObject(vars.tags) ? vars.tags : {}
  return {
    name:
      overrides.name ??
      firstString(vars.name, desc.atmos_component, desc.component) ??
      '',
    env:
      overrides.env ??
      firstString(vars.env, vars.stage, vars.environment) ??
      '',
    project:
      overrides.project ??
      firstString(vars.project, vars.namespace, vars.tenant) ??
      '',
    owner: overrides.owner ?? firstString(vars.owner, tags.owner) ?? '',
  }
}

/**
 * Map an Atmos component description to a ComponentConfig.
 *
 * @param desc - `atmos describe component` output (or the generated file)
 * @param dependencyBackends - resolved state backends, keyed by dependency name
 */
export function mapAtmosComponent(
  desc: AtmosComponentDescription,
  dependencyBackends: Record<string, AtmosDependencyBackend>,
  options: AtmosMappingOptions = {},
): ComponentConfig {
  const label = componentLabel(desc)
  const vars = desc.vars ?? {}
  const kit = isObject(desc.settings?.[SETTINGS_KEY])
    ? desc.settings[SETTINGS_KEY]
    : {}

  const dependencies: Record<string, Backend> = {}
  for (const [name, dep] of Object.entries(dependencyBackends)) {
    dependencies[name] = mapAtmosBackend(
      dep.backend_type,
      dep.backend,
      dep.workspace,
      `dependency "${name}" of ${label}`,
    )
  }

  const mainModule: MainModuleConfig | undefined = isObject(kit.main_module)
    ? {
        source: kit.main_module.source,
        name: kit.main_module.name,
        version: kit.main_module.version,
      }
    : undefined
  const modules: ModuleConfig[] | undefined = Array.isArray(kit.modules)
    ? kit.modules.map((m: Record<string, any>) => ({
        name: m.name,
        source: m.source,
        version: m.version,
      }))
    : undefined

  const tags = stringRecord(vars.tags)
  return {
    identity: mapIdentity(desc, options.identity),
    backend: mapAtmosBackend(
      desc.backend_type,
      desc.backend,
      desc.workspace,
      label,
    ),
    tags: tags && Object.keys(tags).length > 0 ? tags : undefined,
    providers: mapProviders(desc.providers, vars, label),
    dependencies,
    locals: isEmpty(kit.locals) ? undefined : stringRecord(kit.locals),
    mainModule,
    modules,
    raw: desc,
  }
}
