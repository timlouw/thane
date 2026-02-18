import { defineComponent, signal } from 'thane';
import { CounterDemo } from './counter-demo.js';

/**
 * LiveDemo — Shows a live interactive thane component alongside its source code.
 *
 * The "demo" area contains a real compiled Counter component.
 * The "source" area displays the source code with syntax highlighting.
 */

// ── Live Demo Wrapper ──

const COUNTER_SOURCE = `export const Counter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);

  return {
    template: html\`
      <div class="counter">
        <span class="display">\${count()}</span>
        <div class="buttons">
          <button @click=\${decrement}>−</button>
          <button @click=\${increment}>+</button>
        </div>
      </div>
    \`,
  };
});`;

function highlightSource(el: Element, code: string): void {
  let h = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  h = h.replace(/(\/\/.*?)$/gm, '<span class="hl-cmt">$1</span>');
  h = h.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="hl-str">$1</span>');
  h = h.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="hl-str">$1</span>');
  h = h.replace(
    /\b(const|let|var|function|return|import|export|from|if|else|new|this|class|type)\b/g,
    '<span class="hl-kw">$1</span>'
  );
  h = h.replace(/\b([A-Z][a-zA-Z0-9]+)\b/g, '<span class="hl-type">$1</span>');
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');
  h = h.replace(/\b([a-z_$][\w$]*)\s*\(/g, '<span class="hl-fn">$1</span>(');

  el.innerHTML = h;
}

export const LiveDemo = defineComponent('live-demo', ({ root }) => ({
  template: html`
    <div class="live-demo">
      <div class="demo-source">
        <div class="demo-panel-header">
          <span class="panel-dot red"></span>
          <span class="panel-dot yellow"></span>
          <span class="panel-dot green"></span>
          <span class="panel-filename">counter.ts</span>
        </div>
        <pre><code class="source-code"></code></pre>
      </div>
      <div class="demo-preview">
        <div class="demo-panel-header">
          <span class="preview-label">Live Preview</span>
          <span class="preview-badge">interactive</span>
        </div>
        <div class="preview-content">
          ${CounterDemo({})}
        </div>
      </div>
    </div>
  `,
  styles: css`
    .live-demo {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--code-bg);
    }

    .demo-source {
      border-right: 1px solid var(--border-color);
    }

    .demo-panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      font-size: 13px;
    }

    .panel-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .red { background: #ff5f57; }
    .yellow { background: #febc2e; }
    .green { background: #28c840; }

    .panel-filename {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 12px;
      margin-left: 8px;
    }

    .preview-label {
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
    }

    .preview-badge {
      margin-left: auto;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 100px;
      background: var(--accent-subtle);
      color: var(--accent);
      font-weight: 500;
    }

    pre {
      margin: 0;
      padding: 20px;
      border: none;
      border-radius: 0;
      background: transparent;
      overflow-x: auto;
      max-height: 400px;
    }

    pre code {
      font-size: 13px;
      line-height: 1.7;
    }

    .preview-content {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 300px;
      background: var(--bg-primary);
    }

    @media (max-width: 768px) {
      .live-demo {
        grid-template-columns: 1fr;
      }
      .demo-source {
        border-right: none;
        border-bottom: 1px solid var(--border-color);
      }
      pre { max-height: 250px; }
    }
  `,
  onMount: () => {
    const codeEl = root.querySelector('.source-code');
    if (codeEl) highlightSource(codeEl, COUNTER_SOURCE);
  },
}));
