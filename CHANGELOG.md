# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-02-03

### Added

- Initial release
- Core runtime with signals, components, and DOM binding
- CLI build tool (`thane build`, `thane dev`, `thane serve`)
- Compiler pipeline with multiple optimization plugins:
  - Component precompiler
  - CSS file inliner
  - Dead code eliminator
  - Global CSS bundler
  - HTML bootstrap injector
  - Minification (selector, template)
  - Reactive binding compiler
  - Routes precompiler
  - TypeScript type checker
- `html` and `css` tagged template literals
- `repeat()`, `when()`, and `whenElse()` directives
- Router support with `navigate()`, `navigateBack()`, and `routeParam()`
