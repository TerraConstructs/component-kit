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
  public readonly component: ComponentWiring

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

    this.component = new ComponentWiring(this, config, {
      ...tagOptions,
      defaultAwsProvider: this.provider,
    })
  }

  public get config(): ComponentConfig {
    return this.component.config
  }

  public get modules(): Record<string, TerraformHclModule> {
    return this.component.modules
  }

  public get locals(): Record<string, TerraformLocal> {
    return this.component.locals
  }

  public get defaultAwsProvider(): awsProvider.AwsProvider {
    return this.provider
  }

  /**
   * Access the outputs of a declared dependency. Without schema every
   * property is a string token (`getString`).
   *
   * @throws if `name` is not a declared dependency
   */
  public remoteState<T = Record<string, string>>(
    name: string,
  ): StringifiedRecord<T> {
    return this.component.remoteState(name)
  }

  public setMainModuleVariables(variables: Record<string, any>): void {
    this.component.setMainModuleVariables(variables)
  }

  public setModuleVariables(
    name: string,
    variables: Record<string, any>,
  ): void {
    this.component.setModuleVariables(name, variables)
  }

  public getLocal(name: string): TerraformLocal {
    return this.component.getLocal(name)
  }
}
