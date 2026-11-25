import type { Construct } from 'constructs'
import type { CloudflareProviderConfig, DatadogProviderConfig } from './config'
import { optionalRequire } from './util/optional-require'

/**
 * Add the Datadog provider (construct id `datadog`), configured through
 * environment variables, as in v5.
 */
export function addDatadogProvider(
  scope: Construct,
  _config: DatadogProviderConfig,
): Construct {
  const { provider } = optionalRequire<
    typeof import('@cdktn/provider-datadog')
  >('@cdktn/provider-datadog', 'providers.datadog')
  return new provider.DatadogProvider(scope, 'datadog', {})
}

/**
 * Add the Cloudflare provider (construct id `cloudflare`). Config keys are
 * passed through as overrides because they are snake_case HCL attributes.
 */
export function addCloudflareProvider(
  scope: Construct,
  config: CloudflareProviderConfig,
): Construct {
  const { provider } = optionalRequire<
    typeof import('@cdktn/provider-cloudflare')
  >('@cdktn/provider-cloudflare', 'providers.cloudflare')
  const cf = new provider.CloudflareProvider(scope, 'cloudflare')
  for (const [key, value] of Object.entries(config.config ?? {})) {
    cf.addOverride(key, value)
  }
  return cf
}
