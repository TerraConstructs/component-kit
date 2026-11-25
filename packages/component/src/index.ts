export * from './config'
export {
  buildAwsProviderConfig,
  buildDefaultTags,
  type ComponentTagOptions,
  DEFAULT_AWS_PROVIDER_ID,
} from './aws-provider'
export {
  addBackend,
  addRemoteState,
  buildS3BackendConfig,
  buildS3RemoteStateConfig,
} from './backend'
export {
  ComponentWiring,
  type ComponentWiringOptions,
  type IComponentWiring,
  wireComponent,
} from './wiring'
export { ComponentStack, type ComponentStackProps } from './component-stack'
export type { StringifiedRecord } from './util/types'
export {
  type IRemoteStateAccess,
  type LegacyRemoteStateSchema,
  type ListOutput,
  type MapOutput,
  outputKind,
  type RemoteOutput,
  type RemoteStateOutputs,
  type RemoteStateSchema,
  remoteStateProxy,
} from './remote-state'
