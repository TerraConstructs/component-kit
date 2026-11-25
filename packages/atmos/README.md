# @tcons/atmos

[Atmos](https://atmos.tools) bridge for
[`@tcons/component`](../component): cdktn / TerraConstructs stacks that read
their backend, providers and dependencies from Atmos stack configuration.

```sh
pnpm add @tcons/atmos @tcons/component cdktn constructs @cdktn/provider-aws zod
```

```ts
import { App } from 'cdktn'
import { AtmosStack } from '@tcons/atmos'
// import { AtmosAwsStack } from '@tcons/atmos/aws' // terraconstructs AwsStack

const app = new App()
const stack = new AtmosStack(app, 'app')
// explicit: new AtmosStack(app, 'app', { atmos: { component: 'app', stack: 'dev' } })
app.synth()
```

`AtmosStack` / `AtmosAwsStack` choose their source in this order:

1. **`AtmosSource`** when the component and stack are known (options, or
   `ATMOS_COMPONENT` / `ATMOS_STACK`, which Atmos hooks set) and the atmos
   binary runs.
2. **`AtmosFileSource`**: the JSON file written by the `generate` section
   (`.atmos-component.json` in the cwd, or `ATMOS_COMPONENT_FILE`).
3. Otherwise an error listing what was tried.

Force one with `atmos: { mode: 'cli' | 'file' }`. Both sources implement
`ComponentConfigSource`, so they also work with `ComponentStack` directly:

```ts
new ComponentStack(app, 'app', {
  source: new AtmosSource({ component: 'app', stack: 'dev' }),
})
```

## AtmosSource

Runs (with `execFileSync`, no shell):

```sh
atmos describe component <component> -s <stack> --format json --provenance=false --query .
```

`--query .` is needed: without it Atmos 1.234 prints a reduced document that
omits computed sections (`backend_type`, `remote_state_backend`,
`workspace`, `atmos_stack`). Each terraform dependency in
`dependencies.components` is described the same way to get its state
backend. Results are cached per process (`clearAtmosDescribeCache()`).

Options: `component`, `stack`, `atmosBin` (default `ATMOS_BIN` or `atmos`),
`cwd`, `basePath` (`ATMOS_BASE_PATH`), `cliConfigPath`
(`ATMOS_CLI_CONFIG_PATH`), `env`, `extraArgs` (e.g.
`['--skip', 'terraform.output']`), `identity` (overrides). A missing binary
raises `AtmosNotFoundError`; other failures include atmos' stderr.

## Mapping convention

| Atmos (describe output)                                                                                                        | ComponentConfig                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `backend_type: s3`, `backend.{bucket,key,region}`                                                                              | `backend` (other backend types throw)                                                                                           |
| `backend.assume_role.role_arn` (or legacy `role_arn`), `profile`, `dynamodb_table`, `use_lockfile`, `encrypt` (default `true`) | same fields; `profile` wins over the role                                                                                       |
| `backend.workspace_key_prefix` + `workspace`                                                                                   | kept only when `workspace` is not `default`                                                                                     |
| `vars.name` → `atmos_component`                                                                                                | `identity.name` (`service` tag)                                                                                                 |
| `vars.env` → `vars.stage` → `vars.environment`                                                                                 | `identity.env`                                                                                                                  |
| `vars.project` → `vars.namespace` → `vars.tenant`                                                                              | `identity.project`                                                                                                              |
| `vars.owner` → `vars.tags.owner`                                                                                               | `identity.owner`                                                                                                                |
| `vars.tags`                                                                                                                    | `tags` (merged into every AWS provider's default tags)                                                                          |
| `providers.aws` (object = default provider)                                                                                    | `providers.aws`: `region` (or `vars.region`), `alias`, `profile`, `assume_role.role_arn`                                        |
| `providers.aws.default_tags` present                                                                                           | identity default tags enabled; `default_tags.tags` added as provider tags                                                       |
| `providers.aws.ignore_tags.{keys,key_prefixes}`                                                                                | `ignoreTags`                                                                                                                    |
| `providers.aws` as a list                                                                                                      | first entry without `alias` is the default, the rest are `aws-{i}` (unverified, see below)                                      |
| `providers.datadog`, `providers.cloudflare`                                                                                    | `datadog {}`, `cloudflare` (keys passed through); any other provider throws                                                     |
| `dependencies.components[].component` (`.stack`, default: same stack)                                                          | `dependencies.<component>` = that component's `remote_state_backend_type`/`remote_state_backend`, else `backend_type`/`backend` |
| `settings.component_kit.locals`                                                                                                | `locals` (HCL expressions)                                                                                                      |
| `settings.component_kit.main_module` `{source, name?, version?}`                                                               | `mainModule`                                                                                                                    |
| `settings.component_kit.modules[]` `{name?, source, version?}`                                                                 | `modules`                                                                                                                       |

The resulting default tags are `env, owner, project, managedBy, service,
tfstateKey`, then `vars.tags`, then `providers.aws.default_tags.tags`, then the
stack's `defaultTags` prop.

### Migrating a fogg component

Pin the identity in `vars` and reuse fogg's state key, with workspaces
disabled, and the synthesized JSON equals what `FoggStack` produced (tested
in `test/integration.test.ts`):

```yaml
components:
  terraform:
    my-component:
      backend:
        s3:
          key: terraform/proj/envs/test/components/my-component.tfstate # fogg key_path
      vars:
        name: my-component
        env: test
        project: proj
        owner: team@example.com
      dependencies:
        components:
          - component: network
```

with `components.terraform.workspaces_enabled: false` in `atmos.yaml` (or the
`default` workspace), and the provider/backend role settings that fogg used.

## AtmosFileSource and the `generate` section

For environments without the atmos binary, let Atmos write the component's
configuration next to the cdktn app. Add this to a catalog file imported by
your stacks (or under a single component's `generate:`):

```yaml
terraform:
  generate:
    .atmos-component.json: |
      {
        "atmos_component": {{ toJson .atmos_component }},
        "atmos_stack": {{ toJson .atmos_stack }},
        "workspace": {{ toJson .workspace }},
        "vars": {{ toJson .vars }},
        "settings": {{ toJson .settings }},
        "backend_type": {{ toJson .backend_type }},
        "backend": {{ toJson .backend }},
        "providers": {{ toJson .providers }},
        "dependency_backends": {
        {{- range $i, $d := .dependencies.components }}{{ if $i }},{{ end }}
          {{ $c := atmos.Component $d.component (or $d.stack $.atmos_stack) }}{{ toJson $d.component }}: {
            "backend_type": {{ toJson (or $c.remote_state_backend_type $c.backend_type) }},
            "backend": {{ toJson (or $c.remote_state_backend $c.backend) }},
            "workspace": {{ toJson $c.workspace }}
          }
        {{- end }}
        }
      }
```

then `atmos terraform generate files <component> -s <stack>` (or `--all`).
The tests check that this file maps to exactly the same `ComponentConfig` as
`AtmosSource`.

## Verified vs assumed (Atmos 1.234.1)

Verified against the fixture project in `test/fixtures/atmos-project`:

- `describe component --query .` output contains `backend_type`, `backend`,
  `remote_state_backend(_type)` (already merged over `backend`),
  `workspace`, `vars`, `providers`, `settings`, `dependencies.components`.
- `workspace` is `default` when `workspaces_enabled: false`; otherwise the
  stack name or `metadata.terraform_workspace`.
- The `generate` template above renders at the `terraform:` level and
  `atmos.Component` resolves dependency backends without terraform or AWS
  access.
- `ATMOS_BASE_PATH` / `ATMOS_CLI_CONFIG_PATH` locate the project from another
  cwd.

Assumed, not verified:

- That Atmos hooks export `ATMOS_COMPONENT` / `ATMOS_STACK` to the process
  running `cdktn synth` (how Atmos invokes cdktn is outside this package).
- Cross-stack dependencies via `dependencies.components[].stack`, the `name`
  alias and `kind` filtering: tested with a stubbed atmos only.
- `providers.aws` as a list for aliased providers: Atmos passes provider
  sections through, but no stack config was tested.
- Using `atmos.Component` on dependencies whose stack config uses YAML
  functions such as `!terraform.output` will evaluate them (and may need
  credentials); pass `extraArgs: ['--skip', 'terraform.output']` to the CLI
  source if needed.
- With workspaces enabled, the runner must select the workspace; the
  backend block only carries `workspace_key_prefix`.

## License

MIT
