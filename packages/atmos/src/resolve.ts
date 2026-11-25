import * as fs from 'node:fs'
import type { ComponentConfig, ComponentConfigSource } from '@tcons/component'
import {
  AtmosNotFoundError,
  AtmosSource,
  type AtmosSourceOptions,
  resolveAtmosTarget,
} from './atmos-source'
import {
  atmosComponentFilePath,
  AtmosFileSource,
  DEFAULT_ATMOS_COMPONENT_FILE,
} from './file-source'

export interface AtmosConfigOptions extends AtmosSourceOptions {
  /**
   * Path of the file written by the `generate` section.
   * @default process.env.ATMOS_COMPONENT_FILE ?? '.atmos-component.json'
   */
  readonly file?: string
  /**
   * - `auto`: atmos CLI when component/stack are known and the binary
   *   exists, else the generated file
   * - `cli`: atmos CLI only
   * - `file`: generated file only
   *
   * @default 'auto'
   */
  readonly mode?: 'auto' | 'cli' | 'file'
}

/**
 * Pick the configuration source: AtmosSource, else AtmosFileSource,
 * else throw an error explaining both options.
 */
export function resolveAtmosConfig(
  options: AtmosConfigOptions = {},
): ComponentConfig {
  const mode = options.mode ?? 'auto'
  const tried: string[] = []

  if (mode !== 'file') {
    if (resolveAtmosTarget(options)) {
      try {
        return new AtmosSource(options).load()
      } catch (e) {
        if (!(e instanceof AtmosNotFoundError) || mode === 'cli') throw e
        tried.push(
          `- atmos CLI: ${e.message} (set ATMOS_BIN or the atmosBin option)`,
        )
      }
    } else {
      tried.push(
        '- atmos CLI: no component/stack (pass { component, stack } or set ATMOS_COMPONENT and ATMOS_STACK; Atmos hooks set them)',
      )
    }
  }

  if (mode !== 'cli') {
    const file = atmosComponentFilePath({ path: options.file })
    if (fs.existsSync(file)) {
      return new AtmosFileSource({
        path: file,
        identity: options.identity,
      }).load()
    }
    tried.push(
      `- generated file: ${file} does not exist (add the \`generate\` section for ${DEFAULT_ATMOS_COMPONENT_FILE} from the @tcons/atmos README and run \`atmos terraform generate files <component> -s <stack>\`)`,
    )
  }

  throw new Error(
    `No Atmos configuration found for this component. Tried:\n${tried.join('\n')}`,
  )
}

/**
 * A ComponentConfigSource that defers the choice to {@link resolveAtmosConfig}.
 */
export function atmosConfigSource(
  options: AtmosConfigOptions = {},
): ComponentConfigSource {
  return { load: () => resolveAtmosConfig(options) }
}
