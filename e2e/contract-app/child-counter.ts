import { defineComponent, signal, html, type ReadonlySignal } from 'thane';

type ChildCounterProps = {
  label: string;
  /** The parent's count: the child reads the signal, so it follows the parent */
  parentCount: ReadonlySignal<number>;
  onChildMount?: () => void;
  onChildIncrement?: (value: number) => void;
};

export const ChildCounter = defineComponent<ChildCounterProps>('child-counter', ({ props }) => {
  const local = signal(0);

  const incrementLocal = () => {
    local(local() + 1);
    if (typeof props.onChildIncrement === 'function') {
      props.onChildIncrement(local());
    }
  };

  return {
    template: html`
      <section data-testid="child-root">
        <div data-testid="child-label">${props.label}</div>
        <div data-testid="child-parent-count">${props.parentCount()}</div>
        <div data-testid="child-local">${local()}</div>
        <button data-testid="child-inc" @click=${incrementLocal}>child +1</button>
      </section>
    `,
    onMount: () => {
      if (typeof props.onChildMount === 'function') {
        props.onChildMount();
      }
    },
  };
});
