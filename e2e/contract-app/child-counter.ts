import { defineComponent, signal } from 'thane';

type ChildCounterProps = {
  label?: string;
  parentCount?: number;
  onChildMount?: () => void;
  onChildIncrement?: (value: number) => void;
};

export const ChildCounter = defineComponent<ChildCounterProps>('child-counter', ({ props }) => {
  const local = signal(0);
  const label = signal(String(props.label ?? 'child-default'));
  const parentSnapshot = signal(Number(props.parentCount ?? -1));

  const incrementLocal = () => {
    local(local() + 1);
    if (typeof props.onChildIncrement === 'function') {
      props.onChildIncrement(local());
    }
  };

  return {
    template: html`
      <section data-testid="child-root">
        <div data-testid="child-label">${label()}</div>
        <div data-testid="child-parent-count">${parentSnapshot()}</div>
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
