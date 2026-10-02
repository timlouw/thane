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

mount({ component: App });
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
      \${repeat(props.products(), (product) => ProductCard({ product }), { key: "id", empty: html\`<p>None</p>\` })}
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
        \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // The fill writes textContent (through the guard variable) and keeps the Text node it
    // created; the guarded update writes the node's nodeValue
    expect(js).toMatch(/\.textContent\s*=\s*\(?([\w$]+\s*=\s*)?[\w$]+\.label/);
    expect(js).toMatch(/\.firstChild/);
    expect(js).toMatch(/\.nodeValue\s*=\s*[\w$]+/);
  });

  test('sole-content leaves the element empty in the template', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Template should have empty <li></li>; the text node is created when the row is filled
    expect(js).toMatch(/<li><\/li>/);
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
          \`, { key: "id" })}
        </tbody>
      </table>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Both td cells keep the Text node created by the fill and write nodeValue on update
    expect(js.match(/\.firstChild/g)!.length).toBeGreaterThanOrEqual(2);
    expect(js.match(/\.nodeValue\s*=/g)!.length).toBe(2);
    // Template should have empty td elements
    expect(js).toMatch(/<td><\/td><td><\/td>/);
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
        \${repeat(items(), (item) => html\`<li>Name: \${item.name}</li>\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // The text node after the marker is reached by path once per row, no TreeWalker, and
    // written through `.data`
    expect(js).not.toContain('createTreeWalker');
    expect(js).toContain('<li>Name: <!----> <!----></li>');
    expect(js).toMatch(/\.lastChild\.previousSibling/);
    expect(js).toMatch(/\.data\s*=/);
  });

  test('two bindings in one element use separate comment markers', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, first: 'John', last: 'Doe' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.first} \${item.last}</li>\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Two comment markers means two text nodes, each written in fill and update; the space between
    // the bindings stays
    expect(js).toContain('<li><!----> <!----> <!----> <!----></li>');
    expect(js).not.toContain('createTreeWalker');
    const dataWrites = js.match(/\.data\s*=/g);
    expect(dataWrites).toBeTruthy();
    // At minimum: 2 fill + 2 update = 4
    expect(dataWrites!.length).toBeGreaterThan(3);
  });

  test('adjacent bindings with no space use comment markers and both update independently', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, a: 'X', b: 'Y' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.a}\${item.b}</li>\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Both bindings need comment markers since they share an element with multiple bindings
    expect(js).toContain('<li><!----> <!----><!----> <!----></li>');
    expect(js).not.toContain('createTreeWalker');
    const dataWrites = js.match(/\.data\s*=/g);
    expect(dataWrites).toBeTruthy();
    expect(dataWrites!.length).toBeGreaterThan(3);
  });
});

// ============================================================================
// Tests — Redundancy guards on repeat item writes
// ============================================================================

describe('Redundancy guards in repeat items', () => {
  test('row updates compare against the last written value before touching the DOM', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  const selected = signal(0);
  return {
    template: html\`
      <table><tbody>
        \${repeat(items(), (item) => html\`<tr class=\${selected() === item.id ? 'danger' : ''}><td>\${item.label}</td></tr>\`, { key: "id" })}
      </tbody></table>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Update path: `if (_m.p !== (_m.p = expr)) write(_m.p)` — the guard (a field on the row's
    // record for lean rows, a closure variable otherwise) is compared with its own
    // reassignment, so an unchanged value never reaches textContent/setAttribute
    expect(js).toMatch(/([\w$.]+)\s*!==\s*\(\1\s*=\s*[\w$]+\.label\)/);
    // (the selection class binding is owned by the list-level subscription, so the row update
    // path no longer recomputes it; its guarded fill is asserted below)
    // Create path: the template already ships class="", so an empty result skips the write
    // (esbuild shortens the strict comparison against a string literal to `!=`; the class
    // write itself goes through className on HTML elements)
    expect(js).toMatch(/\)\s*!==?\s*""\s*&&\s*\(?[\w$]+\.className\s*=/);
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
mount({ component: App });
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
          \`, { key: "id" })}
        </tbody>
      </table>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Row template should be compact: <tr><td></td><td></td></tr>
    expect(js).toMatch(/<tr><td><\/td><td><\/td><\/tr>/);
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
        \${repeat(items(), (item) => html\`<li><a @click=\${() => click(item)}>\${item.label}</a></li>\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
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
          \`, { key: "id" })}
        </tbody>
      </table>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // The second binding should reference the first variable, not navigate from root again
    // After minification: let x = r.firstElementChild, y = x.nextElementSibling
    // Instead of: let x = r.firstElementChild, y = r.firstElementChild.nextElementSibling
    // In the compiled component (not the runtime before it), the row binder declares both
    // cells, the second chained off the first via .nextElementSibling
    const compiled = js.slice(js.indexOf('__b:'));
    expect(compiled).toMatch(/let ([\w$]+)=[\w$]+\.firstElementChild,[\w$]+=\1\.nextElementSibling/);
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
mount({ component: App });
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
        \`, { key: "id" })}
      </ul>
    \`,
  };
});
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // Should compile without errors
    expect(js.length).toBeGreaterThan(0);
    // The strong element's binding is sole-content: created on fill, nodeValue on update
    // The #${item.id} is mixed-content in the <li>, should use comment markers
    expect(js).toMatch(/\.nodeValue\s*=/);
    expect(js).toMatch(/<strong><\/strong>/);
    expect(js).not.toContain('createTreeWalker');
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
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    // The marker and the boundary comment survive in the template, the marker without its id
    //, with the text node between them, which the binding writes
    expect(js).not.toMatch(/<!--b\d+-->/);
    expect(js).toContain('Hello <!---->World<!----> World');
    expect(js).toMatch(/\.data ?=/);
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
mount({ component: App });
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
mount({ component: App });
`;
    const js = await buildAndReadJs(source);
    expect(js).toContain('<!----> <!----></span>');
    expect(js).not.toMatch(/<!--b\d+-->/);
    expect(js).toMatch(/\.data ?=/);
    expect(js).not.toContain('${count() + 1}');
  });
});
