import { defineComponent } from 'thane';

type PropGrandchildProps = {
  valueA: any;
};

// The leaf reads its prop directly in the template: `props.valueA()` is a tracked signal read
export const PropGrandchild = defineComponent<PropGrandchildProps>('prop-grandchild', ({ props }) => {
  return {
    template: html`
      <div data-testid="prop-grandchild-root">
        <span data-testid="prop-grandchild-a" data-a=${props.valueA()}>${props.valueA()}</span>
        <span data-testid="prop-grandchild-static">grandchild-static</span>
      </div>
    `,
  };
});
