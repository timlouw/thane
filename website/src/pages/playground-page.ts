import { defineComponent as dc, signal } from 'thane';
import { PlaygroundEditor } from '../components/playground-editor.js';

// ── Example Snippets ──

const COUNTER_EXAMPLE = `const Counter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);
  const reset = () => count(0);

  return {
    template: html\`
      <div class="counter">
        <div class="display">\${count()}</div>
        <p class="label">clicks</p>
        <div class="btns">
          <button @click=\${decrement}>−</button>
          <button class="reset" @click=\${reset}>Reset</button>
          <button class="primary" @click=\${increment}>+</button>
        </div>
      </div>
    \`,
    styles: css\`
      .counter {
        display: flex; flex-direction: column;
        align-items: center; gap: 8px;
      }
      .display { font-size: 3.5rem; font-weight: 800; }
      .label {
        font-size: 13px; color: #71717a;
        text-transform: uppercase; letter-spacing: 0.1em;
      }
      .btns { display: flex; gap: 8px; margin-top: 12px; }
      button {
        padding: 8px 20px; border: 1px solid #27272a;
        border-radius: 6px; background: #1c1c22;
        color: #fafafa; font-size: 16px; font-weight: 600;
        cursor: pointer; transition: all 150ms ease;
      }
      button:hover { background: #27272a; border-color: #3f3f46; }
      .primary { background: #6366f1; border-color: #6366f1; }
      .primary:hover { background: #818cf8; border-color: #818cf8; }
      .reset { font-size: 12px; }
    \`,
  };
});

mount(Counter);`;

const TODO_EXAMPLE = `const TodoApp = defineComponent(() => {
  const items = signal([]);
  const input = signal('');

  const addTodo = () => {
    const text = input().trim();
    if (text) {
      items([...items(), { id: Date.now(), text, done: false }]);
      input('');
    }
  };

  const toggle = (id) => {
    items(items().map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  const remove = (id) => {
    items(items().filter(item => item.id !== id));
  };

  return {
    template: html\`
      <div class="todo">
        <h2>Todo List</h2>
        <div class="input-row">
          <input type="text" placeholder="What needs to be done?"
            value="\${input()}"
            @input=\${(e) => input(e.target.value)}
            @keydown.enter=\${addTodo} />
          <button @click=\${addTodo}>Add</button>
        </div>
        <ul class="list">
          \${repeat(
            items(),
            (item) => html\`
              <li class="\${item.done ? 'done' : ''}">
                <span @click=\${() => toggle(item.id)}>\${item.text}</span>
                <button class="del" @click=\${() => remove(item.id)}>×</button>
              </li>
            \`,
            html\`<li class="empty">No todos yet. Add one above!</li>\`,
            (item) => item.id
          )}
        </ul>
      </div>
    \`,
    styles: css\`
      .todo { max-width: 350px; margin: 0 auto; padding: 20px; }
      h2 { font-size: 1.5rem; margin-bottom: 16px; text-align: center; }
      .input-row { display: flex; gap: 8px; margin-bottom: 16px; }
      input {
        flex: 1; padding: 8px 12px; border: 1px solid #27272a;
        border-radius: 6px; background: #18181b; color: #fafafa;
        font-size: 14px; outline: none;
      }
      input:focus { border-color: #6366f1; }
      button {
        padding: 8px 16px; background: #6366f1; color: white;
        border: none; border-radius: 6px; font-weight: 600;
        cursor: pointer; transition: background 150ms;
      }
      button:hover { background: #818cf8; }
      .list { list-style: none; }
      li {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; border-bottom: 1px solid #1c1c22;
        cursor: pointer; transition: opacity 200ms;
      }
      li:hover { background: #111113; }
      .done span { text-decoration: line-through; opacity: 0.5; }
      .del {
        background: transparent; color: #71717a; font-size: 18px;
        padding: 2px 8px; border: none; cursor: pointer;
      }
      .del:hover { color: #ef4444; }
      .empty { color: #71717a; text-align: center; font-style: italic; }
    \`,
  };
});

mount(TodoApp);`;

