/**
 * Test-only translation of a fogg v5 `Component` (.fogg-component.yaml) into
 * a tool-neutral ComponentConfig, plus the v5 default fixture.
 *
 * fogg-helpers v6 is expected to ship an equivalent adapter.
 */
import type {
  AWSProvider,
  Backend as FoggBackend,
  Component,
} from '@vincenthsh/cdktf-fogg-helpers'
import merge from 'deepmerge'
import type {
  AwsProviderConfig,
  Backend,
  CloudflareProviderConfig,
  ComponentConfig,
} from '../../src'

export interface FoggAdapterOptions {
  /** v5 `FoggStackProps.forceRemoteStates` */
  forceRemoteStates?: boolean
}

function mapBackend(b: FoggBackend): Backend {
  if (b?.kind === 's3' && b.s3) {
    return {
      type: 's3',
      bucket: b.s3.bucket,
      key: b.s3.key_path,
      region: b.s3.region,
      dynamodbTable: b.s3.dynamo_table,
      profile: b.s3.profile,
      roleArn: b.s3.role_arn,
    }
  }
  // let the wiring reject it, as v5 does
  return { type: b?.kind } as unknown as Backend
}

function mapAws(p: AWSProvider): AwsProviderConfig {
  return {
    region: p.region,
    alias: p.alias,
    accountId: p.account_id,
    profile: p.profile,
    roleArn: p.role_arn,
    defaultTags: p.default_tags?.enabled ? true : undefined,
    ignoreTags: p.ignore_tags?.enabled
      ? { keys: p.ignore_tags.keys, keyPrefixes: p.ignore_tags.key_prefixes }
      : undefined,
  }
}

export function foggComponentToConfig(
  c: Component,
  options: FoggAdapterOptions = {},
): ComponentConfig {
  const pc =
    c.providers_configuration ?? ({} as Component['providers_configuration'])

  let cloudflare: CloudflareProviderConfig | undefined
  for (const p of Object.values(c.required_providers ?? {})) {
    if (!p.enabled) continue
    switch (p.source) {
      case 'cloudflare/cloudflare':
        cloudflare = { config: p.config }
        break
      default:
        throw new Error(`Unsupported provider ${p.source}`)
    }
  }

  const withDeps =
    (options.forceRemoteStates ?? false) || c.component_backends_filtered
  return {
    identity: { name: c.name, env: c.env, project: c.project, owner: c.owner },
    backend: mapBackend(c.backend),
    // v5 merges the *default* provider's tags into every provider
    tags: pc.aws?.default_tags?.enabled ? pc.aws.default_tags.tags : undefined,
    providers: {
      aws: pc.aws ? mapAws(pc.aws) : undefined,
      awsRegional: (pc.aws_regional_providers ?? []).map(mapAws),
      datadog: pc.datadog ? {} : undefined,
      cloudflare,
    },
    dependencies: withDeps
      ? Object.fromEntries(
          Object.entries(c.component_backends ?? {}).map(([k, v]) => [
            k,
            mapBackend(v),
          ]),
        )
      : {},
    locals: c.locals_block,
    mainModule: c.module_source
      ? { source: c.module_source, name: c.module_name }
      : undefined,
    modules: c.modules,
    raw: c,
  }
}

/**
 * v5 test fixture (test/fogg-stack.test.ts getDefaultComponentConfig)
 */
export function getDefaultComponentConfig(): Component {
  const defaultCiComponent = {
    Enabled: false,
    Buildevents: false,
    AWSProfileName: '',
    AWSRoleName: '',
    AWSRegion: '',
    AWSAccountID: '',
    Command: '',
  }
  return {
    path_to_repo_root: '.',
    terraform_version: '1.7.5',
    account_backends: {},
    all_accounts: {},
    backend: {
      kind: 's3',
      s3: {
        account_name: 'fake-account',
        bucket: 'fake-bucket',
        key_path: 'fake-keypath',
        region: 'us-fake-1',
      },
    },
    package_fields: {},
    component_backends: {},
    autoplan_relative_globs: [],
    autoplan_files: [],
    locals_block: {},
    component_backends_filtered: false,
    env: 'test-env-1',
    extra_vars: {},
    name: 'fake-name',
    owner: 'fake-owner',
    project: 'fake-project',
    providers_configuration: {
      aws: {
        account_id: '123456789012',
        region: 'us-fake-1',
      },
      aws_regional_providers: [],
    },
    required_providers: {},
    provider_versions: {},
    cdktf_dependencies: {},
    cdktf_dev_dependencies: {},
    tf_lint: {
      enabled: false,
    },
    TravisCI: defaultCiComponent,
    CircleCI: {
      ...defaultCiComponent,
      SSHFingerprints: [],
    },
    GitHubActionsCI: defaultCiComponent,
    eks: {
      cluster_name: 'fake-cluster',
    },
    providers: {},
    variables: [],
    outputs: [],
    modules: [],
  }
}

/**
 * The v5 default fixture deep-merged with a (deep partial) patch, as the v5
 * tests do with `merge(getDefaultComponentConfig(), {...})`.
 */
export function withDefaults(patch: Record<string, unknown>): Component {
  return merge(getDefaultComponentConfig(), patch as Partial<Component>)
}
