# Security Policy

Thane is a compile-time component framework. Its security surface is the published `thane` package: the runtime that ships in your application, the compiler and CLI that run on your machine, the development server, and the TypeScript plugin. This document says how to report a vulnerability in any of them, what to expect after you do, and what the framework does and does not guarantee.

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion for a security bug.

Report it privately through one of these channels:

1. **GitHub private vulnerability reporting** (preferred): open the [Security tab](https://github.com/timlouw/thane/security) of this repository and choose **Report a vulnerability**. This creates a private advisory that only you and the maintainer can see.
2. **Email**: tim@cybernyte.com. If you need to encrypt the report, say so in a first message and a key will be sent back.

Include as much of the following as you can:

- The affected version of `thane` (from `package.json` or `bun pm ls thane`) and whether `master` is also affected.
- The component: runtime (`thane`, `thane/runtime`, `thane/router`, `thane/runtime/dom`), compiler or CLI (`thane build`, `thane dev`, `thane typecheck`), development server or hot-update channel, or the TypeScript plugin (`thane/ts-plugin`).
- A minimal reproduction: the smallest component, template, route table or CLI invocation that triggers the problem, and the compiled output if the bug is in generated code.
- The impact as you understand it: what an attacker can do, and what they need (a crafted template in the application, a malicious dependency, a page the developer visits, a request to the dev server).
- Your environment: Bun version, operating system, and browser and version for runtime issues.
- A suggested fix, if you have one.

Reports in English are easiest to act on, but any language is fine.

## What to expect

| Step | Target |
| --- | --- |
| Acknowledgement that the report was received | Within 3 business days |
| Triage: confirmed or not, severity, and whether a fix is planned | Within 7 business days |
| Fix released for a confirmed High or Critical issue | Within 30 days of triage |
| Fix released for a confirmed Medium or Low issue | Within 90 days of triage |
| Public disclosure | When the fix is published, or 90 days after triage, whichever comes first |

Severity follows [CVSS 3.1](https://www.first.org/cvss/v3.1/specification-document). Disclosure timelines can be extended by agreement when a fix is complex or affects downstream packages, and shortened when an issue is already being exploited.

For every confirmed vulnerability in a published version, a GitHub Security Advisory is published in this repository, a CVE is requested through GitHub, and the fix is noted in [CHANGELOG.md](CHANGELOG.md). Reporters are credited in the advisory unless they ask not to be.

## Supported versions

Thane is pre-1.0. Security fixes are released on the latest published minor version on npm and on `master`. Earlier releases are not patched.

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| Earlier than 0.2.0 | No, upgrade |

Because compiled output is a contract between a compiler version and the runtime it ships with, a fix in generated code requires rebuilding the application with the fixed version. A library that ships pre-compiled Thane components must be rebuilt and republished too.

## Scope

### In scope

Anything that lets an attacker do something the documentation says they cannot, in code that Thane ships or generates:

- **Runtime and compiled output.** Untrusted data bound in a template reaching the DOM as markup rather than text; attribute, style or event bindings that can be made to execute script; prototype pollution through signals, props, stores or route parameters; escapes from the keyed reconciler or `when()` / `whenElse()` / `repeat()` anchors that corrupt or replace sibling content.
- **Router.** Open redirects, path confusion, or route parameters that escape the type and shape the generated `.thane/types` declare.
- **Compiler and CLI.** Path traversal or writes outside the project directory, command injection through configuration or CLI arguments, and any path by which template text, configuration values or file names (as opposed to the project's own TypeScript, which the build runs by design) cause the compiler to execute code.
- **Development server and hot updates.** Any page that is not served by `thane dev` reaching the hot-update or browser-events channel, cross-origin or DNS-rebinding access to the server, or reading files outside the project root through it. The server is a development tool, but a developer's machine is still a target.
- **TypeScript plugin.** Code execution or file access through the plugin beyond what the editor's TypeScript host grants it.
- **Supply chain.** Tampered or unexpected contents in the published npm package, install-time scripts, or a release process that can be made to publish code that is not in this repository.

### Out of scope

- Vulnerabilities in applications built with Thane that come from the application's own code: markup an application inserts itself, secrets committed to a bundle, missing authentication, and similar. Thane does not sanitise attribute values; an application that binds untrusted data to `href`, `src`, `style`, `srcdoc` or a URL-bearing attribute must validate it first.
- Vulnerabilities in dependencies and tools Thane uses (Bun, esbuild, TypeScript, Playwright). Report those upstream: Bun's policy is at [github.com/oven-sh/bun/security](https://github.com/oven-sh/bun/security). If the exposure exists only because of how Thane uses the dependency, it is in scope here.
- Findings that require an attacker who already has code execution on the developer's machine, write access to the project's source tree, or control of a dependency the project installs. The compiler executes project code at build time by design, as any bundler does.
- Findings that require the development server to be deliberately bound to a public interface (`--host 0.0.0.0`) and reachable from the internet, unless the finding also works against the default `localhost` binding.
- Denial of service against GitHub, npm or any other third-party infrastructure.
- Reports produced by automated scanners without a working reproduction, and reports of outdated transitive dependencies without a demonstrated impact on Thane.
- Social engineering of the maintainer or contributors.

## Security model

These are the properties the framework is built to hold. A report that shows one of them broken is a vulnerability.

- **Templates are compiled, not interpreted.** `html` templates are turned into static `<template>` elements and binding code at build time. There is no runtime template compiler, and no application string is parsed as HTML by the runtime in a compiled build. A template passed to a component outside the compiler is set as markup, which is why the compiler is required for production.
- **Dynamic text is text.** A `${...}` binding in text position writes to a text node's `data`. It is never parsed as HTML, whatever it contains.
- **Attributes are written as attributes.** Attribute bindings use `setAttribute` or the matching DOM property. Attribute names are fixed in the template at build time; only values are dynamic, and they are written as given. See the note on URL-bearing attributes above.
- **Build-time evaluation is constrained, not sandboxed.** Expressions the compiler evaluates at build time run in a restricted `vm` context with a frozen set of globals rather than through `eval`. This is a correctness measure. It is not a security boundary, because the compiler runs project code at build time by design.
- **The development server is development-only.** `thane dev` listens on `localhost` unless told otherwise, hot updates are applied only in pages the server itself serves, and nothing from the hot-update path reaches a production bundle.
- **The runtime makes no requests of its own.** It reads and writes the DOM and the History API. The only code it loads is the route loaders the application supplies to the router. It does not use `eval`, `Function`, network APIs or storage.

## Safe harbour

Security research on Thane carried out in good faith and within this policy is welcome. If you:

- test only against copies of Thane you run yourself and applications you own or are authorised to test,
- do not access, modify or destroy anyone else's data,
- do not degrade a third party's service, and
- give the maintainer a reasonable time to fix an issue before disclosing it,

then the maintainer will not pursue legal action against you for that research and will work with you on disclosure. If you are unsure whether something is covered, ask first through one of the reporting channels.

## Thanks

People who report valid issues are listed in the relevant advisory and, with their permission, here.
