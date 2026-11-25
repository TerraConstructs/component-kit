/**
 * Port of cdktf-fogg-helpers v5 test/fogg-stack.test.ts.
 *
 * Every case builds the v5 fixture, synthesizes it with the *published*
 * v5 FoggStack and with ComponentStack (fed through the test-only fogg
 * adapter), asserts the two synthesized JSON documents are byte identical,
 * and then runs the original v5 assertions against ComponentStack.
 */
import {
  type Component,
  FoggStack,
  type FoggStackProps,
} from '@vincenthsh/cdktf-fogg-helpers'
import { App, TerraformOutput, Testing } from 'cdktn'
import { beforeEach, describe, expect, it } from 'vitest'
import { ComponentStack } from '../src'
import { Template } from './assertions'
import {
  foggComponentToConfig,
  getDefaultComponentConfig,
  withDefaults,
} from './helpers/fogg'
import { synth, v5FoggStack } from './helpers/v5'

interface ParityOptions {
  props?: FoggStackProps
  v5Act?: (stack: FoggStack) => void
  act?: (stack: ComponentStack) => void
}

/**
 * Build both stacks, assert byte identical synth, return ComponentStack.
 */
function parity(component: Component, opts: ParityOptions = {}) {
  const { props = {} } = opts
  const v5 = v5FoggStack(component, props)
  opts.v5Act?.(v5)
  const stack = newStack(component, props)
  opts.act?.(stack)
  expect(synth(stack)).toBe(synth(v5))
  return stack
}

function newStack(component: Component, props: FoggStackProps = {}) {
  return new ComponentStack(Testing.app(), 'MyStack', {
    config: foggComponentToConfig(component, {
      forceRemoteStates: props.forceRemoteStates,
    }),
    defaultTags: props.defaultTags,
    ignoreTags: props.ignoreTags,
  })
}

