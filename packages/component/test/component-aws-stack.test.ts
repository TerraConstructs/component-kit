/**
 * Port of cdktf-fogg-helpers v5 test/fogg-terrastack.test.ts.
 *
 * Every case synthesizes the published v5 FoggTerraStack and
 * ComponentAwsStack from the same fixture and asserts byte identical JSON,
 * then runs the original v5 assertions.
 */
import {
  type Component,
  type FoggTerraStack,
  type FoggTerraStackProps,
} from '@vincenthsh/cdktf-fogg-helpers'
import { TerraformOutput, Testing } from 'cdktn'
import { describe, expect, it } from 'vitest'
import { ComponentAwsStack } from '../src/aws'
import { Template } from './assertions'
import {
  foggComponentToConfig,
  getDefaultComponentConfig,
  withDefaults,
} from './helpers/fogg'
import { synth, v5FoggTerraStack } from './helpers/v5'

// Prefix for resource UUID, must be letter-leading (terraconstructs >= 0.2.8)
const gridUUID = 'g123-456'
const environmentName = 'development'

interface ParityOptions {
  props?: Partial<FoggTerraStackProps>
  v5Act?: (stack: FoggTerraStack) => void
  act?: (stack: ComponentAwsStack) => void
}

function newStack(
  component: Component,
  props: Partial<FoggTerraStackProps> = {},
) {
  const { forceRemoteStates, ...rest } = props
  return new ComponentAwsStack(Testing.app(), 'MyStack', {
    gridUUID,
    environmentName,
    ...rest,
    config: foggComponentToConfig(component, { forceRemoteStates }),
  })
}

function parity(component: Component, opts: ParityOptions = {}) {
  const props = opts.props ?? {}
  const v5 = v5FoggTerraStack(component, {
    gridUUID,
    environmentName,
    ...props,
  })
  opts.v5Act?.(v5)
  const stack = newStack(component, props)
  opts.act?.(stack)
  expect(synth(stack)).toBe(synth(v5))
  return stack
}

