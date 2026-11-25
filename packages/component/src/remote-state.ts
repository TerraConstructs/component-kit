import type { DataTerraformRemoteState } from 'cdktn'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RemoteStateOptions {}

/**
 * Proxy over a remote state: every property access returns
 * `getString(property)` (the v5 default without schema).
 */
export function remoteStateProxy<T>(
  data: DataTerraformRemoteState,
  _options?: RemoteStateOptions,
): T {
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) =>
      typeof prop === 'string' ? data.getString(prop) : undefined,
  }) as T
}
