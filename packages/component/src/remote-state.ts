import { type DataTerraformRemoteState, Fn, type IResolvable } from 'cdktn'
import type { z } from 'zod'
import type { StringifiedRecord } from './util/types'

/**
 * A list output. Index with `element(i)` (renders `element(list, i)`),
 * or pass `token` around as a whole.
 */
export interface ListOutput<T = string> {
  /**
   * Returns a token that resolves to the element at `index`.
   */
  element(index: number): T

  /**
   * Returns the remote state token, use Fn.element to access elements.
   */
  readonly token: string[]
}

/**
 * A map (or object) output.
 *
 * T: interface representing the keys
 * V: the type of each map value
 */
export interface MapOutput<T, K extends keyof T = keyof T, V = string> {
  /**
   * Looks up the given key in the map. Without default this renders the
   * dotted path (a missing key fails the plan); with a default it renders
   * `lookup(map, key, default)`.
   */
  lookup(key: K, defaultValue?: V): V
  /**
   * Returns a property access expression for the given path, e.g.
   * lookupNested("a", "b") renders `map.a.b`.
   */
  lookupNested(...path: string[]): V

  /**
   * Returns the entire map as a Token.
   */
  readonly token: string
}

/**
 * The schema describing a dependency's outputs: a `z.object()` whose
 * properties are the output names.
 */
export type RemoteStateSchema = z.ZodObject<z.ZodRawShape>

declare const legacyOutputType: unique symbol

/**
 * A schema produced by `fromLegacySchema<T>()`: carries the v5 output type
 * `T` so `remoteState(name, schema)` returns `T` exactly as v5 did.
 */
export type LegacyRemoteStateSchema<T> = RemoteStateSchema & {
  readonly [legacyOutputType]: T
}

type Unwrap<S> =
  S extends z.ZodOptional<infer I>
    ? Unwrap<I>
    : S extends z.ZodNullable<infer I>
      ? Unwrap<I>
      : S extends z.ZodDefault<infer I>
        ? Unwrap<I>
        : S extends z.ZodReadonly<infer I>
          ? Unwrap<I>
          : S extends z.ZodPipe<infer I, any>
            ? Unwrap<I>
            : S

type StringLike =
  z.ZodString | z.ZodEnum<any> | z.ZodLiteral<any> | z.ZodTemplateLiteral<any>

/** Type of a single (leaf) value read from a remote state. */
type ScalarOutput<S> = S extends StringLike
  ? string
  : S extends z.ZodNumber
    ? number
    : S extends z.ZodBoolean
      ? IResolvable
      : any

type ShapeValue<Shape> = Shape[keyof Shape]

/**
 * The accessor type for one output schema:
 *
 * | zod                          | accessor                              |
 * | ---------------------------- | ------------------------------------- |
 * | `z.string()`/enum/literal    | `string` token (`getString`)          |
 * | `z.number()`                 | `number` token (`getNumber`)          |
 * | `z.boolean()`                | `IResolvable` (`getBoolean`)          |
 * | `z.array(x)`                 | {@link ListOutput}                    |
 * | `z.record(k, v)`/`z.object()`| {@link MapOutput} keyed by `k`/shape  |
 * | anything else                | `any` (`get`)                         |
 */
export type RemoteOutput<S> =
  Unwrap<S> extends infer U
    ? U extends StringLike
      ? string
      : U extends z.ZodNumber
        ? number
        : U extends z.ZodBoolean
          ? IResolvable
          : U extends z.ZodArray<infer E>
            ? ListOutput<ScalarOutput<Unwrap<E>>>
            : U extends z.ZodRecord<infer K, infer V>
              ? MapOutput<
                  Record<z.output<K> & PropertyKey, ScalarOutput<Unwrap<V>>>,
                  z.output<K> & PropertyKey,
                  ScalarOutput<Unwrap<V>>
                >
              : U extends z.ZodObject<infer Shape>
                ? MapOutput<
                    { [P in keyof Shape]: ScalarOutput<Unwrap<Shape[P]>> },
                    keyof Shape,
                    ScalarOutput<Unwrap<ShapeValue<Shape>>>
                  >
                : any
    : never

/**
 * The remote state accessor object for a schema.
 */
