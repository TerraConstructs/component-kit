# component-kit

Tool-agnostic component wiring for [cdk-terrain (cdktn)](https://cdktn.io) and
[TerraConstructs](https://github.com/TerraConstructs/base) stacks.

A _component_ is one cdktn stack with one state file. Whatever tool owns the
configuration (fogg, Atmos, a test), the stack needs the same wiring: an S3
backend, AWS providers with `assume_role` / `default_tags` / `ignore_tags`,
`terraform_remote_state` for the components it depends on, locals and
modules. This repository extracts that wiring from
`@vincenthsh/cdktf-fogg-helpers` v5 behind a tool-neutral `ComponentConfig`,
keeping the synthesized JSON byte-identical so state addresses don't change.

| Package                                  | What it does                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@tcons/component`](packages/component) | `ComponentConfig`, `ComponentWiring`, `ComponentStack`, `ComponentAwsStack` (`/aws`), zod-typed `remoteState()`, `fromLegacySchema()` (`/legacy`) |
| [`@tcons/atmos`](packages/atmos)         | `AtmosSource` (`atmos describe component`), `AtmosFileSource` (Atmos `generate` file), `AtmosStack`, `AtmosAwsStack` (`/aws`)                     |

```ts
import { App } from 'cdktn'
import { AtmosStack } from '@tcons/atmos'
import { z } from 'zod'

const app = new App()
const stack = new AtmosStack(app, 'app') // ATMOS_COMPONENT / ATMOS_STACK
const network = stack.remoteState(
  'network',
  z.object({ vpc_id: z.string(), private_subnet_ids: z.array(z.string()) }),
)
network.private_subnet_ids.element(0) // ${element(data.terraform_remote_state.network.outputs.private_subnet_ids, 0)}
app.synth()
```

## Migration path

1. fogg writes `.fogg-component.yaml`; the component uses `FoggStack` (fogg-helpers).
2. Atmos `generate` writes the same file; fogg-helpers (v6, built on
   `@tcons/component`) is unchanged.
3. The component switches its import to `@tcons/atmos`, which calls
   `atmos describe component`.

## Development

Requires node >= 22.23.4 and pnpm 11 (via corepack). The Atmos integration
tests need `atmos` (tested with 1.234.1) on `PATH` or in `ATMOS_BIN`, and skip
otherwise.

```sh
mise exec node@24.11.1 atmos@1.234.1 -- corepack pnpm install
mise exec node@24.11.1 atmos@1.234.1 -- corepack pnpm turbo build test lint type-check
```

## License

MIT
