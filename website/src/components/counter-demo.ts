import { defineComponent, signal } from 'thane';

/**
 * CounterDemo — An actual compiled thane counter component for the live demo.
 * Fully interactive, zero overhead — this is the real thing.
 */
export const CounterDemo = defineComponent('counter-demo', () => {
  const count = signal(0);
  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);
  const reset = () => count(0);

  return {
    template: html`
      <div class="demo-counter">
        <div class="demo-display">${count()}</div>
        <div class="demo-label">clicks</div>
        <div class="demo-buttons">
          <button class="demo-btn" @click=${decrement}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button class="demo-btn demo-btn-reset" @click=${reset}>Reset</button>
          <button class="demo-btn demo-btn-primary" @click=${increment}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    `,
    styles: css`
      .demo-counter {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 24px;
        min-height: 220px;
      }

      .demo-display {
        font-size: 4rem;
        font-weight: 800;
        color: var(--text-primary);
        line-height: 1;
        margin-bottom: 4px;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }

      .demo-label {
        font-size: 14px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-weight: 500;
        margin-bottom: 24px;
      }

      .demo-buttons {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .demo-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-secondary);
        cursor: pointer;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        transition: all var(--transition-fast);
      }

      .demo-btn:hover {
        background: var(--bg-surface-hover);
        color: var(--text-primary);
        border-color: var(--text-muted);
      }

      .demo-btn-primary {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
      }

      .demo-btn-primary:hover {
        background: var(--accent-hover);
        border-color: var(--accent-hover);
        color: white;
      }

      .demo-btn-reset {
        font-size: 12px;
        padding: 10px 14px;
      }
    `,
  };
});
