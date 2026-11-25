import type { provider as awsProvider } from '@cdktn/provider-aws'
import {
  type TerraformHclModule,
  type TerraformLocal,
  TerraformStack,
} from 'cdktn'
import type { Construct } from 'constructs'
import type { ComponentTagOptions } from './aws-provider'
import {
  type ComponentConfig,
  type ComponentConfigInput,
  resolveComponentConfig,
} from './config'
import { ComponentWiring, type IComponentWiring } from './wiring'
import type { StringifiedRecord } from './util/types'

export type ComponentStackProps = ComponentConfigInput & ComponentTagOptions

/**
 * A cdktn `TerraformStack` wired from a {@link ComponentConfig}:
 * backend, AWS (default + regional), datadog and cloudflare providers,
 * remote states for declared dependencies, locals and modules.
 *
 * ```ts
 * new ComponentStack(app, 'network', { config })
 * new ComponentStack(app, 'network', { source: new AtmosSource() })
 * ```
 */
export class ComponentStack extends TerraformStack implements IComponentWiring {
  /** The wiring unit (registry of providers, remote states, modules, locals). */
  public readonly component: ComponentWiring

  constructor(scope: Construct, id: string, props: ComponentStackProps) {
    super(scope, id)
    const config = resolveComponentConfig(props)
    this.component = new ComponentWiring(this, config, {
      defaultTags: props.defaultTags,
      ignoreTags: props.ignoreTags,
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

  /** The default AWS provider region, if configured. */
  public get region(): string | undefined {
    return this.component.region
  }

  public get defaultAwsProvider(): awsProvider.AwsProvider {
    return this.component.defaultAwsProvider
  }

  /** An AWS provider by alias (`DefaultAwsProvider` for the default one). */
  public awsProvider(alias: string): awsProvider.AwsProvider {
    return this.component.awsProvider(alias)
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
