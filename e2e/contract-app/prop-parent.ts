import { defineComponent } from 'thane';
import { PropChild } from './prop-child.js';

type PropParentProps = {
  valueA: any;
  valueB: any;
};

export const PropParent = defineComponent<PropParentProps>('prop-parent', ({ props }) => {
  const valueA = props.valueA;
  const valueB = props.valueB;

  return {
    template: html`
      <div data-testid="prop-parent-root">
        <span data-testid="prop-parent-a">${valueA()}</span>
        <span data-testid="prop-parent-static">parent-static</span>
        ${PropChild({ valueA: valueA, valueB: valueB })}
      </div>
    `,
  };
});
