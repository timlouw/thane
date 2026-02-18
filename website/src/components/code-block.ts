import { defineComponent, signal } from 'thane';

/**
 * CodeBlock — Displays syntax-highlighted code with copy button.
 *
 * Usage: ${CodeBlock({ code: myCodeString, lang: 'typescript' })}
 *
 * The code string is set via textContent in onMount to ensure proper
 * HTML escaping, then highlighted with a simple regex-based highlighter.
 */

type CodeBlockProps = {
  code: string;
  lang?: string;
  filename?: string;
};

function highlightSyntax(el: Element): void {
  const text = el.textContent || '';
  let h = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Comments (line & block)
  h = h.replace(/(\/\/.*?)$/gm, '<span class="hl-cmt">$1</span>');
  h = h.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-cmt">$1</span>');

  // Strings (single & double quotes)
  h = h.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="hl-str">$1</span>');
  h = h.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="hl-str">$1</span>');

  // Template literals (backtick strings - simplified)
  h = h.replace(/(`[^`]*`)/g, '<span class="hl-str">$1</span>');

  // HTML tags in template literals
  h = h.replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="hl-tag">$2</span>');
  h = h.replace(/([\w-]+)(=)/g, '<span class="hl-attr">$1</span>$2');

  // Keywords
  h = h.replace(
    /\b(const|let|var|function|return|import|export|from|if|else|for|while|new|this|class|extends|type|interface|true|false|null|undefined|void|async|await|default|as|of|in)\b/g,
    '<span class="hl-kw">$1</span>'
  );

  // Type names (PascalCase)
  h = h.replace(/\b([A-Z][a-zA-Z0-9]+)\b/g, '<span class="hl-type">$1</span>');

  // Numbers
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');

  // Function calls
  h = h.replace(/\b([a-z_$][\w$]*)\s*\(/g, '<span class="hl-fn">$1</span>(');

  el.innerHTML = h;
}

export const CodeBlock = defineComponent<CodeBlockProps>('code-block', ({ root, props }) => {
  const copied = signal(false);

  const copyCode = () => {
    navigator.clipboard.writeText(props.code).catch(() => {});
    copied(true);
    setTimeout(() => copied(false), 2000);
  };

  return {
    template: html`
      <div class="code-block">
        <div class="code-header">
          <span class="code-lang">${props.lang || 'typescript'}</span>
          <div class="code-actions">
            <button class="code-copy-btn" @click=${copyCode}>
              ${whenElse(
                copied(),
                html`<span class="copied-text">Copied!</span>`,
                html`<span class="copy-text">Copy</span>`
              )}
            </button>
          </div>
        </div>
        <pre><code class="code-content"></code></pre>
      </div>
    `,
    styles: css`
      .code-block {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--code-bg);
      }

      .code-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
      }

      .code-lang {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-muted);
        text-transform: lowercase;
      }

      .code-copy-btn {
        background: none;
        border: 1px solid var(--border-color);
        color: var(--text-muted);
        font-family: var(--font-sans);
        font-size: 12px;
        padding: 4px 10px;
        border-radius: var(--radius-xs);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .code-copy-btn:hover {
        color: var(--text-primary);
        border-color: var(--text-muted);
        background: var(--bg-surface);
      }

      .copied-text { color: var(--success); }

      pre {
        margin: 0;
        padding: 20px 24px;
        border: none;
        border-radius: 0;
        background: transparent;
        overflow-x: auto;
      }

      pre code {
        font-size: 13.5px;
        line-height: 1.75;
      }
    `,
    onMount: () => {
      const codeEl = root.querySelector('.code-content');
      if (codeEl) {
        codeEl.textContent = props.code;
        highlightSyntax(codeEl);
      }
    },
  };
});
