import type { InferOutputSchema as V5InferOutputSchema } from '@vincenthsh/cdktf-fogg-helpers'
import { type IResolvable, TerraformOutput, Testing } from 'cdktn'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  type ComponentConfig,
  ComponentStack,
  type ListOutput,
  type MapOutput,
  outputKind,
} from '../src'
import { ComponentAwsStack } from '../src/aws'
import { fromLegacySchema, type InferOutputSchema } from '../src/legacy'
import { Template } from './assertions'
import { foggComponentToConfig, withDefaults } from './helpers/fogg'
import { synth, v5FoggStack } from './helpers/v5'

const component = () =>
  withDefaults({
    component_backends: {
      network: { kind: 's3', s3: { bucket: 'some-bucket' } },
    },
  })

function newStack(config?: ComponentConfig) {
  return new ComponentStack(Testing.app(), 'MyStack', {
    config:
      config ?? foggComponentToConfig(component(), { forceRemoteStates: true }),
  })
}

function addOutput(stack: any, outputName: string, value: any) {
  new TerraformOutput(stack, outputName, { value, staticId: true })
}

// --- the v5 test schema ----------------------------------------------------
const endpointTypes = ['apigw', 's3'] as const
type Endpoints = { [K in (typeof endpointTypes)[number]]: string }
interface InternalZone {
  name: string
  id: string
}
interface NetworkOutputs {
  vpc_id: string
  app_subnet_ids: ListOutput<string>
  internal_dns_zone: MapOutput<InternalZone>
  endpoints: MapOutput<Endpoints>
}
const networkOutputsSchema: InferOutputSchema<NetworkOutputs> = {
  vpc_id: 'string',
  app_subnet_ids: 'list',
  endpoints: 'map',
  internal_dns_zone: 'map',
}

// --- the same, in zod -------------------------------------------------------
const networkOutputs = z.object({
  vpc_id: z.string(),
  app_subnet_ids: z.array(z.string()),
  internal_dns_zone: z.object({ name: z.string(), id: z.string() }),
  endpoints: z.record(z.enum(endpointTypes), z.string()),
})

type Outputs = {
  vpc_id: string
  app_subnet_ids: ListOutput<string>
  internal_dns_zone: MapOutput<any, 'name' | 'id' | string, any>
  endpoints: MapOutput<any, 'apigw' | 's3' | string, any>
}

/** outputs that render identically on v5 5.0.0 and here */
function addComplexOutputs(outputs: Outputs, stack: any) {
  addOutput(stack, 'vpc_id', outputs.vpc_id)
  addOutput(stack, 'app_subnet1', outputs.app_subnet_ids.element(0))
  addOutput(stack, 'app_subnet2', outputs.app_subnet_ids.element(1))
  addOutput(stack, 'app_subnets', outputs.app_subnet_ids.token)
  addOutput(stack, 'internal_zone', outputs.internal_dns_zone.token)
  addOutput(stack, 'endpoint_na', outputs.endpoints.lookup('apigw', 'n/a'))
  addOutput(stack, 'endpoint_empty', outputs.endpoints.lookup('apigw', ''))
  addOutput(
    stack,
    'endpoint_apigw_domain',
    outputs.endpoints.lookupNested('apigw', 'domain'),
  )
}

const complexExpectation = {
  output: {
    vpc_id: { value: '${data.terraform_remote_state.network.outputs.vpc_id}' },
    app_subnet1: {
      value:
        '${element(data.terraform_remote_state.network.outputs.app_subnet_ids, 0)}',
    },
    app_subnet2: {
      value:
        '${element(data.terraform_remote_state.network.outputs.app_subnet_ids, 1)}',
    },
    endpoint_na: {
      value:
        '${lookup(data.terraform_remote_state.network.outputs.endpoints, "apigw", "n/a")}',
    },
    endpoint_empty: {
      value:
        '${lookup(data.terraform_remote_state.network.outputs.endpoints, "apigw", "")}',
    },
    endpoint_apigw_domain: {
      value:
        '${data.terraform_remote_state.network.outputs.endpoints.apigw.domain}',
    },
  },
}

