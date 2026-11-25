import { describe, expect, it } from 'vitest'
import {
  type AtmosComponentDescription,
  mapAtmosBackend,
  mapAtmosComponent,
  mapIdentity,
} from '../src'

const s3 = {
  bucket: 'buck',
  key: 'app.tfstate',
  region: 'us-west-2',
  encrypt: true,
  workspace_key_prefix: 'app',
  assume_role: { role_arn: 'arn:aws:iam::123456789012:role/role' },
}

const base: AtmosComponentDescription = {
  atmos_component: 'app',
  atmos_stack: 'dev',
  workspace: 'default',
  vars: { name: 'app', namespace: 'proj', stage: 'dev', tags: { owner: 'me' } },
  backend_type: 's3',
  backend: s3,
  providers: { aws: { region: 'us-west-2' } },
}

describe('mapIdentity', () => {
  it('derives identity from namespace/stage/name/tags.owner', () => {
    expect(mapIdentity(base)).toEqual({
      name: 'app',
      env: 'dev',
      project: 'proj',
      owner: 'me',
    })
  })

  it('prefers explicit env/project/owner vars (fogg migration)', () => {
    expect(
      mapIdentity({
        ...base,
        vars: {
          ...base.vars,
          env: 'test',
          project: 'p',
          owner: 'o',
          environment: 'ue2',
        },
      }),
    ).toEqual({ name: 'app', env: 'test', project: 'p', owner: 'o' })
  })

  it('falls back to environment/tenant/component name', () => {
    expect(
      mapIdentity({
        atmos_component: 'vpc/primary',
        vars: { environment: 'ue2', tenant: 'core' },
      }),
    ).toEqual({ name: 'vpc/primary', env: 'ue2', project: 'core', owner: '' })
  })

  it('applies overrides', () => {
    expect(mapIdentity(base, { owner: 'x' }).owner).toBe('x')
  })
})

describe('mapAtmosBackend', () => {
  it('maps s3, dropping workspace_key_prefix for the default workspace', () => {
    expect(mapAtmosBackend('s3', s3, 'default', 'app')).toEqual({
      type: 's3',
      bucket: 'buck',
      key: 'app.tfstate',
      region: 'us-west-2',
      roleArn: 'arn:aws:iam::123456789012:role/role',
      encrypt: true,
    })
  })

  it('keeps workspace settings for non-default workspaces', () => {
    expect(mapAtmosBackend('s3', s3, 'dev', 'app')).toMatchObject({
      workspaceKeyPrefix: 'app',
      workspace: 'dev',
    })
  })

  it('maps legacy role_arn, profile, dynamodb_table, use_lockfile, encrypt', () => {
    expect(
      mapAtmosBackend(
        's3',
        {
          bucket: 'b',
          key: 'k',
          region: 'r',
          role_arn: 'arn:role',
          profile: 'p',
          dynamodb_table: 'locks',
          use_lockfile: true,
          encrypt: false,
        },
        undefined,
        'x',
      ),
    ).toMatchObject({
      roleArn: 'arn:role',
      profile: 'p',
      dynamodbTable: 'locks',
      useLockfile: true,
      encrypt: false,
    })
  })

  it('rejects other backend types and incomplete s3 config', () => {
    expect(() => mapAtmosBackend('remote', {}, undefined, 'app')).toThrow(
      /Unsupported Atmos backend_type "remote" for app/,
    )
    expect(() =>
      mapAtmosBackend('s3', { bucket: 'b', region: 'r' }, undefined, 'app'),
    ).toThrow(/has no "key"/)
  })
})

describe('mapAtmosComponent', () => {
  it('maps providers', () => {
    const config = mapAtmosComponent(
      {
        ...base,
        vars: { ...base.vars, region: 'eu-west-1' },
        providers: {
          aws: [
            {
              assume_role: { role_arn: 'arn:default' },
              default_tags: { tags: { tier: 'web', n: 1 } },
              ignore_tags: { keys: ['a'], key_prefixes: ['b/'] },
            },
            { alias: 'use1', region: 'us-east-1', default_tags: {} },
          ],
          datadog: {},
          cloudflare: { api_token: 't' },
        },
      },
      {},
    )
    expect(config.providers).toEqual({
      aws: {
        region: 'eu-west-1',
        roleArn: 'arn:default',
        defaultTags: { tier: 'web', n: '1' },
        ignoreTags: { keys: ['a'], keyPrefixes: ['b/'] },
      },
      awsRegional: [{ region: 'us-east-1', alias: 'use1', defaultTags: true }],
      datadog: {},
      cloudflare: { config: { api_token: 't' } },
    })
  })

  it('rejects unsupported providers and providers without region', () => {
    expect(() =>
      mapAtmosComponent({ ...base, providers: { kubernetes: {} } }, {}),
    ).toThrow(/Unsupported provider "kubernetes".*app \(stack dev\)/)
    expect(() =>
      mapAtmosComponent({ ...base, providers: { aws: {} } }, {}),
    ).toThrow(/has no region/)
  })

  it('maps tags, dependencies and component_kit settings', () => {
    const config = mapAtmosComponent(
      {
        ...base,
        settings: {
          component_kit: {
            locals: { cfg: 'yamldecode(file("c.yaml"))' },
            main_module: { source: 'm/a/b', name: 'svc' },
            modules: [{ name: 'x', source: 'x/y/z', version: '1.0.0' }],
          },
        },
      },
      {
        network: { backend_type: 's3', backend: { ...s3, key: 'n' } },
      },
    )
    expect(config.tags).toEqual({ owner: 'me' })
    expect(config.dependencies).toEqual({
      network: {
        type: 's3',
        bucket: 'buck',
        key: 'n',
        region: 'us-west-2',
        roleArn: 'arn:aws:iam::123456789012:role/role',
        encrypt: true,
      },
    })
    expect(config.locals).toEqual({ cfg: 'yamldecode(file("c.yaml"))' })
    expect(config.mainModule).toEqual({ source: 'm/a/b', name: 'svc' })
    expect(config.modules).toEqual([
      { name: 'x', source: 'x/y/z', version: '1.0.0' },
    ])
    expect(config.raw).toBeDefined()
  })
})
