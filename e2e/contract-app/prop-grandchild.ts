import { defineComponent } from 'thane';

type PropGrandchildProps = {
  valueA: any;
};

export const PropGrandchild = defineComponent<PropGrandchildProps>('prop-grandchild', ({ props }) => {
  const valueA = props.valueA;

  return {
    template: html`
      <div data-testid="prop-grandchild-root">
        <span data-testid="prop-grandchild-a">${valueA()}</span>
        <span data-testid="prop-grandchild-static">grandchild-static</span>
      </div>
    `,
  };
});
