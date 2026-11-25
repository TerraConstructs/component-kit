import { ComponentStack, type ComponentTagOptions } from '@tcons/component'
import type { Construct } from 'constructs'
import { type AtmosConfigOptions, atmosConfigSource } from './resolve'

export interface AtmosStackProps extends ComponentTagOptions {
  /**
   * Where to read the Atmos configuration from.
   * @default - atmos CLI from ATMOS_COMPONENT/ATMOS_STACK, else `.atmos-component.json`
   */
  readonly atmos?: AtmosConfigOptions
}

/**
 * A `ComponentStack` configured from Atmos: `atmos describe component`
 * when available, else the file written by the `generate` section.
 *
 * ```ts
 * const app = new App()
 * const stack = new AtmosStack(app, 'app')
 * ```
 */
export class AtmosStack extends ComponentStack {
  constructor(scope: Construct, id: string, props: AtmosStackProps = {}) {
    super(scope, id, {
      source: atmosConfigSource(props.atmos),
      defaultTags: props.defaultTags,
      ignoreTags: props.ignoreTags,
    })
  }
}
