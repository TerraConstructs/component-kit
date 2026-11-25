/**
 * The subset of `atmos describe component ... --query .` output (Atmos
 * 1.234.x) that the bridge reads. Also the shape of the JSON file written
 * by the `generate` section (plus `dependency_backends`).
 */
export interface AtmosComponentDescription {
  /** Atmos component instance name (e.g. `vpc/primary`). */
  readonly atmos_component?: string
  /** Terraform component (directory) name. */
  readonly component?: string
  readonly atmos_stack?: string
  readonly stack?: string
  /** Terraform workspace (`default` when workspaces are disabled). */
  readonly workspace?: string
  readonly vars?: Record<string, any>
  readonly settings?: Record<string, any>
  readonly backend_type?: string
  readonly backend?: Record<string, any>
  readonly remote_state_backend_type?: string
  readonly remote_state_backend?: Record<string, any>
  readonly providers?: Record<string, any>
  readonly dependencies?: {
    readonly components?: AtmosDependency[]
  }
}

/**
 * An entry of `dependencies.components`.
 */
export interface AtmosDependency {
  readonly component?: string
  /** Accepted as an alias of `component` (Atmos validates either). */
  readonly name?: string
  /** Stack of the dependency. Defaults to the dependent's stack. */
  readonly stack?: string
  /** Dependency kind; only terraform dependencies produce remote state. */
  readonly kind?: string
}

/**
 * The state backend of a dependency, resolved from its
 * `remote_state_backend` (or `backend`).
 */
export interface AtmosDependencyBackend {
  readonly backend_type?: string
  readonly backend?: Record<string, any>
  readonly workspace?: string
}

/**
 * The JSON document written by the `generate` section snippet (README).
 */
export interface AtmosComponentFile extends AtmosComponentDescription {
  readonly dependency_backends?: Record<string, AtmosDependencyBackend>
}