const GREETING_EXAMPLE = `const Greeting = defineComponent(() => {
  const name = signal('World');
  const color = signal('#6366f1');

  return {
    template: html\`
      <div class="greeting">
        <input type="text" value="\${name()}"
          @input=\${(e) => name(e.target.value)}
          placeholder="Your name" />
        <input type="color" value="\${color()}"
          @input=\${(e) => color(e.target.value)} />
        <h2 style="color: \${color()}">
          Hello, \${name()}! 👋
        </h2>
      </div>
    \`,
    styles: css\`
      .greeting {
        display: flex; flex-direction: column;
        align-items: center; gap: 16px; padding: 24px;
      }
      input[type="text"] {
        padding: 10px 16px; border: 1px solid #27272a;
        border-radius: 6px; background: #18181b;
        color: #fafafa; font-size: 15px; outline: none;
        width: 200px; text-align: center;
      }
      input[type="text"]:focus { border-color: #6366f1; }
      input[type="color"] {
        width: 48px; height: 36px; border: 1px solid #27272a;
        border-radius: 6px; cursor: pointer; background: #18181b;
      }
      h2 { font-size: 1.75rem; font-weight: 700; transition: color 100ms; }
    \`,
  };
});

mount(Greeting);`;

const EXAMPLES: Record<string, { label: string; code: string }> = {
  counter: { label: 'Counter', code: COUNTER_EXAMPLE },
  todo: { label: 'Todo List', code: TODO_EXAMPLE },
  greeting: { label: 'Greeting', code: GREETING_EXAMPLE },
};

export const PlaygroundPage = dc('playground-page', ({ root }) => {
  const activeExample = signal('counter');

  return {
    template: html`
      <div class="playground-page">
        <div class="container">
          <div class="pg-page-header">
            <h1>Playground</h1>
            <p
              >Experiment with Thane components in a sandboxed environment. Edit the code and click Run (or wait for
              auto-reload) to see your changes.</p
            >
          </div>

          <div class="example-bar">
            <span class="example-label">Examples:</span>
            <button id="example-counter" class="example-btn" @click=${() => activeExample('counter')}>Counter</button>
            <button id="example-todo" class="example-btn" @click=${() => activeExample('todo')}>Todo List</button>
            <button id="example-greeting" class="example-btn" @click=${() => activeExample('greeting')}>Greeting</button>
          </div>

          <div class="pg-main"> ${PlaygroundEditor({ initialCode: COUNTER_EXAMPLE })} </div>

          <div class="pg-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p
              >The playground uses a lightweight mini-runtime in a sandboxed iframe. Event handling and reactivity work
              via full re-render on signal change. For surgical DOM updates, use the full Thane compiler.</p
            >
          </div>
        </div>
      </div>
    `,
    styles: css`
      .playground-page {
        padding: calc(var(--nav-height) + 40px) 0 80px;
      }

      .pg-page-header {
        margin-bottom: 32px;
      }

      .pg-page-header h1 {
        font-size: 2.5rem;
        margin-bottom: 12px;
      }

      .pg-page-header p {
        font-size: 1.05rem;
        max-width: 640px;
      }

      .example-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }

      .example-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        margin-right: 4px;
      }

      .example-btn {
        padding: 6px 16px;
        border: 1px solid var(--border-color);
        border-radius: 100px;
        background: var(--bg-secondary);
        color: var(--text-muted);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .example-btn:hover {
        border-color: var(--text-muted);
        color: var(--text-primary);
      }

      .example-active {
        background: var(--accent-subtle);
        border-color: var(--accent);
        color: var(--accent);
      }

      .pg-main {
        margin-bottom: 24px;
      }

      .pg-note {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 14px 18px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        color: var(--text-muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .pg-note svg {
        flex-shrink: 0;
        margin-top: 1px;
      }

      .pg-note p {
        color: var(--text-muted);
        font-size: 13px;
      }
    `,
    onMount: () => {
      const updateExampleButtons = (key: string) => {
        root.querySelector('#example-counter')?.classList.toggle('example-active', key === 'counter');
        root.querySelector('#example-todo')?.classList.toggle('example-active', key === 'todo');
        root.querySelector('#example-greeting')?.classList.toggle('example-active', key === 'greeting');
      };

      activeExample.subscribe(updateExampleButtons);

      // When example changes, update the playground textarea + re-run
      activeExample.subscribe((key) => {
        const example = EXAMPLES[key];
        if (!example) return;
        const textarea = root.querySelector('.pg-textarea') as HTMLTextAreaElement;
        if (textarea) {
          textarea.value = example.code;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, true); // skip initial (already loaded via prop)
    },
  };
});
