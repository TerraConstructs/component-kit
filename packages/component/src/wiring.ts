import { provider as awsProvider } from '@cdktn/provider-aws'
import {
  type DataTerraformRemoteState,
  TerraformHclModule,
  TerraformLocal,
} from 'cdktn'
import type { Construct } from 'constructs'
import {
  buildAwsProviderConfig,
  type ComponentTagOptions,
  DEFAULT_AWS_PROVIDER_ID,
} from './aws-provider'
import { addBackend, addRemoteState } from './backend'
import type { ComponentConfig } from './config'
import { addCloudflareProvider, addDatadogProvider } from './providers'
import { type RemoteStateOptions, remoteStateProxy } from './remote-state'

export interface ComponentWiringOptions extends ComponentTagOptions {
  /**
   * Use an existing provider as the default AWS provider instead of creating
   * one (e.g. terraconstructs `AwsStack#provider`). When set, `providers.aws`
   * is not rendered by the wiring and `providers.awsRegional` must be empty.
   *
   * @default - the wiring creates `DefaultAwsProvider` from `providers.aws`
   */
  readonly defaultAwsProvider?: awsProvider.AwsProvider
}

/**
 * The public surface shared by every component stack flavour.
 */
export interface IComponentWiring {
  /** The resolved, tool-neutral component configuration. */
  readonly config: ComponentConfig
  /** Module name to TerraformHclModule. */
  readonly modules: Record<string, TerraformHclModule>
  /** Local name to TerraformLocal. */
  readonly locals: Record<string, TerraformLocal>
  /** The default AWS provider. */
  readonly defaultAwsProvider: awsProvider.AwsProvider
  /** Set variables on the main module (`mainModule.name`, default `main`). */
  setMainModuleVariables(variables: Record<string, any>): void
  /** Set variables on a configured module. */
  setModuleVariables(name: string, variables: Record<string, any>): void
  /** Get a configured local. */
  getLocal(name: string): TerraformLocal
}

/**
 * Emits backend, providers, remote states (for declared dependencies),
 * locals and modules for a {@link ComponentConfig} into a stack, and keeps
 * a registry of what it created.
 *
 * Composition unit shared by `ComponentStack` (cdktn TerraformStack) and
 * `ComponentAwsStack` (terraconstructs AwsStack), and usable from any other
 * stack class through {@link wireComponent}.
 *
 * Construct creation order (and therefore synthesized output) matches
 * cdktf-fogg-helpers v5: backend, default AWS provider, regional AWS
 * providers (`aws-{i}`), datadog, cloudflare, remote states, locals,
 * main module, modules.
 */
export class ComponentWiring implements IComponentWiring {
  public readonly config: ComponentConfig
  public readonly modules: Record<string, TerraformHclModule> = {}
  public readonly locals: Record<string, TerraformLocal> = {}
  private readonly _providers: Record<string, awsProvider.AwsProvider> = {}
  private readonly _remoteStates: Record<string, DataTerraformRemoteState> = {}

  constructor(
    private readonly scope: Construct,
    config: ComponentConfig,
    private readonly options: ComponentWiringOptions = {},
  ) {
    this.config = config
    const providers = config.providers ?? {}

    if (options.defaultAwsProvider) {
      if (providers.awsRegional && providers.awsRegional.length > 0) {
        throw new Error(
          'AWS regional providers are not supported by terraconstruct components',
        )
      }
      this._providers[DEFAULT_AWS_PROVIDER_ID] = options.defaultAwsProvider
    }

    addBackend(scope, config.backend)

    if (!options.defaultAwsProvider) {
      if (providers.aws) {
        this.addAwsProvider(providers.aws, DEFAULT_AWS_PROVIDER_ID)
      }
      for (const [i, regional] of (providers.awsRegional ?? []).entries()) {
        this.addAwsProvider(regional, `aws-${i}`)
      }
    }
    if (providers.datadog) addDatadogProvider(scope, providers.datadog)
    if (providers.cloudflare) addCloudflareProvider(scope, providers.cloudflare)

    for (const [name, backend] of Object.entries(config.dependencies ?? {})) {
      this._remoteStates[name] = addRemoteState(scope, name, backend)
    }

    for (const [key, value] of Object.entries(config.locals ?? {})) {
      this.locals[key] = new TerraformLocal(scope, key, `\${${value}}`)
    }

    if (config.mainModule?.source) {
      const id = this.mainModuleName
      this.modules[id] = new TerraformHclModule(scope, id, {
        source: config.mainModule.source,
        ...(config.mainModule.version && {
          version: config.mainModule.version,
        }),
      })
    }
    for (const [i, moduleConfig] of (config.modules ?? []).entries()) {
      const id = moduleConfig.name ?? `module_${i}`
      if (!moduleConfig.source) {
        console.warn(`Module ${id} does not have a source, skipping`)
        continue
      }
      if (this.modules[id]) {
        throw new Error(`Module ${id} already exists`)
      }
      this.modules[id] = new TerraformHclModule(scope, id, {
        source: moduleConfig.source,
        version: moduleConfig.version,
      })
    }
  }