let app: App
describe('ComponentStack (v5 FoggStack parity)', () => {
  beforeEach(() => {
    app = Testing.app()
  })

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
          s3: {
            bucket: 'bucket-1',
            key: 'fake-keypath',
            region: 'us-fake-1',
            encrypt: true,
          },
        },
      },
    })
  })

  it('renders backend assume_role, profile precedence', () => {
    parity(
      withDefaults({
        backend: { s3: { role_arn: 'arn:aws:iam::123456789012:role/r' } },
      }),
    )
    const stack = parity(
      withDefaults({
        backend: {
          s3: {
            role_arn: 'arn:aws:iam::123456789012:role/r',
            profile: 'my-profile',
            dynamo_table: 'locks',
          },
        },
      }),
    )
    Template.fromStack(stack).toMatchObject({
      terraform: {
        backend: {
          s3: { profile: 'my-profile', dynamodb_table: 'locks' },
        },
      },
    })
  })

  it('throws error on unsupported backend', () => {
    const component = withDefaults({
      backend: { kind: 'unknown' },
    })
    expect(() => v5FoggStack(component)).toThrow(
      /Unsupported backend configuration unknown/,
    )
    expect(() => newStack(component)).toThrow(
      /Unsupported backend configuration unknown/,
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

  it('creates remote states for filtered component backends', () => {
    const stack = parity(
      withDefaults({
        component_backends: {
          network: {
            kind: 's3',
            s3: {
              bucket: 'some-bucket',
              key_path: 'network.tfstate',
              region: 'us-west-2',
              role_arn: 'arn:aws:iam::123456789012:role/r',
            },
          },
          app: {
            kind: 's3',
            s3: { bucket: 'b', key_path: 'app', region: 'r', profile: 'p' },
          },
        },
        component_backends_filtered: true,
      }),
    )
    Template.fromStack(stack).toMatchObject({
      data: {
        terraform_remote_state: {
          network: {
            backend: 's3',
            config: {
              bucket: 'some-bucket',
              encrypt: true,
              assume_role: { role_arn: 'arn:aws:iam::123456789012:role/r' },
            },
          },
          app: { backend: 's3', config: { profile: 'p' } },
        },
      },
    })
  })

  describe('creates remote states if forceRemoteStates is true', () => {
    const component = () =>
      withDefaults({
        component_backends: {
          network: { kind: 's3', s3: { bucket: 'some-bucket' } },
        },
      })
    const props = { forceRemoteStates: true }
    function addOutput(
      stack: FoggStack | ComponentStack,
      outputName: string,
      value: any,
    ) {
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

    it('with strongly typed access to strange output names', () => {
      interface StrangeOutputs {
        'very-StrangeName': string
      }
      const stack = parity(component(), {
        props,
        v5Act: (s) =>
          addOutput(
            s,
            'strangeName',
            s.remoteState<StrangeOutputs>('network')['very-StrangeName'],
          ),
        act: (s) =>
          addOutput(
            s,
            'strangeName',
            s.remoteState<StrangeOutputs>('network')['very-StrangeName'],
          ),
      })
      Template.fromStack(stack).toMatchObject({
        output: {
          strangeName: {
            value:
              '${data.terraform_remote_state.network.outputs.very-StrangeName}',
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
          // unnamed module gets module_1, sourceless module is skipped
          { source: 'terraform-aws-modules/s3-bucket/aws' },
          { name: 'nosource' },
        ],
      }),
      {
        v5Act: (s) => s.setModuleVariables('network', networkInputs),
        act: (s) => s.setModuleVariables('network', networkInputs),
      },
    )
    expect(Object.keys(stack.modules)).toEqual(['network', 'module_1'])
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

  it('throws on duplicate module names', () => {
    const component = withDefaults({
      modules: [
        { name: 'a', source: 'terraform-aws-modules/vpc/aws' },
        { name: 'a', source: 'terraform-aws-modules/s3-bucket/aws' },
      ],
    })
    expect(() => v5FoggStack(component)).toThrow(/Module a already exists/)
    expect(() => newStack(component)).toThrow(/Module a already exists/)
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

  it('allows naming the main module', () => {
    const stack = parity(
      withDefaults({
        module_source: 'terraform/modules/foo',
        module_name: 'foo',
      }),
      {
        v5Act: (s) => s.setMainModuleVariables({ a: 1 }),
        act: (s) => s.setMainModuleVariables({ a: 1 }),
      },
    )
    expect(stack.modules.foo).toBeDefined()
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
    expect(stack.awsProvider('DefaultAwsProvider')).toBe(
      stack.defaultAwsProvider,
    )
    expect(stack.defaultAwsProvider.node.id).toBe('DefaultAwsProvider')
  })

  it('throws when no default Aws provider is configured', () => {
    const component = getDefaultComponentConfig()
    delete component.providers_configuration.aws
    const stack = parity(component)
    expect(() => stack.defaultAwsProvider).toThrow(
      /Default AWS Provider not defined/,
    )
  })

  it('exposes aliased providers', () => {
    const stack = parity(
      withDefaults({
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
      }),
    )
    expect(stack.awsProvider('shared_services').node.id).toBe('aws-0')
    Template.fromStack(stack).toMatchObject({
      provider: {
        aws: [
          {
            assume_role: [{ role_arn: 'arn:aws:iam::123456789012:role/role' }],
            region: 'us-west-2',
          },
          {
            alias: 'shared_services',
            assume_role: [{ role_arn: 'arn:aws:iam::210987654321:role/role' }],
            region: 'ap-southeast-1',
          },
        ],
      },
    })
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

  it('sets default tags with v5 precedence', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            default_tags: {
              enabled: true,
              tags: { zeta: 'z', project: 'from-config', alpha: 'a' },
            },
          },
        },
      }),
      { props: { defaultTags: { alpha: 'from-props', beta: 'b' } } },
    )
    const tags = JSON.parse(synth(stack)).provider.aws[0].default_tags[0].tags
    // cdktn sorts map keys at synth; precedence is what matters
    expect(tags).toEqual({
      env: 'test-env-1',
      owner: 'fake-owner',
      project: 'from-config',
      managedBy: 'terraform',
      service: 'fake-name',
      tfstateKey: 'fake-keypath',
      zeta: 'z',
      alpha: 'from-props',
      beta: 'b',
    })
  })

  it('merges the default provider tags into regional providers (v5 quirk)', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            default_tags: { enabled: true, tags: { team: 'core' } },
          },
          aws_regional_providers: [
            {
              account_id: '210987654321',
              alias: 'other',
              region: 'ap-southeast-1',
              // regional tags are ignored by v5
              default_tags: { enabled: true, tags: { ignored: 'yes' } },
              ignore_tags: { enabled: true, key_prefixes: ['kubernetes.io/'] },
            },
          ],
        },
      }),
      { props: { ignoreTags: { keys: ['x'] } } },
    )
    const aws = JSON.parse(synth(stack)).provider.aws
    expect(aws[1].default_tags[0].tags.team).toBe('core')
    expect(aws[1].default_tags[0].tags.ignored).toBeUndefined()
    expect(aws[1].ignore_tags).toEqual([
      { keys: ['x'], key_prefixes: ['kubernetes.io/'] },
    ])
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

  it('sets enabled-but-empty ignore tags', () => {
    parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            ignore_tags: { enabled: true },
          },
        },
      }),
    )
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

  it('uses profile over role_arn for providers', () => {
    const stack = parity(
      withDefaults({
        providers_configuration: {
          aws: {
            account_id: '123456789012',
            region: 'us-west-2',
            profile: 'p',
            role_arn: 'arn:aws:iam::123456789012:role/role',
          },
        },
      }),
    )
    const aws = JSON.parse(synth(stack)).provider.aws[0]
    expect(aws.profile).toBe('p')
    expect(aws.assume_role).toBeUndefined()
  })

  it('exposes component configuration values', () => {
    const stack = parity(getDefaultComponentConfig())
    expect(stack.config.identity.project).toBeDefined()
    expect(stack.config.identity.owner).toBeDefined()
    expect(stack.config.identity.env).toBeDefined()
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

  it('throws for unsupported generic providers', () => {
    const component = withDefaults({
      required_providers: {
        bar: {
          enabled: true,
          source: 'foo/bar',
          version: '~> 4.0',
          config: { api_token: 'bar' },
        },
      },
    })
    expect(() => v5FoggStack(component)).toThrow(
      /Unsupported provider foo\/bar/,
    )
    // the neutral config has no "generic provider" concept: the source adapter rejects it
    expect(() => foggComponentToConfig(component)).toThrow(
      /Unsupported provider foo\/bar/,
    )
  })

  it('accepts a ComponentConfigSource', () => {
    const config = foggComponentToConfig(getDefaultComponentConfig())
    let loads = 0
    const stack = new ComponentStack(app, 'MyStack', {
      source: {
        load: () => {
          loads++
          return config
        },
      },
    })
    expect(loads).toBe(1)
    expect(stack.config).toBe(config)
  })

  it('requires config or source', () => {
    expect(() => new ComponentStack(app, 'MyStack', {} as any)).toThrow(
      /needs either `config`/,
    )
  })
})
