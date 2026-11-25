/**
 * Tool-neutral component configuration.
 *
 * This is the contract between a configuration *source* (fogg, Atmos, a test
 * fixture, ...) and the stack wiring. It intentionally only contains what the
 * wiring consumes; tool specific data can be carried along in `raw`.
 */
export interface ComponentConfig {
  /**
   * Who/what this component is. Used for the default AWS tags.
   */
  readonly identity: ComponentIdentity

  /**
   * Where this component stores its own state.
   */
  readonly backend: Backend

  /**
   * Component level tags, merged into the `default_tags` of every AWS
   * provider that has `defaultTags` enabled (after the identity tags,
   * before provider specific tags).
   *
   * @default - no extra tags
   */
  readonly tags?: Record<string, string>

  /**
   * Providers to configure.
   *
   * @default - no providers
   */
  readonly providers?: ProvidersConfig

  /**
   * Components this component may read remote state from, keyed by the name
   * used in `remoteState(name)`. Each value is the dependency's state backend.
   *
   * Only declared dependencies can be read; this replaces fogg's
   * `component_backends` + `component_backends_filtered`.
   *
   * @default - no dependencies
   */
  readonly dependencies?: Record<string, Backend>

  /**
   * Terraform locals, as raw HCL expressions (they are wrapped in `${...}`).
   *
   * @default - no locals
   */
  readonly locals?: Record<string, string>

  /**
   * The component's main module (fogg `module_source` / `module_name`).
   * Its construct id is `name` (default `main`).
   *
   * @default - no main module
   */
  readonly mainModule?: MainModuleConfig

  /**
   * Additional modules (fogg `modules[]`). Construct id is `name`,
   * or `module_{index}` when unnamed. Modules without source are skipped.
   *
   * @default - no modules
   */
  readonly modules?: ModuleConfig[]

  /**
   * The raw, tool specific configuration this was derived from (escape hatch).
   */
  readonly raw?: unknown
}

export interface ComponentIdentity {
  /** Component name, rendered as the `service` default tag. */
  readonly name: string
  /** Environment, rendered as the `env` default tag. */
  readonly env: string
  /** Project, rendered as the `project` default tag. */
  readonly project: string
  /** Owner, rendered as the `owner` default tag. */
  readonly owner: string
}

/**
 * State backend. A discriminated union on `type`, S3 only for now.
 */
export type Backend = S3Backend

export interface S3Backend {
  readonly type: 's3'
  readonly bucket: string
  /** State object key. */
  readonly key: string
  readonly region: string
  readonly dynamodbTable?: string
  /** Use S3 native locking (`use_lockfile`). */
  readonly useLockfile?: boolean
  /**
   * Shared config profile. Takes precedence over `roleArn` (v5 behaviour:
   * profile and assume_role are never emitted together).
   */
  readonly profile?: string
  /** Role to assume, rendered as `assume_role { role_arn }`. */
  readonly roleArn?: string
  /**
   * @default true
   */
  readonly encrypt?: boolean
  /**
   * Prefix for non-default workspaces (`workspace_key_prefix`).
   * @default - not set
   */
  readonly workspaceKeyPrefix?: string
  /**
   * Terraform workspace of the state. Only used when this backend is read as
   * a dependency (`terraform_remote_state.workspace`).
   * @default - not set (the `default` workspace)
   */
  readonly workspace?: string
}

export interface ProvidersConfig {
  /**
   * The default AWS provider. Construct id `DefaultAwsProvider`.
   */
  readonly aws?: AwsProviderConfig
  /**
   * Additional (regional/aliased) AWS providers. Construct ids `aws-{index}`.
   */
  readonly awsRegional?: AwsProviderConfig[]
  /**
   * Datadog provider, rendered as an empty `provider "datadog" {}` block
   * (configured through environment variables). Construct id `datadog`.
   */
  readonly datadog?: DatadogProviderConfig
  /**
   * Cloudflare provider. `config` keys are passed through verbatim as
   * overrides (snake_case, e.g. `api_token`). Construct id `cloudflare`.
   */
  readonly cloudflare?: CloudflareProviderConfig
}

export interface AwsProviderConfig {
  readonly region: string
  readonly alias?: string
  /** Informational only (not rendered). */
  readonly accountId?: string
  /** Shared config profile. Takes precedence over `roleArn`. */
  readonly profile?: string
  /** Role to assume, rendered as `assume_role [{ role_arn }]`. */
  readonly roleArn?: string
  /**
   * Render `default_tags`.
   *
   * - `false`/unset: no `default_tags` block
   * - `true`: identity tags + component `tags` + stack `defaultTags`
   * - a record: as `true`, plus these provider specific tags (merged after
   *   the component `tags`, before stack `defaultTags`)
   */
  readonly defaultTags?: boolean | Record<string, string>
  /**
   * Render `ignore_tags`. Merged (set union) with the stack `ignoreTags`.
   * Presence means enabled, even when both lists are empty.
   */
  readonly ignoreTags?: IgnoreTagsConfig
}

export interface IgnoreTagsConfig {
  readonly keys?: string[]
  readonly keyPrefixes?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- reserved for future settings
export interface DatadogProviderConfig {}

export interface CloudflareProviderConfig {
  readonly config?: Record<string, unknown>
}

export interface MainModuleConfig {
  readonly source: string
  /** @default 'main' */
  readonly name?: string
  readonly version?: string
}

export interface ModuleConfig {
  readonly source?: string
  readonly name?: string
  readonly version?: string
}

/**
 * Something that can produce a ComponentConfig (a file, a CLI, ...).
 */
export interface ComponentConfigSource {
  load(): ComponentConfig
}

/**
 * Constructor input: either a ready config or a source to load it from.
 */
export type ComponentConfigInput =
  | { readonly config: ComponentConfig; readonly source?: never }
  | { readonly source: ComponentConfigSource; readonly config?: never }

/**
 * Resolve a {@link ComponentConfigInput} to a config.
 */
export function resolveComponentConfig(
  input: ComponentConfigInput,
): ComponentConfig {
  if (input && 'config' in input && input.config) return input.config
  if (input && 'source' in input && input.source) return input.source.load()
  throw new Error(
    'A component stack needs either `config` (a ComponentConfig) or `source` (a ComponentConfigSource)',
  )
}