  /** The AWS region of the default provider, if configured. */
  public get region(): string | undefined {
    return this.config.providers?.aws?.region
  }

  /** Name of the main module (default `main`). */
  public get mainModuleName(): string {
    return this.config.mainModule?.name ?? 'main'
  }

  /** Names of the declared dependencies (readable through `remoteState`). */
  public get dependencyNames(): string[] {
    return Object.keys(this._remoteStates)
  }

  /**
   * The AWS provider registered under `alias` (the default provider is
   * registered as `DefaultAwsProvider`).
   */
  public awsProvider(alias: string): awsProvider.AwsProvider {
    if (!this._providers[alias]) {
      throw new Error(`Provider ${alias} not found`)
    }
    return this._providers[alias]
  }

  public get defaultAwsProvider(): awsProvider.AwsProvider {
    if (!this._providers[DEFAULT_AWS_PROVIDER_ID]) {
      throw new Error(`Default AWS Provider not defined`)
    }
    return this._providers[DEFAULT_AWS_PROVIDER_ID]
  }

  /**
   * The raw `terraform_remote_state` data source of a declared dependency.
   */
  public remoteStateData(name: string): DataTerraformRemoteState {
    const data = this._remoteStates[name]
    if (!data) {
      const declared = this.dependencyNames
      throw new Error(
        `Remote state ${name} not found: "${name}" is not a declared dependency of component "${this.config.identity?.name}". ` +
          (declared.length > 0
            ? `Declared dependencies: ${declared.join(', ')}.`
            : 'This component declares no dependencies.') +
          ' Declare it in the component configuration (e.g. Atmos `dependencies.components`, fogg `depends_on`).',
      )
    }
    return data
  }

  public remoteState<T>(name: string, options?: RemoteStateOptions): any {
    return remoteStateProxy<T>(this.remoteStateData(name), options)
  }

  public setMainModuleVariables(variables: Record<string, any>): void {
    this.setModuleVariables(this.mainModuleName, variables)
  }

  public setModuleVariables(
    name: string,
    variables: Record<string, any>,
  ): void {
    if (!this.modules[name]) {
      throw new Error(`Module ${name} not found`)
    }
    for (const [key, value] of Object.entries(variables)) {
      this.modules[name].set(key, value)
    }
  }

  public getLocal(name: string): TerraformLocal {
    if (!this.locals[name]) {
      throw new Error(`Local ${name} not found`)
    }
    return this.locals[name]
  }

  private addAwsProvider(
    provider: NonNullable<ComponentConfig['providers']>['aws'] & object,
    id: string,
  ): void {
    const c = buildAwsProviderConfig(this.config, provider, this.options)
    this._providers[c.alias ?? DEFAULT_AWS_PROVIDER_ID] =
      new awsProvider.AwsProvider(this.scope, id, c)
  }
}

/**
 * Wire a component into an existing stack. See {@link ComponentWiring}.
 */
export function wireComponent(
  scope: Construct,
  config: ComponentConfig,
  options: ComponentWiringOptions = {},
): ComponentWiring {
  return new ComponentWiring(scope, config, options)
}
