# Contributing to Thane

Thanks for your interest in contributing! This guide covers everything you need.

## Quick Links

| Guide | Description |
|:------|:------------|
| [Setup](setup.md) | Prerequisites, clone, install, and build |
| [Testing](testing.md) | Unit tests, E2E browser tests, formatting |
| [Architecture](architecture.md) | Project structure, compiler/runtime overview |
| [Contracts](contracts.md) | Compiler ↔ runtime contract policy and workflow |

## Development Workflow

1. Create a feature branch from `master`.
2. Make your changes.
3. Ensure all tests pass (`bun run test` and `bun run e2e:test`).
4. Ensure code is formatted (`bun run format:check`).
5. Open a pull request against `master`.

## Reporting Issues

Use the [GitHub issue tracker](https://github.com/timlouw/thane/issues) to report bugs or request features. Include reproduction steps and the Thane version when filing bugs.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
