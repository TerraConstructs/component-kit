import type { provider as awsProvider } from '@cdktn/provider-aws'
import type { TerraformHclModule, TerraformLocal } from 'cdktn'
import type { Construct } from 'constructs'
import { AwsStack, type AwsStackProps } from 'terraconstructs/lib/aws'
import {
  buildAwsProviderConfig,
  type ComponentTagOptions,
} from '../aws-provider'
import {
  type ComponentConfig,
  type ComponentConfigInput,
  resolveComponentConfig,
} from '../config'
import type {
  LegacyRemoteStateSchema,
  RemoteStateOutputs,
  RemoteStateSchema,
} from '../remote-state'
import type { StringifiedRecord } from '../util/types'
import { ComponentWiring, type IComponentWiring } from '../wiring'

export type ComponentAwsStackProps = ComponentConfigInput &
  ComponentTagOptions &
  Omit<AwsStackProps, 'providerConfig'>

/**
 * Compute the terraconstructs `AwsStack` provider config for a component.
 *
 * @throws if regional providers are configured (AwsStack manages regional
 *   providers itself) or no default AWS provider is configured
 */
export function awsStackProviderConfig(
  config: ComponentConfig,
  options: ComponentTagOptions = {},
): awsProvider.AwsProviderConfig {
  const providers = config.providers ?? {}
  if (providers.awsRegional && providers.awsRegional.length > 0) {
    throw new Error(
      'AWS regional providers are not supported by terraconstruct components',
    )
  }
  if (!providers.aws) {
    throw new Error('AWS provider configuration not found')
  }
  return buildAwsProviderConfig(config, providers.aws, options)
}

/**
 * A terraconstructs `AwsStack` wired from a {@link ComponentConfig}.
 *
 * The AWS provider is handed to `AwsStack` as `providerConfig` and
 * materialized eagerly (`void this.provider`), so components that only wrap
 * HCL modules still emit their configured provider (terraconstructs >= 0.2.5
 * creates it lazily).
 */
export class ComponentAwsStack extends AwsStack implements IComponentWiring {
  /**
   * The wiring lives in an ES private field: a subclass declaring a field with
   * any public name (`config`, `component`, ...) cannot shadow it and silently
   * break the delegated methods below.
   */
  readonly #wiring: ComponentWiring

  constructor(scope: Construct, id: string, props: ComponentAwsStackProps) {
    const config = resolveComponentConfig(props)
    const tagOptions: ComponentTagOptions = {
      defaultTags: props.defaultTags,
      ignoreTags: props.ignoreTags,
    }
    const providerConfig = awsStackProviderConfig(config, tagOptions)
    // strip our own props before handing the rest to AwsStack
    const {
      config: _config,
      source: _source,
      defaultTags: _defaultTags,
      ignoreTags: _ignoreTags,
      ...awsStackProps
    } = props as ComponentAwsStackProps & Record<string, unknown>
    super(scope, id, { ...awsStackProps, providerConfig })

    void this.provider

    this.#wiring = new ComponentWiring(this, config, {
      ...tagOptions,
      defaultAwsProvider: this.provider,
    })
  }

  /** The wiring unit (registry of providers, remote states, modules, locals). */
  public get componentWiring(): ComponentWiring {
    return this.#wiring
  }

  public get componentConfig(): ComponentConfig {
    return this.#wiring.config
  }

  public get modules(): Record<string, TerraformHclModule> {
    return this.#wiring.modules
  }

  public get locals(): Record<string, TerraformLocal> {
    return this.#wiring.locals
  }

  public get defaultAwsProvider(): awsProvider.AwsProvider {
    return this.provider
  }

  public remoteState<T = Record<string, string>>(
    name: string,
  ): StringifiedRecord<T>
  public remoteState<T>(name: string, schema: LegacyRemoteStateSchema<T>): T
  public remoteState<S extends RemoteStateSchema>(
    name: string,
    schema: S,
  ): RemoteStateOutputs<S>
  public remoteState(name: string, schema?: RemoteStateSchema): unknown {
    return this.#wiring.remoteState(name, schema as any)
  }

  public setMainModuleVariables(variables: Record<string, any>): void {
    this.#wiring.setMainModuleVariables(variables)
  }

  public setModuleVariables(
    name: string,
    variables: Record<string, any>,
  ): void {
    this.#wiring.setModuleVariables(name, variables)
  }

  public getLocal(name: string): TerraformLocal {
    return this.#wiring.getLocal(name)
  }
}
