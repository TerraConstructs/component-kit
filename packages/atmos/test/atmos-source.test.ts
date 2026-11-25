import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Testing } from 'cdktn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AtmosComponentDescription,
  type AtmosExec,
  AtmosNotFoundError,
  AtmosSource,
  AtmosStack,
  clearAtmosDescribeCache,
  resolveAtmosConfig,
} from '../src'

const backend = (key: string, role = 'arn:aws:iam::1:role/rw') => ({
  bucket: 'buck',
  key,
  region: 'us-west-2',
  encrypt: true,
  workspace_key_prefix: key,
  assume_role: { role_arn: role },
})

const descriptions: Record<string, AtmosComponentDescription> = {
  'app@dev': {
    atmos_component: 'app',
    atmos_stack: 'dev',
    workspace: 'default',
    vars: { name: 'app', namespace: 'proj', stage: 'dev' },
    backend_type: 's3',
    backend: backend('app'),
    providers: { aws: { region: 'us-west-2' } },
    dependencies: {
      components: [
        { component: 'network' },
        { component: 'shared', stack: 'prod' },
        { kind: 'file' } as any,
      ],
    },
  },
  'network@dev': {
    atmos_component: 'network',
    atmos_stack: 'dev',
    workspace: 'default',
    backend_type: 's3',
    backend: backend('network'),
    remote_state_backend_type: 's3',
    remote_state_backend: backend('network', 'arn:aws:iam::1:role/ro'),
  },
  'shared@prod': {
    atmos_component: 'shared',
    atmos_stack: 'prod',
    workspace: 'default',
    backend_type: 's3',
    backend: backend('shared'),
  },
}

function fakeExec(): AtmosExec & ReturnType<typeof vi.fn> {
  return vi.fn((_file: string, args: string[]) => {
    const desc = descriptions[`${args[2]}@${args[4]}`]
    if (!desc) {
      const err: any = new Error('exit 1')
      err.stderr = `component ${args[2]} not found in stack ${args[4]}`
      throw err
    }
    return JSON.stringify(desc)
  }) as any
}

describe('AtmosSource', () => {
  beforeEach(() => clearAtmosDescribeCache())
  afterEach(() => vi.unstubAllEnvs())

  it('runs describe component and resolves dependency backends', () => {
    const exec = fakeExec()
    const config = new AtmosSource({
      component: 'app',
      stack: 'dev',
      atmosBin: '/opt/atmos',
      cwd: '/repo',
      basePath: '/repo/base',
      cliConfigPath: '/repo/cfg',
      exec,
    }).load()

    expect(exec.mock.calls[0][0]).toBe('/opt/atmos')
    expect(exec.mock.calls[0][1]).toEqual([
      'describe',
      'component',
      'app',
      '-s',
      'dev',
      '--format',
      'json',
      '--provenance=false',
      '--query',
      '.',
    ])
    expect(exec.mock.calls[0][2].cwd).toBe('/repo')
    expect(exec.mock.calls[0][2].env.ATMOS_BASE_PATH).toBe('/repo/base')
    expect(exec.mock.calls[0][2].env.ATMOS_CLI_CONFIG_PATH).toBe('/repo/cfg')
    // dependency in another stack
    expect(exec.mock.calls.map((c: any[]) => `${c[1][2]}@${c[1][4]}`)).toEqual([
      'app@dev',
      'network@dev',
      'shared@prod',
    ])

    expect(config.identity).toEqual({
      name: 'app',
      env: 'dev',
      project: 'proj',
      owner: '',
    })
    // remote_state_backend wins over backend
    expect(config.dependencies?.network).toMatchObject({
      key: 'network',
      roleArn: 'arn:aws:iam::1:role/ro',
    })
    expect(config.dependencies?.shared).toMatchObject({
      key: 'shared',
      roleArn: 'arn:aws:iam::1:role/rw',
    })
    expect(Object.keys(config.dependencies!)).toEqual(['network', 'shared'])
  })

  it('reads component/stack from ATMOS_COMPONENT / ATMOS_STACK and caches per process', () => {
    vi.stubEnv('ATMOS_COMPONENT', 'app')
    vi.stubEnv('ATMOS_STACK', 'dev')
    const exec = fakeExec()
    new AtmosSource({ exec }).load()
    new AtmosSource({ exec }).load()
    expect(exec).toHaveBeenCalledTimes(3)
  })

  it('passes extra args', () => {
    const exec = fakeExec()
    new AtmosSource({
      component: 'network',
      stack: 'dev',
      extraArgs: ['--skip', 'terraform.output'],
      exec,
    }).describe('network', 'dev')
    expect(exec.mock.calls[0][1].slice(-2)).toEqual([
      '--skip',
      'terraform.output',
    ])
  })

  it('requires a target', () => {
    vi.stubEnv('ATMOS_COMPONENT', '')
    vi.stubEnv('ATMOS_STACK', '')
    expect(() => new AtmosSource({ exec: fakeExec() }).load()).toThrow(
      /needs a component and stack/,
    )
  })

  it('surfaces atmos stderr', () => {
    expect(() =>
      new AtmosSource({
        component: 'nope',
        stack: 'dev',
        exec: fakeExec(),
      }).load(),
    ).toThrow(/failed:\ncomponent nope not found in stack dev/)
  })

  it('reports a missing binary as AtmosNotFoundError', () => {
    expect(() =>
      new AtmosSource({
        component: 'app',
        stack: 'dev',
        atmosBin: path.join(os.tmpdir(), 'definitely-not-atmos'),
      }).load(),
    ).toThrow(AtmosNotFoundError)
  })
})