describe('remoteState', () => {
  describe('v5 parity', () => {
    it('legacy schema renders byte identical to v5', () => {
      const v5 = v5FoggStack(component(), { forceRemoteStates: true })
      addComplexOutputs(
        v5.remoteState<NetworkOutputs>(
          'network',
          networkOutputsSchema as V5InferOutputSchema<NetworkOutputs>,
        ),
        v5,
      )
      const stack = newStack()
      const outputs = stack.remoteState(
        'network',
        fromLegacySchema<NetworkOutputs>(networkOutputsSchema),
      )
      expectTypeOf(outputs).toEqualTypeOf<NetworkOutputs>()
      addComplexOutputs(outputs, stack)
      expect(synth(stack)).toBe(synth(v5))
      Template.fromStack(stack).toMatchObject(complexExpectation)
    })

    it('zod schema renders identically to the legacy schema', () => {
      const legacy = newStack()
      addComplexOutputs(
        legacy.remoteState(
          'network',
          fromLegacySchema<NetworkOutputs>(networkOutputsSchema),
        ),
        legacy,
      )
      const stack = newStack()
      addComplexOutputs(stack.remoteState('network', networkOutputs), stack)
      expect(synth(stack)).toBe(synth(legacy))
    })

    it('lookup only renders a lookup() call when a default is passed (differs from published 5.0.0)', () => {
      // fogg HEAD (e00b179c, unreleased after 5.0.0) dropped the injected ''
      // default; 5.0.0 renders lookup(map, "apigw", "") for lookup('apigw').
      const v5 = v5FoggStack(component(), { forceRemoteStates: true })
      addOutput(
        v5,
        'endpoint_strict',
        v5
          .remoteState<NetworkOutputs>(
            'network',
            networkOutputsSchema as V5InferOutputSchema<NetworkOutputs>,
          )
          .endpoints.lookup('apigw'),
      )
      expect(JSON.parse(synth(v5)).output.endpoint_strict.value).toBe(
        '${lookup(data.terraform_remote_state.network.outputs.endpoints, "apigw", "")}',
      )

      const stack = newStack()
      const outputs = stack.remoteState('network', networkOutputs)
      addOutput(stack, 'endpoint_strict', outputs.endpoints.lookup('apigw'))
      addOutput(stack, 'zone_id', outputs.internal_dns_zone.lookup('id'))
      Template.fromStack(stack).toMatchObject({
        output: {
          endpoint_strict: {
            value:
              '${data.terraform_remote_state.network.outputs.endpoints.apigw}',
          },
          zone_id: {
            value:
              '${data.terraform_remote_state.network.outputs.internal_dns_zone.id}',
          },
        },
      })
    })

    it('without schema returns string tokens', () => {
      const stack = newStack()
      const outputs = stack.remoteState<{ vpc_id: string; count: number }>(
        'network',
      )
      expectTypeOf(outputs).toEqualTypeOf<{ vpc_id: string; count: string }>()
      addOutput(stack, 'vpc_id', outputs.vpc_id)
      Template.fromStack(stack).toMatchObject({
        output: {
          vpc_id: {
            value: '${data.terraform_remote_state.network.outputs.vpc_id}',
          },
        },
      })
    })
  })

  describe('zod schemas', () => {
    it('maps scalars to getString/getNumber/getBoolean', () => {
      const stack = newStack()
      const outputs = stack.remoteState(
        'network',
        z.object({
          name: z.string(),
          kind: z.enum(['a', 'b']),
          port: z.number(),
          enabled: z.boolean(),
          maybe: z.string().optional(),
          other: z.unknown(),
        }),
      )
      expectTypeOf(outputs.name).toEqualTypeOf<string>()
      expectTypeOf(outputs.kind).toEqualTypeOf<string>()
      expectTypeOf(outputs.port).toEqualTypeOf<number>()
      expectTypeOf(outputs.enabled).toEqualTypeOf<IResolvable>()
      expectTypeOf(outputs.maybe).toEqualTypeOf<string>()
      addOutput(stack, 'name', outputs.name)
      addOutput(stack, 'port', outputs.port)
      addOutput(stack, 'enabled', outputs.enabled)
      addOutput(stack, 'maybe', outputs.maybe)
      addOutput(stack, 'other', outputs.other)
      Template.fromStack(stack).toMatchObject({
        output: {
          name: {
            value: '${data.terraform_remote_state.network.outputs.name}',
          },
          port: {
            value: '${data.terraform_remote_state.network.outputs.port}',
          },
          enabled: {
            value: '${data.terraform_remote_state.network.outputs.enabled}',
          },
          maybe: {
            value: '${data.terraform_remote_state.network.outputs.maybe}',
          },
          other: {
            value: '${data.terraform_remote_state.network.outputs.other}',
          },
        },
      })
    })

    it('ARC: dynamic map keys from a const input array', () => {
      // production pattern (async-requests-common), without a separate interface
      const snsRequestTopics = ['transcode', 'thumbnail'] as const
      const arcFixedOutputs = z.object({
        queueArn: z.string(),
        workerCount: z.number(),
      })
      const arcStg1Outputs = z.object({
        ...arcFixedOutputs.shape,
        newJobRequestTopics: z.record(z.enum(snsRequestTopics), z.string()),
      })

      const stack = newStack(
        foggComponentToConfig(
          withDefaults({
            component_backends: {
              arc: { kind: 's3', s3: { bucket: 'b', key_path: 'arc' } },
            },
          }),
          { forceRemoteStates: true },
        ),
      )
      const arc = stack.remoteState('arc', arcStg1Outputs)
      expectTypeOf(arc.queueArn).toEqualTypeOf<string>()
      expectTypeOf(arc.newJobRequestTopics.lookup)
        .parameter(0)
        .toEqualTypeOf<'transcode' | 'thumbnail'>()
      // @ts-expect-error not one of the declared topics
      arc.newJobRequestTopics.lookup('nope')
      for (const topic of snsRequestTopics) {
        addOutput(stack, topic, arc.newJobRequestTopics.lookup(topic))
      }
      Template.fromStack(stack).toMatchObject({
        output: {
          transcode: {
            value:
              '${data.terraform_remote_state.arc.outputs.newJobRequestTopics.transcode}',
          },
          thumbnail: {
            value:
              '${data.terraform_remote_state.arc.outputs.newJobRequestTopics.thumbnail}',
          },
        },
      })
    })

    it('types lists and object maps', () => {
      const stack = newStack()
      const outputs = stack.remoteState('network', networkOutputs)
      expectTypeOf(outputs.app_subnet_ids).toEqualTypeOf<ListOutput<string>>()
      expectTypeOf(outputs.internal_dns_zone.lookup)
        .parameter(0)
        .toEqualTypeOf<'name' | 'id'>()
      expectTypeOf(outputs.endpoints.token).toEqualTypeOf<string>()
    })

    it('looks through wrappers', () => {
      expect(outputKind(z.array(z.string()).optional())).toBe('list')
      expect(outputKind(z.number().nullable().default(1))).toBe('number')
      expect(outputKind(z.string().transform((s) => s.length))).toBe('string')
      expect(outputKind(z.lazy(() => z.record(z.string(), z.string())))).toBe(
        'map',
      )
      expect(outputKind(z.literal('x'))).toBe('string')
      expect(outputKind(z.union([z.string(), z.number()]))).toBe('any')
    })

    it('rejects non-object schemas', () => {
      const stack = newStack()
      expect(() => stack.remoteState('network', z.string() as any)).toThrow(
        /must be a zod object/,
      )
    })

    it('works on ComponentAwsStack', () => {
      const stack = new ComponentAwsStack(Testing.app(), 'MyStack', {
        gridUUID: 'g123',
        config: foggComponentToConfig(component(), {
          forceRemoteStates: true,
        }),
      })
      addOutput(
        stack,
        'subnet',
        stack.remoteState('network', networkOutputs).app_subnet_ids.element(0),
      )
      Template.fromStack(stack).toMatchObject({
        output: {
          subnet: {
            value:
              '${element(data.terraform_remote_state.network.outputs.app_subnet_ids, 0)}',
          },
        },
      })
    })
  })

  describe('dependencies', () => {
    it('only allows declared dependencies, with a helpful error', () => {
      const stack = newStack()
      expect(() => stack.remoteState('db', networkOutputs)).toThrow(
        /Remote state db not found: "db" is not a declared dependency of component "fake-name". Declared dependencies: network./,
      )
    })

    it('explains when no dependencies are declared', () => {
      const stack = newStack(foggComponentToConfig(component()))
      expect(() => stack.remoteState('network')).toThrow(
        /declares no dependencies/,
      )
    })
  })

  describe('fromLegacySchema', () => {
    it('converts each v5 type', () => {
      const schema = fromLegacySchema<any>({
        s: 'string',
        n: 'number',
        b: 'boolean',
        l: 'list',
        m: 'map',
      })
      expect(
        Object.fromEntries(
          Object.entries(schema.shape).map(([k, v]) => [k, outputKind(v)]),
        ),
      ).toEqual({ s: 'string', n: 'number', b: 'boolean', l: 'list', m: 'map' })
    })

    it('rejects unknown types', () => {
      expect(() => fromLegacySchema<any>({ x: 'object' } as any)).toThrow(
        /Unsupported legacy output type "object" for output "x"/,
      )
    })
  })
})
