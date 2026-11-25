# @tcons/component

Tool-neutral component wiring for cdk-terrain (cdktn) and TerraConstructs
stacks: S3 backend, AWS providers (default + regional), datadog/cloudflare,
typed `terraform_remote_state` for declared dependencies, locals and modules.

Extracted from `@vincenthsh/cdktf-fogg-helpers` v5 (`FoggStack` /
`FoggTerraStack`); for equivalent configuration the synthesized JSON is
byte-identical (see [Parity](#parity-with-cdktf-fogg-helpers-v5)).

```sh
pnpm add @tcons/component cdktn constructs @cdktn/provider-aws zod
# optional: terraconstructs (for /aws), @cdktn/provider-datadog, @cdktn/provider-cloudflare
```

## Stacks

```ts
import { App } from 'cdktn'
import { ComponentStack, type ComponentConfig } from '@tcons/component'

const config: ComponentConfig = {
  identity: {
    name: 'app',
    env: 'dev',
    project: 'proj',
    owner: 'team@example.com',
  },
  backend: {
    type: 's3',
    bucket: 'tfstate',
    key: 'proj/dev/app.tfstate',
    region: 'us-west-2',
    roleArn: 'arn:aws:iam::123456789012:role/tfstate',
  },
  providers: {
    aws: {
      region: 'us-west-2',
      roleArn: 'arn:aws:iam::123456789012:role/deploy',
      defaultTags: true,
    },
  },
  dependencies: {
    network: {
      type: 's3',
      bucket: 'tfstate',
      key: 'proj/dev/network.tfstate',
      region: 'us-west-2',
    },
  },
}

const app = new App()
const stack = new ComponentStack(app, 'app', {
  config,
  defaultTags: { purpose: 'demo' },
})
// or: new ComponentStack(app, 'app', { source: { load: () => config } })
```

`ComponentAwsStack` (from `@tcons/component/aws`) is the same on top of
terraconstructs' `AwsStack` (optional peer). The default provider is passed
as `providerConfig` and materialized eagerly so module-only components still
emit it. Regional providers are rejected there, as in v5.

Both delegate to `ComponentWiring`, which you can use from any stack class:

```ts
const wiring = wireComponent(this, config, {
  defaultTags,
  ignoreTags,
  defaultAwsProvider,
})
wiring.remoteState('network')
wiring.awsProvider('shared_services')
wiring.getLocal('x')
```

Stack API: `config`, `component` (the wiring), `modules`, `locals`, `region`,
`defaultAwsProvider`, `awsProvider(alias)`, `remoteState(...)`,
`setMainModuleVariables()`, `setModuleVariables()`, `getLocal()`.

## ComponentConfig

| Field                                                                                                                                                         | Rendered as                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `identity { name, env, project, owner }`                                                                                                                      | default tags `service`, `env`, `project`, `owner`         |
| `backend` (`{ type: 's3', bucket, key, region, dynamodbTable?, useLockfile?, profile?, roleArn?, encrypt? = true, workspaceKeyPrefix? }`)                     | `terraform.backend.s3`; `profile` wins over `assume_role` |
| `tags?`                                                                                                                                                       | merged into every provider's `default_tags`               |
| `providers.aws?` / `providers.awsRegional?[]` (`{ region, alias?, profile?, roleArn?, defaultTags?: boolean \| tags, ignoreTags?: { keys?, keyPrefixes? } }`) | `DefaultAwsProvider`, `aws-{i}`                           |
| `providers.datadog?` / `providers.cloudflare? { config }`                                                                                                     | `datadog`, `cloudflare` (config keys as overrides)        |
| `dependencies?: Record<name, Backend>` (`workspace?` for non-default workspaces)                                                                              | `data.terraform_remote_state.<name>`                      |
| `locals?: Record<name, hclExpression>`                                                                                                                        | `locals.<name> = "${expr}"`                               |
| `mainModule? { source, name? = 'main', version? }`, `modules?[] { name? = module_{i}, source?, version? }`                                                    | `module.<name>`                                           |
| `raw?`                                                                                                                                                        | the tool-specific source document (escape hatch)          |

Default tags merge, later wins: `env, owner, project, managedBy=terraform,
service, tfstateKey` → `tags` → provider-specific `defaultTags` record →
stack `defaultTags`. Stack `ignoreTags` are unioned with the provider's.

## Remote state with zod

Only declared `dependencies` can be read; anything else throws
`Remote state <name> not found: ... Declared dependencies: ...`.

```ts
import { z } from 'zod'

const outputs = stack.remoteState(
  'network',
  z.object({
    vpc_id: z.string(), // string    (getString)
    az_count: z.number(), // number    (getNumber)
    ipv6: z.boolean(), // IResolvable (getBoolean)
    subnet_ids: z.array(z.string()), // ListOutput  { element(i), token }
    zone: z.object({ id: z.string(), name: z.string() }), // MapOutput { lookup('id' | 'name'), lookupNested(), token }
  }),
)
outputs.subnet_ids.element(0) // ${element(...outputs.subnet_ids, 0)}
outputs.zone.lookup('id') // ${...outputs.zone.id}          (missing key fails the plan)
outputs.zone.lookup('id', '') // ${lookup(...outputs.zone, "id", "")}
```

Without a schema every property is a `getString` token
(`stack.remoteState<{ vpc_id: string }>('network').vpc_id`).

Map keys from a const array, with no separate interface:

```ts
const requestTopics = ['transcode', 'thumbnail'] as const
const queueBaseOutputs = z.object({ queueArn: z.string() })
export const jobQueueOutputs = z.object({
  ...queueBaseOutputs.shape,
  newJobRequestTopics: z.record(z.enum(requestTopics), z.string()),
})

const jobs = stack.remoteState('jobs', jobQueueOutputs)
jobs.newJobRequestTopics.lookup('transcode') // typed: 'transcode' | 'thumbnail'
```

Optional/nullable/default/readonly/pipe/lazy wrappers are looked through;
other types (unions, `z.any()`) use `get()`. Keys absent from the schema also
use `get()`, as in v5.

### v5 string schemas

```ts
import {
  fromLegacySchema,
  type InferOutputSchema,
  type ListOutput,
} from '@tcons/component/legacy'

interface NetworkOutputs {
  vpc_id: string
  subnet_ids: ListOutput<string>
}
const schema: InferOutputSchema<NetworkOutputs> = {
  vpc_id: 'string',
  subnet_ids: 'list',
}
const outputs = stack.remoteState(
  'network',
  fromLegacySchema<NetworkOutputs>(schema),
) // typed NetworkOutputs
```

`list` → `z.array(z.string())`, `map` → `z.record(z.string(), z.string())`.

## Parity with cdktf-fogg-helpers v5

The tests port v5's `FoggStack` / `FoggTerraStack` suites and compare
`Testing.synth()` output **byte for byte** against the published 5.0.0
package, plus the full v5 `.fogg-component.yaml` fixture. Construct ids
(`backend`, `DefaultAwsProvider`, `aws-{i}`, `datadog`, `cloudflare`,
dependency names, local names, module names), backend and remote state
config (`encrypt: true`, `assume_role { role_arn }`, profile precedence),
provider `assume_role` lists, tag merging and ignore-tag union all match.

One intentional difference: `MapOutput.lookup(key)` without a default
renders `map.key` (as fogg HEAD, commit e00b179c), while the published 5.0.0
renders `lookup(map, "key", "")`. Pass `''` explicitly to keep the old
expression.

Unlike v5, Datadog and Cloudflare providers are optional peers loaded on
demand, and v5's "module has no name" log line is not printed.

## License

MIT
