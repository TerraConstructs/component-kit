import type { provider as awsProvider } from '@cdktn/provider-aws'
import type { AwsProviderConfig, ComponentConfig } from './config'
import type { Mutable } from './util/types'

/** Construct id (and registry key) of the default AWS provider. */
export const DEFAULT_AWS_PROVIDER_ID = 'DefaultAwsProvider'

/**
 * Stack level tag options, layered on top of the component configuration.
 */
export interface ComponentTagOptions {
  /**
   * Default tags applied on top of the identity and component tags.
   * These win over everything else.
   *
   * @default - no additional tags
   */
  readonly defaultTags?: Record<string, string>
  /**
   * Tags to ignore on top of the provider's `ignoreTags` (set union).
   *
   * @default - none
   */
  readonly ignoreTags?: awsProvider.AwsProviderIgnoreTags
}

/**
 * Compute the AWS `default_tags.tags` for a provider.
 *
 * Merge precedence (later wins, key order is first insertion):
 * `env, owner, project, managedBy, service, tfstateKey`, then component
 * `tags`, then provider specific tags, then stack `defaultTags`.
 */
export function buildDefaultTags(
  config: ComponentConfig,
  provider: AwsProviderConfig,
  stackDefaultTags?: Record<string, string>,
): Record<string, string> {
  const { identity, backend } = config
  const providerTags =
    typeof provider.defaultTags === 'object' ? provider.defaultTags : undefined
  return {
    env: identity.env,
    owner: identity.owner,
    project: identity.project,
    managedBy: 'terraform',
    service: identity.name,
    ...(backend?.type === 's3' &&
      backend.key && {
        tfstateKey: backend.key,
      }),
    ...(config.tags ?? {}),
    ...(providerTags ?? {}),
    ...(stackDefaultTags ?? {}),
  }
}

function mergeIgnoreTags(
  fromConfig: AwsProviderConfig['ignoreTags'],
  fromStack?: awsProvider.AwsProviderIgnoreTags,
): awsProvider.AwsProviderIgnoreTags | undefined {
  let ignoreTags: awsProvider.AwsProviderIgnoreTags | undefined
  if (fromConfig) {
    ignoreTags = {
      keys: fromConfig.keys,
      keyPrefixes: fromConfig.keyPrefixes,
    }
  }
  if (fromStack) {
    const keys = new Set([
      ...(ignoreTags?.keys ?? []),
      ...(fromStack.keys ?? []),
    ])
    const keyPrefixes = new Set([
      ...(ignoreTags?.keyPrefixes ?? []),
      ...(fromStack.keyPrefixes ?? []),
    ])
    ignoreTags = {
      keys: keys.size > 0 ? Array.from(keys) : undefined,
      keyPrefixes: keyPrefixes.size > 0 ? Array.from(keyPrefixes) : undefined,
    }
  }
  return ignoreTags
}

/**
 * Build the cdktn AWS provider config for one AWS provider entry.
 * Shape (assume_role list, profile precedence, tag merging) matches
 * cdktf-fogg-helpers v5.
 */
export function buildAwsProviderConfig(
  config: ComponentConfig,
  provider: AwsProviderConfig,
  options: ComponentTagOptions = {},
): awsProvider.AwsProviderConfig {
  const c: Mutable<awsProvider.AwsProviderConfig> = {
    region: provider.region,
    alias: provider.alias,
  }
  if (provider.defaultTags) {
    c.defaultTags = [
      { tags: buildDefaultTags(config, provider, options.defaultTags) },
    ]
  }
  const ignoreTags = mergeIgnoreTags(provider.ignoreTags, options.ignoreTags)
  if (ignoreTags) {
    c.ignoreTags = [ignoreTags]
  }
  if (provider.profile) {
    c.profile = provider.profile
  } else if (provider.roleArn) {
    c.assumeRole = [{ roleArn: provider.roleArn }]
  }
  return c
}
