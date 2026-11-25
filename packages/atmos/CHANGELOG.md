# Changelog

## [0.2.0](https://github.com/TerraConstructs/component-kit/compare/atmos-v0.1.0...atmos-v0.2.0) (2026-11-25)


### ⚠ BREAKING CHANGES

* `stack.config` is now `stack.componentConfig`, `stack.component` is now `stack.componentWiring`, and IComponentWiring.config is IComponentWiring.componentConfig (ComponentWiring keeps `config` and adds the `componentConfig` alias).

### Features

* keep stack wiring private behind componentConfig/componentWiring ([#4](https://github.com/TerraConstructs/component-kit/issues/4)) ([ccac552](https://github.com/TerraConstructs/component-kit/commit/ccac55296b6732b983061a44efe164aa09027675))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @tcons/component bumped to 0.2.0

## 0.1.0 (2026-11-25)


### Features

* **atmos:** Atmos bridge for @tcons/component ([4c5f1f2](https://github.com/TerraConstructs/component-kit/commit/4c5f1f24dcc686e38ea96e47a0701f8aaf85750c))


### Misc

* release main ([50a02b9](https://github.com/TerraConstructs/component-kit/commit/50a02b9ac6fa412c14ec85bdca6da4d6c8ed78ad))
* release main ([5bacf42](https://github.com/TerraConstructs/component-kit/commit/5bacf42424c1e7aec033a6d8a7df462bb792f554))
* roll back unpublished 1.0.0 release to start at 0.1.0 ([6d67394](https://github.com/TerraConstructs/component-kit/commit/6d67394bb0e15c36fbab2f465c1afb8d68c8b661))
* scaffold pnpm + turborepo workspace ([6fc2471](https://github.com/TerraConstructs/component-kit/commit/6fc247102a5c47df530ae5e5f8ed8e605190a406))


### Continuous Integration

* release-please and npm trusted publishing ([7a7f8e6](https://github.com/TerraConstructs/component-kit/commit/7a7f8e629e37e9bb28080cd4534b5f0b3c3cb802))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @tcons/component bumped to 0.1.0