describe('ComponentAwsStack (v5 FoggTerraStack parity)', () => {
  it('translates backend config to tf backend config', () => {
    const stack = parity(
      withDefaults({
        backend: {
          kind: 's3',
          s3: {
            bucket: 'bucket-1',
            key_path: 'fake-keypath',
            region: 'us-fake-1',
          },
        },
      }),
    )
    Template.fromStack(stack).toMatchObject({
      terraform: {
        backend: {
          s3: { bucket: 'bucket-1', key: 'fake-keypath', region: 'us-fake-1' },
        },
      },
    })
  })

  it('throws error on unsupported backend', () => {
    const component = withDefaults({
      backend: { kind: 'unknown' },
    })
    expect(() =>
      v5FoggTerraStack(component, { gridUUID, environmentName }),
    ).toThrow(/Unsupported backend configuration/)
    expect(() => newStack(component)).toThrow(
      /Unsupported backend configuration/,
    )
  })

  it('skips creating remote states if forceRemoteStates is false', () => {
    const stack = parity(
      withDefaults({
        component_backends: {
          network: { kind: 's3', s3: { bucket: 'some-bucket' } },
        },
        component_backends_filtered: false,
      }),
      { props: { forceRemoteStates: false } },
    )
    expect(() => stack.remoteState('network')).toThrow(
      /Remote state network not found/,
    )
  })

  describe('creates remote states if forceRemoteStates is true', () => {
    const component = () =>
      withDefaults({
        component_backends: {
          network: { kind: 's3', s3: { bucket: 'some-bucket' } },
        },
      })
    const props = { forceRemoteStates: true }
    function addOutput(stack: any, outputName: string, value: any) {
      new TerraformOutput(stack, outputName, { value, staticId: true })
    }

    it('as data terraform remote state', () => {
      const stack = parity(component(), { props })
      Template.fromStack(stack).toMatchObject({
        data: {
          terraform_remote_state: {
            network: { backend: 's3', config: { bucket: 'some-bucket' } },
          },
        },
      })
    })

    it('with strongly typed access to simple outputs', () => {
      interface NetworkOutputs {
        vpc_id: string
      }
      const stack = parity(component(), {
        props,
        v5Act: (s) =>
          addOutput(
            s,
            'vpc_id',
            s.remoteState<NetworkOutputs>('network').vpc_id,
          ),
        act: (s) =>
          addOutput(
            s,
            'vpc_id',
            s.remoteState<NetworkOutputs>('network').vpc_id,
          ),
      })
      Template.fromStack(stack).toMatchObject({
        output: {
          vpc_id: {
            value: '${data.terraform_remote_state.network.outputs.vpc_id}',
          },
        },
      })
    })
  })

  it('exposes file dependencies through locals', () => {
    const stack = parity(
      withDefaults({
        locals_block: {
          foo_foo_foo: 'yamldecode(file("../../../foo-fooFoo.yaml"))',
        },
      }),
    )
    expect(stack.getLocal('foo_foo_foo')).toBeDefined()
    Template.fromStack(stack).toMatchObject({
      locals: {
        foo_foo_foo: '${yamldecode(file("../../../foo-fooFoo.yaml"))}',
      },
    })
  })

  it('allows configuring modules', () => {
    const networkInputs = {
      name: 'my-vpc',
      cidr: '10.0.0.0/16',
      azs: ['us-west-2a', 'us-west-2b', 'us-west-2c'],
    }
    const stack = parity(
      withDefaults({
        modules: [
          {
            name: 'network',
            source: 'terraform-aws-modules/vpc/aws',
            version: '5.12.0',
            variables: ['name', 'cidr', 'azs'],
          },
        ],
      }),
      {
        v5Act: (s) => s.setModuleVariables('network', networkInputs),
        act: (s) => s.setModuleVariables('network', networkInputs),
      },
    )
    Template.fromStack(stack).toMatchObject({
      module: {
        network: {
          ...networkInputs,
          source: 'terraform-aws-modules/vpc/aws',
          version: '5.12.0',
        },
      },
    })
  })

  it('allows configuring main module', () => {
    const module_source = 'terraform/modules/foo'
    const moduleInputs = { foo: 'bar', baz: 'qux' }
    const stack = parity(withDefaults({ module_source }), {
      v5Act: (s) => s.setMainModuleVariables(moduleInputs),
      act: (s) => s.setMainModuleVariables(moduleInputs),
    })
    Template.fromStack(stack).toMatchObject({
      module: { main: { ...moduleInputs, source: module_source } },
    })
  })

  it('throws error setting variable without module_source', () => {
    const stack = parity(getDefaultComponentConfig())
    expect(() => stack.setMainModuleVariables({})).toThrow(
      /Module main not found/,
    )
  })

  it('exposes default Aws provider', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            role_arn: 'arn:aws:iam::123456789012:role/role',
          },
        },
      }),
    )
    expect(stack.defaultAwsProvider).toBeDefined()
    expect(stack.defaultAwsProvider).toBe(stack.provider)
    expect(stack.componentWiring.awsProvider('DefaultAwsProvider')).toBe(
      stack.provider,
    )
  })

  it('emits the provider eagerly even when nothing uses it', () => {
    const stack = parity(getDefaultComponentConfig())
    Template.fromStack(stack).toMatchObject({
      provider: { aws: [{ region: 'us-fake-1' }] },
    })
  })

  it('throws on aliased providers', () => {
    const component = withDefaults({
      providers_configuration: {
        aws: {
          account_id: '123456789012',
          region: 'us-west-2',
          role_arn: 'arn:aws:iam::123456789012:role/role',
        },
        aws_regional_providers: [
          {
            account_id: '210987654321',
            alias: 'shared_services',
            region: 'ap-southeast-1',
            role_arn: 'arn:aws:iam::210987654321:role/role',
          },
        ],
      },
    })
    const re =
      /AWS regional providers are not supported by terraconstruct components/
    expect(() =>
      v5FoggTerraStack(component, { gridUUID, environmentName }),
    ).toThrow(re)
    expect(() => newStack(component)).toThrow(re)
  })

  it('throws without default aws provider', () => {
    const component = getDefaultComponentConfig()
    delete component.providers_configuration.aws
    const re = /AWS provider configuration not found/
    expect(() =>
      v5FoggTerraStack(component, { gridUUID, environmentName }),
    ).toThrow(re)
    expect(() => newStack(component)).toThrow(re)
  })

  it('sets default tags', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            default_tags: { enabled: true, tags: { env: 'test', owner: 'me' } },
          },
        },
      }),
    )
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [
          {
            region: 'us-west-2',
            default_tags: [
              {
                tags: {
                  env: 'test',
                  owner: 'me',
                  managedBy: 'terraform',
                  service: 'fake-name',
                },
              },
            ],
          },
        ],
      },
    })
  })

  it('sets ignore tags', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            ignore_tags: { enabled: true, keys: ['foo', 'bar'] },
          },
        },
      }),
    )
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [{ region: 'us-west-2', ignore_tags: [{ keys: ['foo', 'bar'] }] }],
      },
    })
  })

  it('sets config default and constructor default tags', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            default_tags: { enabled: true, tags: { env: 'test', owner: 'me' } },
          },
        },
      }),
      {
        props: {
          defaultTags: {
            owner: 'me2',
            service: 'my-service',
            purpose: 'my-purpose',
          },
        },
      },
    )
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [
          {
            region: 'us-west-2',
            default_tags: [
              {
                tags: {
                  env: 'test',
                  owner: 'me2',
                  managedBy: 'terraform',
                  service: 'my-service',
                  purpose: 'my-purpose',
                },
              },
            ],
          },
        ],
      },
    })
  })

  it('sets config ignore and constructor ignore tags', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            ignore_tags: { enabled: true, keys: ['foo', 'bar'] },
          },
        },
      }),
      { props: { ignoreTags: { keys: ['foo', 'bar', 'baz'] } } },
    )
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [
          {
            region: 'us-west-2',
            ignore_tags: [{ keys: ['foo', 'bar', 'baz'] }],
          },
        ],
      },
    })
  })

  it('sets constructor ignore tags', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: { account_id: '123456789012', region: 'us-west-2' },
        },
      }),
      { props: { ignoreTags: { keys: ['foo', 'bar', 'baz'] } } },
    )
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [
          {
            region: 'us-west-2',
            ignore_tags: [{ keys: ['foo', 'bar', 'baz'] }],
          },
        ],
      },
    })
  })

  it('exposes component configuration values', () => {
    const stack = parity(getDefaultComponentConfig())
    expect(stack.componentConfig.identity.project).toBeDefined()
    expect(stack.componentConfig.identity.owner).toBeDefined()
    expect(stack.componentConfig.identity.env).toBeDefined()
  })

  it('parses bundled and generic provider configurations', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          datadog: { enabled: true, version: '2.0.0' },
        },
        required_providers: {
          cloudflare: {
            enabled: true,
            source: 'cloudflare/cloudflare',
            version: '~> 4.0',
            config: { api_token: 'bar' },
          },
        },
      }),
    )
    expect(stack.region).toBe('us-fake-1')
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [{ region: 'us-fake-1' }],
        cloudflare: [{ api_token: 'bar' }],
        datadog: [{}],
      },
      terraform: {
        required_providers: {
          aws: { source: 'hashicorp/aws' },
          cloudflare: { source: 'cloudflare/cloudflare' },
          datadog: { source: 'DataDog/datadog' },
        },
      },
    })
  })
})
