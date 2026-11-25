import type { ComponentTagOptions } from '@tcons/component'
import { ComponentAwsStack } from '@tcons/component/aws'
import type { Construct } from 'constructs'
import type { AwsStackProps } from 'terraconstructs/lib/aws'
import type { AtmosStackProps } from '../atmos-stack'
import { atmosConfigSource } from '../resolve'

export type AtmosAwsStackProps = AtmosStackProps &
  ComponentTagOptions &
  Omit<AwsStackProps, 'providerConfig'>

/**
 * A terraconstructs `AwsStack` configured from Atmos (see `AtmosStack`).
 */
export class AtmosAwsStack extends ComponentAwsStack {
  constructor(scope: Construct, id: string, props: AtmosAwsStackProps = {}) {
    const { atmos, ...rest } = props
    super(scope, id, { ...rest, source: atmosConfigSource(atmos) })
  }
}
