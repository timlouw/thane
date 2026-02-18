import { defineComponent, signal, computed } from 'thane';

type InstallTabsProps = {
  size?: string;
};

export const InstallTabs = defineComponent<InstallTabsProps>('install-tabs', ({ props }) => {
  const activeTab = signal('bun');
  const copied = signal(false);

  const commands: Record<string, string> = {
    bun: 'bun add thane',
    npm: 'npm install thane',
    yarn: 'yarn add thane',
    pnpm: 'pnpm add thane',
  };

  const command = computed(() => commands[activeTab()] || commands.bun);

  const bunActive = computed(() => (activeTab() === 'bun' ? 'tab-active' : ''));
  const npmActive = computed(() => (activeTab() === 'npm' ? 'tab-active' : ''));
  const yarnActive = computed(() => (activeTab() === 'yarn' ? 'tab-active' : ''));
  const pnpmActive = computed(() => (activeTab() === 'pnpm' ? 'tab-active' : ''));

  const copyCommand = () => {
    navigator.clipboard.writeText(command()).catch(() => {});
    copied(true);
    setTimeout(() => copied(false), 2000);
  };

  const compact = props.size === 'compact';

  return {
    template: html`
      <div class="install-tabs ${compact ? 'install-compact' : ''}">
        <div class="tab-bar">
          <button class="tab-btn ${bunActive()}" @click=${() => activeTab('bun')}>bun</button>
          <button class="tab-btn ${npmActive()}" @click=${() => activeTab('npm')}>npm</button>
          <button class="tab-btn ${yarnActive()}" @click=${() => activeTab('yarn')}>yarn</button>
          <button class="tab-btn ${pnpmActive()}" @click=${() => activeTab('pnpm')}>pnpm</button>
        </div>
        <div class="command-bar">
          <span class="command-prompt">$</span>
          <code class="command-text">${command()}</code>
          <button class="copy-btn" @click=${copyCommand}>
            ${whenElse(
              copied(),
              html`<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" width="16" height="16">
                <polyline points="20 6 9 17 4 12" />
              </svg>`,
              html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>`,
            )}
          </button>
        </div>
      </div>
    `,
    styles: css`
      .install-tabs {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--code-bg);
        max-width: 480px;
      }

      .install-compact {
        max-width: 400px;
      }

      .tab-bar {
        display: flex;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
      }

      .tab-btn {
        flex: 1;
        padding: 10px 16px;
        background: none;
        border: none;
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all var(--transition-fast);
        border-bottom: 2px solid transparent;
      }

      .tab-btn:hover {
        color: var(--text-secondary);
        background: var(--accent-subtle);
      }

      .tab-active {
        color: var(--accent);
        border-bottom-color: var(--accent);
        background: var(--accent-subtle);
      }

      .command-bar {
        display: flex;
        align-items: center;
        padding: 14px 16px;
        gap: 10px;
      }

      .command-prompt {
        color: var(--accent);
        font-family: var(--font-mono);
        font-weight: 600;
        font-size: 14px;
        user-select: none;
      }

      .command-text {
        flex: 1;
        font-family: var(--font-mono);
        font-size: 14px;
        color: var(--text-primary);
        background: none;
        padding: 0;
      }

      .copy-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-xs);
        transition: all var(--transition-fast);
      }

      .copy-btn:hover {
        color: var(--text-primary);
        background: var(--bg-surface);
      }
    `,
  };
});
