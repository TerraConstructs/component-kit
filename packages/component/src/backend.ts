import {
  DataTerraformRemoteState,
  DataTerraformRemoteStateS3,
  type DataTerraformRemoteStateS3Config,
  S3Backend,
  type S3BackendConfig,
} from 'cdktn'
import type { Construct } from 'constructs'
import type { Backend, S3Backend as S3BackendSpec } from './config'
import type { Mutable } from './util/types'

function unsupported(backend: Backend): never {
  throw new Error(
    `Unsupported backend configuration ${(backend as { type?: string })?.type}`,
  )
}

/**
 * Build the cdktn S3 backend config. Key order and the `profile` over
 * `assumeRole` precedence match cdktf-fogg-helpers v5 exactly.
 */
export function buildS3BackendConfig(s3: S3BackendSpec): S3BackendConfig {
  const c: Mutable<S3BackendConfig> = {
    bucket: s3.bucket,
    dynamodbTable: s3.dynamodbTable,
    key: s3.key,
    region: s3.region,
    encrypt: s3.encrypt ?? true,
  }
  if (s3.profile) {
    c.profile = s3.profile
  } else if (s3.roleArn) {
    c.assumeRole = { roleArn: s3.roleArn }
  }
  if (s3.useLockfile !== undefined) c.useLockfile = s3.useLockfile
  if (s3.workspaceKeyPrefix) c.workspaceKeyPrefix = s3.workspaceKeyPrefix
  return c
}

/**
 * Build the cdktn `terraform_remote_state` S3 config for a dependency.
 */
export function buildS3RemoteStateConfig(
  s3: S3BackendSpec,
): DataTerraformRemoteStateS3Config {
  const c: Mutable<DataTerraformRemoteStateS3Config> = {
    bucket: s3.bucket,
    dynamodbTable: s3.dynamodbTable,
    key: s3.key,
    region: s3.region,
    encrypt: s3.encrypt ?? true,
  }
  if (s3.profile) {
    c.profile = s3.profile
  } else if (s3.roleArn) {
    c.assumeRole = { roleArn: s3.roleArn }
  }
  if (s3.workspaceKeyPrefix) c.workspaceKeyPrefix = s3.workspaceKeyPrefix
  if (s3.workspace && s3.workspace !== 'default') c.workspace = s3.workspace
  return c
}

/**
 * Add the component's own state backend to `scope`.
 */
export function addBackend(scope: Construct, backend: Backend): void {
  switch (backend?.type) {
    case 's3':
      new S3Backend(scope, buildS3BackendConfig(backend))
      return
    default:
      unsupported(backend)
  }
}

/**
 * Add a `terraform_remote_state` data source with construct id `id`.
 */
export function addRemoteState(
  scope: Construct,
  id: string,
  backend: Backend,
): DataTerraformRemoteState {
  switch (backend?.type) {
    case 's3':
      return new DataTerraformRemoteStateS3(
        scope,
        id,
        buildS3RemoteStateConfig(backend),
      )
    default:
      unsupported(backend)
  }
}
