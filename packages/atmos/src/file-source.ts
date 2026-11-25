import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  ComponentConfig,
  ComponentConfigSource,
  ComponentIdentity,
} from '@tcons/component'
import { mapAtmosComponent } from './mapping'
import type { AtmosComponentFile } from './types'

/** Default file name written by the `generate` section (see README). */
export const DEFAULT_ATMOS_COMPONENT_FILE = '.atmos-component.json'

export interface AtmosFileSourceOptions {
  /**
   * Path of the generated JSON file.
   * @default process.env.ATMOS_COMPONENT_FILE ?? '.atmos-component.json' (cwd)
   */
  readonly path?: string
  /**
   * Override (parts of) the identity derived from `vars`.
   */
  readonly identity?: Partial<ComponentIdentity>
}

/** Resolve the generated file path from options / env / default. */
export function atmosComponentFilePath(
  options: Pick<AtmosFileSourceOptions, 'path'> = {},
): string {
  return path.resolve(
    options.path ??
      process.env.ATMOS_COMPONENT_FILE ??
      DEFAULT_ATMOS_COMPONENT_FILE,
  )
}

/**
 * Loads the component configuration from the JSON file that Atmos writes
 * through the `generate` section (`atmos terraform generate files`), for
 * environments without the atmos binary.
 */
export class AtmosFileSource implements ComponentConfigSource {
  constructor(private readonly options: AtmosFileSourceOptions = {}) {}

  public get path(): string {
    return atmosComponentFilePath(this.options)
  }

  public load(): ComponentConfig {
    const file = this.path
    let doc: AtmosComponentFile
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      throw new Error(`Could not read the Atmos component file ${file}`, {
        cause: e,
      })
    }
    return mapAtmosComponent(doc, doc.dependency_backends ?? {}, {
      identity: this.options.identity,
    })
  }
}
