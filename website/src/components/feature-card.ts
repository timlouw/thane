import { defineComponent } from 'thane';

/**
 * FeatureCard — A single feature in the features grid.
 *
 * Usage: ${FeatureCard({ icon: '🔬', title: '...', description: '...' })}
 */

type FeatureCardProps = {
  icon: string;
  title: string;
  description: string;
};

export const FeatureCard = defineComponent<FeatureCardProps>('feature-card', ({ props }) => ({
  template: html`
    <div class="feature-card card">
      <div class="feature-icon">${props.icon}</div>
      <h3 class="feature-title">${props.title}</h3>
      <p class="feature-desc">${props.description}</p>
    </div>
  `,
  styles: css`
    .feature-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .feature-icon {
      font-size: 28px;
      line-height: 1;
      margin-bottom: 4px;
    }

    .feature-title {
      font-size: 17px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .feature-desc {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.6;
    }
  `,
}));
