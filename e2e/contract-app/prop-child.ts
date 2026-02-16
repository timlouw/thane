import { defineComponent } from 'thane';
import { PropGrandchild } from './prop-grandchild.js';

type PropChildProps = {
  valueA: any;
  valueB: any;
};

export const PropChild = defineComponent<PropChildProps>('prop-child', ({ props }) => {
  const valueA = props.valueA;
  const valueB = props.valueB;

  return {
    template: html`
      <div data-testid="prop-child-root">
        <span data-testid="prop-child-b">${valueB()}</span>
        <span data-testid="prop-child-static">child-static</span>
        ${PropGrandchild({ valueA: valueA })}
      </div>
    `,
  };
});
