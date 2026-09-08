import { expect, test, describe } from 'bun:test';
import { buildAndReadJs as buildProjectAndReadJs, PROD_BUILD } from '../../testing/build-project.js';

/** Production build of a fixture plus optional extra files, returning the emitted JavaScript. */
const buildAndReadJs = (source: string, extraFiles: Record<string, string> = {}): Promise<string> =>
  buildProjectAndReadJs(source, { extraFiles, config: PROD_BUILD });

// ============================================================================
// Tests — Sole-content text bindings in repeat (textContent mode)
// ============================================================================

describe('Text binding modes in repeat items', () => {
  test('repeat over props signal source keeps property access and mounts child components returned directly', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';
import { ProductGrid } from './ProductGrid.js';

const items = signal([{ id: 1, title: 'A' }]);

export const App = defineComponent('test-app', () => ({
  template: html\`\${ProductGrid({ products: items })}\`,
}));

mount(App);
`;

    const js = await buildAndReadJs(source, {
      'src/ProductCard.ts': `
import { defineComponent } from 'thane';

export const ProductCard = defineComponent<{ product: { id: number; title: string } }>('product-card', ({ props }) => ({
  template: html\`<article>\${props.product.title}</article>\`,
}));
`,
      'src/ProductGrid.ts': `
import { defineComponent } from 'thane';
import { ProductCard } from './ProductCard.js';

type Product = { id: number; title: string };

export const ProductGrid = defineComponent<{ products: { (): Product[]; subscribe: (fn: (items: Product[]) => void, immediate?: boolean) => () => void } }>('product-grid', ({ props }) => ({
  template: html\`
    <section>
      \${repeat(props.products(), (product) => ProductCard({ product }), html\`<p>None</p>\`, (product) => product.id)}
    </section>
  \`,
}));
`,
    });

    expect(js).not.toContain('ProductCard({ product })');
    expect(js).not.toMatch(/[^A-Za-z_]roducts\(\)/);
    expect(js).toContain('document.createElement("div")');
    // Destroy child helper is used in cleanups (may be minified from __dc)
    expect(js).toMatch(/cleanups:\[[A-Za-z_$][\w$]*\(/);
    // Items getter accesses .products (may be minified from props.products)
    expect(js).toContain('.products');
  });

  test('sole-content text binding writes the placeholder text node, not textContent', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // The row resolves the Text node once (el.firstChild) and writes nodeValue on fill and update
    expect(js).toMatch(/\.firstChild[,;)]/);
    expect(js).toMatch(/\.nodeValue\s*=/);
    expect(js).not.toMatch(/\.textContent\s*=\s*\w+\.label/);
  });

  test('sole-content keeps a placeholder text node in the template', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // The static template ships <li>-</li>: the placeholder is what nodeValue overwrites,
    // and being non-whitespace it survives whitespace stripping and the prod minifier
    expect(js).toMatch(/<li>-<\/li>/);
  });

  test('multiple sole-content bindings in different elements each get their own text node', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <table>
        <tbody>
          \${repeat(items(), (item) => html\`
            <tr>
              <td>\${item.id}</td>
              <td>\${item.label}</td>
            </tr>
          \`, (item) => item.id)}
        </tbody>
      </table>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Both td cells write nodeValue: 2 fill + 2 update = 4 assignments at minimum
    const nodeValueWrites = js.match(/\.nodeValue\s*=/g);
    expect(nodeValueWrites).toBeTruthy();
    expect(nodeValueWrites!.length).toBeGreaterThan(3);
    // Each cell carries its placeholder text node in the template
    expect(js).toMatch(/<td>-<\/td><td>-<\/td>/);
  });
});

// ============================================================================
// Tests — Mixed-content text bindings in repeat items (commentMarker mode)
// ============================================================================

describe('Mixed-content text bindings in repeat items', () => {
  test('mixed-content text binding uses comment markers', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, name: 'Alice' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>Name: \${item.name}</li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Mixed-content should use TreeWalker for comment markers
    expect(js).toContain('createTreeWalker');
    // Should have nextSibling.data for updating the text node next to the comment marker
    expect(js).toContain('nextSibling.data');
  });

  test('two bindings in one element use separate comment markers', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, first: 'John', last: 'Doe' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.first} \${item.last}</li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Two comment markers means two nextSibling.data assignments in fill and update
    const nextSiblingMatches = js.match(/nextSibling\.data/g);
    expect(nextSiblingMatches).toBeTruthy();
    // At minimum: 2 fill + 2 update = 4
    expect(nextSiblingMatches!.length).toBeGreaterThan(3);
  });

  test('adjacent bindings with no space use comment markers and both update independently', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, a: 'X', b: 'Y' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.a}\${item.b}</li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Both bindings need comment markers since they share an element with multiple bindings
    expect(js).toContain('createTreeWalker');
    const nextSiblingMatches = js.match(/nextSibling\.data/g);
    expect(nextSiblingMatches).toBeTruthy();
    expect(nextSiblingMatches!.length).toBeGreaterThan(3);
  });
});

// ============================================================================
// Tests — Whitespace stripping in templates
// ============================================================================

describe('Template whitespace stripping', () => {
  test('main component template has inter-element whitespace stripped', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const count = signal(0);
  return {
    template: html\`
      <div>
        <h1>Hello</h1>
        <p>\${count()}</p>
        <button @click=\${() => count(count() + 1)}>+</button>
      </div>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Main template should have no "> <" whitespace between elements
    // (but > followed by text content like ">Hello<" is fine)
    expect(js).not.toMatch(/>\s+<(?!\/)/); // No whitespace between > and opening <
    // Specifically check the structural pattern is compact
    expect(js).toContain('<div><h1>Hello</h1>');
  });

  test('repeat item template has inter-element whitespace stripped', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <table>
        <tbody>
          \${repeat(items(), (item) => html\`
            <tr>
              <td>\${item.id}</td>
              <td>\${item.label}</td>
            </tr>
          \`, (item) => item.id)}
        </tbody>
      </table>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Row template should be compact, with only the text-node placeholders inside the cells
    expect(js).toMatch(/<tr><td>-<\/td><td>-<\/td><\/tr>/);
  });

  test('trailing attribute whitespace from removed event handlers is stripped', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  const click = (item: any) => {};
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li><a @click=\${() => click(item)}>\${item.label}</a></li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // After removing @click attribute, the trailing space before > should be stripped
    // Should be <a></a>, not <a ></a>
    expect(js).not.toMatch(/<a\s+>/);
    expect(js).toContain('<a>');
  });
});

// ============================================================================
// Tests — Navigation prefix reuse optimization
// ============================================================================

describe('Navigation prefix reuse in repeat codegen', () => {
  test('second element binding reuses first binding variable (prefix optimization)', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <table>
        <tbody>
          \${repeat(items(), (item) => html\`
            <tr>
              <td>\${item.id}</td>
              <td>\${item.label}</td>
            </tr>
          \`, (item) => item.id)}
        </tbody>
      </table>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // The second binding should reference the first variable, not navigate from root again
    // After minification: let x = r.firstElementChild, y = x.nextElementSibling
    // Instead of: let x = r.firstElementChild, y = r.firstElementChild.nextElementSibling
    const rowCreationMatch = js.match(/cloneNode.*?update:/s);
    expect(rowCreationMatch).toBeTruthy();
    const rowCode = rowCreationMatch![0];
    // With prefix reuse, the second var should chain off the first via .nextElementSibling
    // not re-navigate from the clone root. Check that the pattern varName.nextElementSibling
    // appears where varName was previously assigned to .firstElementChild
    const firstElemAssign = rowCode.match(/(\w+)=\w+\.firstElementChild/);
    expect(firstElemAssign).toBeTruthy();
    const firstVar = firstElemAssign![1];
    // The second binding should reuse firstVar (e.g., g.nextElementSibling)
    expect(rowCode).toContain(`${firstVar}.nextElementSibling`);
  });
});

// ============================================================================
// Tests — Mixed scenarios: text + nested elements at same level
// ============================================================================

describe('Text bindings with sibling elements', () => {
  test('binding inside nested element with surrounding static text compiles correctly', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const name = signal('World');
  return {
    template: html\`
      <div>
        Hello <span>\${name()}</span> goodbye
      </div>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Should compile without errors
    expect(js.length).toBeGreaterThan(0);
    // The template should preserve the "Hello" and "goodbye" static text
    // while the binding inside <span> works
    expect(js).toContain('Hello');
    expect(js).toContain('goodbye');
  });

  test('sole-content binding in child element with sibling static text nodes', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`
          <li>
            Item: <strong>\${item.label}</strong> (#\${item.id})
          </li>
        \`, (item) => item.id)}
      </ul>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Should compile without errors
    expect(js.length).toBeGreaterThan(0);
    // The strong element's binding is sole-content: it writes its placeholder text node
    // The #${item.id} is mixed-content in the <li>, should use comment markers
    expect(js).toMatch(/\.nodeValue\s*=/);
    expect(js).toMatch(/<strong>-<\/strong>/);
    expect(js).toContain('createTreeWalker');
  });
});

// ============================================================================
// Tests — Comment marker preservation after whitespace stripping
// ============================================================================

describe('Comment marker preservation', () => {
  test('boundary comments survive whitespace stripping in main template', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const name = signal('World');
  return {
    template: html\`
      <div>
        <p>Hello \${name()} World</p>
      </div>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // The comment markers <!--bN--> and <!----> should survive in the template
    // Look for the comment marker pattern in the compiled template string
    expect(js).toMatch(/<!--b\d+-->/);
    expect(js).toContain('<!---->');
    // The text node between them must exist (space between marker and boundary)
    // Pattern: <!--bN-->text<!----> with space or content between markers
    // The nextSibling.data pattern should be present for updating the text node
    expect(js).toContain('nextSibling.data');
  });

  test('when conditional markers survive whitespace stripping', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const show = signal(true);
  return {
    template: html\`
      <div>
        <p when=\${show()}>Visible</p>
      </div>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Should compile without errors — conditional markers must survive stripping
    expect(js.length).toBeGreaterThan(0);
  });

  test('when conditional with expression text binding does not emit raw template expression', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const show = signal(true);
  const count = signal(1);
  return {
    template: html\`
      <div>
        <span when=\${show()}>\${count() + 1}</span>
      </div>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    expect(js).toMatch(/<!--b\d+-->/);
    expect(js).toContain('nextSibling.data');
    expect(js).not.toContain('${count() + 1}');
  });
});
