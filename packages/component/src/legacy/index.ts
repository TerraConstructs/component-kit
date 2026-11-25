/**
 * Bridge from the cdktf-fogg-helpers v5 string output schemas to zod.
 *
 * ```ts
 * import { fromLegacySchema, type InferOutputSchema } from '@tcons/component/legacy'
 * const outputs = stack.remoteState('network', fromLegacySchema<NetworkOutputs>(networkOutputsSchema))
 * ```
 */
import { z } from 'zod'
import type {
  LegacyRemoteStateSchema,
  ListOutput,
  MapOutput,
} from '../remote-state'

export type { ListOutput, MapOutput, LegacyRemoteStateSchema }

/** The v5 output type names. */
export type LegacyOutputType = 'string' | 'number' | 'boolean' | 'list' | 'map'

/**
 * Infer output schema from a given type T against user provided schema
 * (unchanged from cdktf-fogg-helpers v5).
 */
export type InferOutputSchema<T> = {
  [K in keyof T]: T[K] extends ListOutput<any>
    ? 'list'
    : T[K] extends MapOutput<any, any>
      ? 'map'
      : T[K] extends string
        ? 'string'
        : T[K] extends number
          ? 'number'
          : T[K] extends boolean
            ? 'boolean'
            : never
}

const toZod: Record<LegacyOutputType, () => z.ZodType> = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  list: () => z.array(z.string()),
  map: () => z.record(z.string(), z.string()),
}

/**
 * Convert a v5 output schema (`{ vpc_id: 'string', subnets: 'list' }`) into
 * the equivalent zod object. The result is branded with `T`, so
 * `remoteState(name, fromLegacySchema<T>(schema))` returns `T` like v5's
 * `remoteState<T>(name, schema)`. Rendered expressions are identical.
 *
 * @throws on unknown output types
 */
export function fromLegacySchema<T>(
  schema: InferOutputSchema<T>,
): LegacyRemoteStateSchema<T> {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, type] of Object.entries(schema as Record<string, string>)) {
    const make = toZod[type as LegacyOutputType]
    if (!make) {
      throw new Error(
        `Unsupported legacy output type "${type}" for output "${key}" (expected one of ${Object.keys(toZod).join(', ')})`,
      )
    }
    shape[key] = make()
  }
  return z.object(shape) as unknown as LegacyRemoteStateSchema<T>
}