export type RemoteStateOutputs<S extends RemoteStateSchema> = {
  readonly [K in keyof S['shape']]: RemoteOutput<S['shape'][K]>
}

/**
 * The `remoteState()` overloads shared by every component stack.
 */
export interface IRemoteStateAccess {
  /**
   * Access the outputs of a declared dependency. Without schema every
   * property is a string token (`getString`), as in v5.
   *
   * @throws if `name` is not a declared dependency
   */
  remoteState<T = Record<string, string>>(name: string): StringifiedRecord<T>
  /**
   * Access the outputs of a declared dependency with a schema converted from
   * a v5 string schema (`@tcons/component/legacy`). Returns the v5 type.
   */
  remoteState<T>(name: string, schema: LegacyRemoteStateSchema<T>): T
  /**
   * Access the outputs of a declared dependency, typed and rendered per the
   * zod schema (see {@link RemoteOutput}).
   *
   * @throws if `name` is not a declared dependency
   */
  remoteState<S extends RemoteStateSchema>(
    name: string,
    schema: S,
  ): RemoteStateOutputs<S>
}

type OutputKind = 'string' | 'number' | 'boolean' | 'list' | 'map' | 'any'

interface ZodInternals {
  _zod?: { def?: Record<string, any> }
}

function defOf(schema: unknown): Record<string, any> | undefined {
  return (schema as ZodInternals)?._zod?.def
}

/**
 * Resolve the accessor kind of a zod (v4) schema from its definition.
 * Wrappers (optional, nullable, default, readonly, catch, pipe, lazy) are
 * looked through.
 */
export function outputKind(schema: unknown): OutputKind {
  let def = defOf(schema)
  for (let depth = 0; def && depth < 32; depth++) {
    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'readonly':
      case 'catch':
      case 'nonoptional':
        def = defOf(def.innerType)
        continue
      case 'pipe':
        def = defOf(def.in)
        continue
      case 'lazy':
        def = defOf(def.getter())
        continue
      case 'string':
      case 'enum':
      case 'literal':
      case 'template_literal':
        return 'string'
      case 'number':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'array':
      case 'tuple':
        return 'list'
      case 'record':
      case 'object':
        return 'map'
      default:
        return 'any'
    }
  }
  return 'any'
}

function shapeOf(schema: RemoteStateSchema): Record<string, unknown> {
  const def = defOf(schema)
  if (def?.type !== 'object') {
    throw new Error(
      'remoteState schema must be a zod object, e.g. z.object({ vpc_id: z.string() })',
    )
  }
  return def.shape as Record<string, unknown>
}

function accessor(
  data: DataTerraformRemoteState,
  prop: string,
  kind: OutputKind,
): unknown {
  switch (kind) {
    case 'string':
      return data.getString(prop)
    case 'number':
      return data.getNumber(prop)
    case 'boolean':
      return data.getBoolean(prop)
    case 'list': {
      const list: ListOutput<any> = {
        element: (index: number) => Fn.element(data.getList(prop), index),
        token: data.getList(prop),
      }
      return list
    }
    case 'map': {
      const map: MapOutput<any, any, any> = {
        lookup: (key: string, defaultValue?: unknown) =>
          Fn.lookup(data.get(prop), key, defaultValue),
        lookupNested: (...path: string[]) =>
          Fn.lookupNested(data.get(prop), path),
        token: data.getString(prop),
      }
      return map
    }
    default:
      return data.get(prop)
  }
}

/**
 * Create the remote state accessor proxy.
 *
 * Without schema every property returns `getString(property)`. With a
 * schema, declared properties get the accessor for their kind and
 * undeclared properties fall back to `get(property)` (v5 behaviour).
 */
export function remoteStateProxy<T>(
  data: DataTerraformRemoteState,
  schema?: RemoteStateSchema,
): T {
  const shape = schema ? shapeOf(schema) : undefined
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => {
      if (typeof prop !== 'string') return undefined
      if (!shape) return data.getString(prop)
      if (!Object.prototype.hasOwnProperty.call(shape, prop)) {
        return data.get(prop)
      }
      return accessor(data, prop, outputKind(shape[prop]))
    },
  }) as T
}
