/**
 * Parity on the full v5 `.fogg-component.yaml` fixture
 * (v5 test/util/fixtures/.fogg-component.yaml): regional providers, default
 * tags, locals, modules and three component backends.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Component } from '@vincenthsh/cdktf-fogg-helpers'
import { Testing } from 'cdktn'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { ComponentStack } from '../src'
import { foggComponentToConfig } from './helpers/fogg'
import { synth, v5FoggStack } from './helpers/v5'

function nullToUndefined(obj: any): any {
  if (obj === null) return undefined
  if (Array.isArray(obj)) return obj.map(nullToUndefined)
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, nullToUndefined(v)]),
    )
  }
  return obj
}

const fixture = (): Component =>
  nullToUndefined(
    yaml.load(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'fogg-component.yaml'),
        'utf8',
      ),
    ),
  )

describe('full .fogg-component.yaml fixture', () => {
  for (const forceRemoteStates of [false, true]) {
    it(`synthesizes identically to v5 (forceRemoteStates=${forceRemoteStates})`, () => {
      const props = {
        forceRemoteStates,
        defaultTags: { purpose: 'parity' },
        ignoreTags: { keyPrefixes: ['kubernetes.io/'] },
      }
      const v5 = v5FoggStack(fixture(), props)
      const stack = new ComponentStack(Testing.app(), 'MyStack', {
        config: foggComponentToConfig(fixture(), { forceRemoteStates }),
        defaultTags: props.defaultTags,
        ignoreTags: props.ignoreTags,
      })
      const actual = synth(stack)
      expect(actual).toBe(synth(v5))
      expect(JSON.parse(actual)).toMatchSnapshot()
    })
  }

  it('keeps construct ids stable', () => {
    const stack = new ComponentStack(Testing.app(), 'MyStack', {
      config: foggComponentToConfig(fixture(), { forceRemoteStates: true }),
    })
    const ids = stack.node.children.map((c) => c.node.id)
    expect(ids).toEqual([
      'backend',
      'DefaultAwsProvider',
      'aws-0',
      'app',
      'lambda',
      'network',
      'foo_foo_foo',
      'vpc',
    ])
  })
})