describe('resolveAtmosConfig', () => {
  let dir: string
  beforeEach(() => {
    clearAtmosDescribeCache()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atmos-file-'))
    vi.stubEnv('ATMOS_COMPONENT', '')
    vi.stubEnv('ATMOS_STACK', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const writeFile = () => {
    const file = path.join(dir, '.atmos-component.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...descriptions['app@dev'],
        dependencies: undefined,
        dependency_backends: {
          network: {
            backend_type: 's3',
            backend: backend('network'),
            workspace: 'default',
          },
        },
      }),
    )
    return file
  }

  it('prefers the CLI when a target is known', () => {
    const exec = fakeExec()
    const config = resolveAtmosConfig({
      component: 'app',
      stack: 'dev',
      file: writeFile(),
      exec,
    })
    expect(exec).toHaveBeenCalled()
    expect(Object.keys(config.dependencies!)).toEqual(['network', 'shared'])
  })

  it('falls back to the generated file when the binary is missing', () => {
    const config = resolveAtmosConfig({
      component: 'app',
      stack: 'dev',
      atmosBin: path.join(dir, 'no-atmos'),
      file: writeFile(),
    })
    expect(Object.keys(config.dependencies!)).toEqual(['network'])
  })

  it('falls back to the generated file without a target', () => {
    const config = resolveAtmosConfig({ file: writeFile() })
    expect(config.identity.name).toBe('app')
  })

  it('explains what was tried', () => {
    expect(() =>
      resolveAtmosConfig({ file: path.join(dir, 'missing.json') }),
    ).toThrow(
      /No Atmos configuration found[\s\S]*ATMOS_COMPONENT[\s\S]*missing.json does not exist/,
    )
  })

  it('mode cli does not fall back', () => {
    expect(() =>
      resolveAtmosConfig({
        component: 'app',
        stack: 'dev',
        atmosBin: path.join(dir, 'no-atmos'),
        file: writeFile(),
        mode: 'cli',
      }),
    ).toThrow(AtmosNotFoundError)
  })

  it('AtmosStack uses the resolution', () => {
    const stack = new AtmosStack(Testing.app(), 'app', {
      atmos: { file: writeFile() },
    })
    expect(stack.componentConfig.identity.name).toBe('app')
    expect(
      JSON.parse(Testing.synth(stack)).data.terraform_remote_state,
    ).toMatchObject({ network: { backend: 's3' } })
  })
})
