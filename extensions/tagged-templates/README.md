# Tagged Template Literals

Configurable syntax highlighting for tagged template literals in JavaScript and TypeScript.

Maps tag function names (like `html`, `css`, `sql`, etc.) to VS Code's built-in language grammars so you get proper syntax highlighting, bracket matching, and commenting inside template strings.

## Features

- **HTML highlighting** in `` html`...` `` tagged templates
- **CSS highlighting** in `` css`...` `` tagged templates
- **Configurable** — add any tag → language mapping
- **Zero runtime dependencies** — uses only VS Code's built-in grammar infrastructure
- **TypeScript expressions** — `${...}` interpolations are properly highlighted as TypeScript
- **Extensible** — supports 30+ built-in language IDs

## Default Configuration

Out of the box, the extension highlights:

```typescript
const template = html`
  <div class="container">
    <h1>${title()}</h1>
    <p>Content here</p>
  </div>
`;

const styles = css`
  .container {
    display: flex;
    color: ${theme.primary};
  }
`;
```

## Configuration

Add or change tag → language mappings in your VS Code settings:

```json
{
  "tagged-templates.tags": {
    "html": "html",
    "css": "css",
    "sql": "sql",
    "gql": "graphql",
    "xmlTemplate": "xml",
    "md": "markdown"
  }
}
```

### Supported Language IDs

| Language ID | Description |
|---|---|
| `html` | HTML |
| `css` | CSS |
| `scss` | SCSS |
| `less` | Less |
| `sql` | SQL |
| `json` | JSON |
| `xml` | XML |
| `yaml` | YAML |
| `markdown` | Markdown |
| `graphql` | GraphQL |
| `javascript` | JavaScript |
| `typescript` | TypeScript |
| `python` | Python |
| `ruby` | Ruby |
| `go` | Go |
| `rust` | Rust |
| `c` | C |
| `cpp` | C++ |
| `csharp` | C# |
| `java` | Java |
| `php` | PHP |
| `shellscript` | Shell / Bash |
| `powershell` | PowerShell |
| `lua` | Lua |
| `perl` | Perl |
| `r` | R |
| `dart` | Dart |
| `swift` | Swift |
| `kotlin` | Kotlin |
| `glsl` | GLSL |
| `dockerfile` | Dockerfile |
| `ini` | INI |
| `toml` | TOML |
| `regex` | Regular Expressions |

## How It Works

The extension uses VS Code's **TextMate grammar injection** system:

1. For each configured tag (e.g., `html`), an injection grammar rule matches the pattern `` tagName`...` `` in JS/TS files
2. The template literal content is assigned an embedded language scope (e.g., `meta.embedded.block.html`)
3. VS Code's built-in grammar for that language provides the actual syntax highlighting
4. A separate reinjection grammar ensures `${...}` expressions within the template get TypeScript highlighting

When you change the `tagged-templates.tags` configuration, the extension regenerates the grammar files and prompts you to reload the window.

## Development

```bash
cd extensions/tagged-templates
npm install
npm run compile
```

To test locally, press `F5` in VS Code to launch the Extension Development Host.

To package:

```bash
npm run package
```
