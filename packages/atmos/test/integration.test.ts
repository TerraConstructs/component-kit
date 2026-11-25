/**
 * Integration tests against the fixture Atmos project. They need the atmos
 * binary (ATMOS_BIN or `atmos` on PATH, tested with 1.234.1) and skip
 * cleanly without it. No AWS access is needed.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FoggStack } from '@vincenthsh/cdktf-fogg-helpers'
import { ComponentStack } from '@tcons/component'
import { type TerraformStack, Testing } from 'cdktn'
import * as yaml from 'js-yaml'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AtmosFileSource,
  AtmosSource,
  AtmosStack,
  clearAtmosDescribeCache,
} from '../src'
import { AtmosAwsStack } from '../src/aws'

const FIXTURE = path.join(__dirname, 'fixtures', 'atmos-project')
const ATMOS_BIN = process.env.ATMOS_BIN ?? 'atmos'
const env = { ATMOS_TELEMETRY_ENABLED: 'false' }

const atmosAvailable =
  spawnSync(ATMOS_BIN, ['version'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  }).status === 0

function synth(stack: TerraformStack): string {
  stack.prepareStack()
  return Testing.synth(stack)
}

describe.skipIf(!atmosAvailable)('atmos integration', () => {
  const source = (component: string, extra = {}) =>
    new AtmosSource({
      component,
      stack: 'dev',
      atmosBin: ATMOS_BIN,
      cwd: FIXTURE,
      env,
      ...extra,
    })

  beforeEach(() => clearAtmosDescribeCache())

  it('maps the fixture component', () => {
    const config = source('app').load()
    const { raw, ...rest } = config
    expect(raw).toBeDefined()
    expect(rest).toEqual({
      identity: {
        name: 'app',
        env: 'dev',
        project: 'proj',
        owner: 'foo@example.com',
      },
      backend: {
        type: 's3',
        bucket: 'buck',
        key: 'terraform/proj/envs/dev/components/app.tfstate',
        region: 'us-west-2',
        roleArn: 'arn:aws:iam::123456789012:role/role',
        encrypt: true,
      },
      tags: { owner: 'foo@example.com', team: 'platform' },
      providers: {
        aws: {
          region: 'us-west-2',
          roleArn: 'arn:aws:iam::123456789012:role/role',
          defaultTags: { tier: 'web' },
          ignoreTags: { keyPrefixes: ['kubernetes.io/'] },
        },
        datadog: {},
      },
      dependencies: {
        network: {
          type: 's3',
          bucket: 'buck',
          key: 'terraform/proj/envs/dev/components/network.tfstate',
          region: 'us-west-2',
          roleArn: 'arn:aws:iam::123456789012:role/role',
          encrypt: true,
        },
        db: {
          type: 's3',
          bucket: 'buck',
          key: 'terraform/proj/envs/dev/components/db.tfstate',
          region: 'us-west-2',
          // from remote_state_backend
          roleArn: 'arn:aws:iam::123456789012:role/reader',
          encrypt: true,
        },
      },
      locals: { app_config: 'yamldecode(file("config.yaml"))' },
      mainModule: {
        source: 'terraform-aws-modules/lambda/aws',
        version: '7.0.0',
      },
      modules: [
        {
          name: 'bucket',
          source: 'terraform-aws-modules/s3-bucket/aws',
          version: '4.1.0',
        },
      ],
    })
  })

  it('honours ATMOS_BASE_PATH / ATMOS_CLI_CONFIG_PATH', () => {
    const config = source('network', {
      cwd: os.tmpdir(),
      basePath: FIXTURE,
      cliConfigPath: FIXTURE,
    }).load()
    expect(config.identity.name).toBe('network')
  })

  it('AtmosStack synthesizes from ATMOS_COMPONENT / ATMOS_STACK', () => {
    const prev = { ...process.env }
    Object.assign(process.env, {
      ATMOS_COMPONENT: 'app',
      ATMOS_STACK: 'dev',
      ATMOS_BIN,
      ATMOS_CLI_CONFIG_PATH: FIXTURE,
      ATMOS_BASE_PATH: FIXTURE,
      ...env,
    })
    try {
      const stack = new AtmosStack(Testing.app(), 'app')
      expect(JSON.parse(synth(stack))).toMatchSnapshot()
    } finally {
      process.env = prev
    }
  })

  it('AtmosAwsStack synthesizes', () => {
    const stack = new AtmosAwsStack(Testing.app(), 'network', {
      gridUUID: 'g123',
      atmos: {
        component: 'network',
        stack: 'dev',
        atmosBin: ATMOS_BIN,
        cwd: FIXTURE,
        env,
      },
    })
    const json = JSON.parse(synth(stack))
    expect(json.provider.aws[0]).toMatchObject({
      region: 'us-west-2',
      assume_role: [{ role_arn: 'arn:aws:iam::123456789012:role/role' }],
      default_tags: [{ tags: { service: 'network', env: 'dev' } }],
    })
  })

  describe('generate section + AtmosFileSource', () => {
    let tmp: string
    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atmos-project-'))
      fs.cpSync(FIXTURE, tmp, { recursive: true })
    })
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it('the generated file maps to the same config as the CLI', () => {
      for (const component of ['app', 'network', 'migrated']) {
        const res = spawnSync(
          ATMOS_BIN,
          ['terraform', 'generate', 'files', component, '-s', 'dev'],
          { cwd: tmp, env: { ...process.env, ...env }, encoding: 'utf8' },
        )
        expect(res.status, res.stderr).toBe(0)
        const file = path.join(
          tmp,
          'components',
          'terraform',
          component,
          '.atmos-component.json',
        )
        const fromFile = new AtmosFileSource({ path: file }).load()
        const fromCli = source(component, { cwd: tmp }).load()
        expect({ ...fromFile, raw: undefined }).toEqual({
          ...fromCli,
          raw: undefined,
        })
      }
    })
  })

  it('a migrated component synthesizes byte-identical to cdktf-fogg-helpers v5', () => {
    // what fogg wrote for the component before the migration
    const foggComponent = {
      backend: {
        kind: 's3',
        s3: {
          account_name: '',
          bucket: 'buck',
          key_path: 'terraform/proj/envs/test/components/migrated.tfstate',
          region: 'us-west-2',
          role_arn: 'arn:aws:iam::123456789012:role/role',
        },
      },
      component_backends: {
        network: {
          kind: 's3',
          s3: {
            account_name: '',
            bucket: 'buck',
            key_path: 'terraform/proj/envs/dev/components/network.tfstate',
            region: 'us-west-2',
            role_arn: 'arn:aws:iam::123456789012:role/role',
          },
        },
      },
      component_backends_filtered: true,
      env: 'test',
      name: 'migrated',
      owner: 'foo@example.com',
      project: 'proj',
      providers_configuration: {
        aws: {
          account_id: '123456789012',
          region: 'us-west-2',
          role_arn: 'arn:aws:iam::123456789012:role/role',
          default_tags: { enabled: true },
        },
        aws_regional_providers: [],
      },
      required_providers: {},
      locals_block: {},
      modules: [],
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fogg-v5-'))
    const cwd = process.cwd()
    let v5: FoggStack
    try {
      fs.writeFileSync(
        path.join(dir, '.fogg-component.yaml'),
        yaml.dump(foggComponent),
      )
      process.chdir(dir)
      v5 = new FoggStack(Testing.app(), 'migrated')
    } finally {
      process.chdir(cwd)
      fs.rmSync(dir, { recursive: true, force: true })
    }

    const stack = new ComponentStack(Testing.app(), 'migrated', {
      source: source('migrated'),
    })
    expect(synth(stack)).toBe(synth(v5))
  })
})
