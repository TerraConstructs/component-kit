/**
 * Harness running the published cdktf-fogg-helpers 5.0.0 side by side with
 * this package, for byte level parity checks.
 *
 * v5 reads `.fogg-component.yaml` from the cwd, so the fixture is written to
 * a temp dir and the process chdir()s there while constructing the stack
 * (vitest runs this package with `pool: 'forks'`).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  type Component,
  FoggStack,
  type FoggStackProps,
  FoggTerraStack,
  type FoggTerraStackProps,
} from '@vincenthsh/cdktf-fogg-helpers'
import { type TerraformStack, Testing } from 'cdktn'
import * as yaml from 'js-yaml'

function withFoggComponentFile<T>(component: Component, fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fogg-v5-'))
  const prev = process.cwd()
  fs.writeFileSync(
    path.join(dir, '.fogg-component.yaml'),
    yaml.dump(component, { skipInvalid: true }),
  )
  try {
    process.chdir(dir)
    return fn()
  } finally {
    process.chdir(prev)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function v5FoggStack(
  component: Component,
  props: FoggStackProps = {},
  id = 'MyStack',
): FoggStack {
  return withFoggComponentFile(
    component,
    () => new FoggStack(Testing.app(), id, props),
  )
}

export function v5FoggTerraStack(
  component: Component,
  props: FoggTerraStackProps,
  id = 'MyStack',
): FoggTerraStack {
  return withFoggComponentFile(
    component,
    () => new FoggTerraStack(Testing.app(), id, props),
  )
}

/**
 * Synthesize a stack the same way v5's test `Template` helper does.
 */
export function synth(stack: TerraformStack): string {
  stack.prepareStack()
  return Testing.synth(stack)
}
