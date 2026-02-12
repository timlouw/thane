import { defineComponent, signal } from 'thane';

interface MyElementProps {
  color: string;
}

export const MyElementComponent = defineComponent<MyElementProps>((ctx) => {
  const color = signal<string | null>(ctx.props.color ?? null);
  // const loading = signal(false);
  // const loading2 = signal(true);
  // const countries = signal(['USA', 'Canada', 'Mexico', 'Germany', 'France', 'Italy', 'Spain', 'Japan', 'China', 'India']);
  // const className = signal('click-section');
  // const timeoutIds: number[] = [];

  // const update = () => {
  //   color(`#${Math.floor(Math.random() * 16777215).toString(16)}`);
  //   loading(!loading());
  //   loading2(!loading2());
  // };

  // const scheduleUpdates = () => {
  //   if (!color()) {
  //     const rootWithHost = ctx.root as unknown as { host?: HTMLElement };
  //     const rootElement = rootWithHost.host ?? (ctx.root as unknown as HTMLElement);
  //     color(rootElement.getAttribute('color'));
  //   }

  //   timeoutIds.push(
  //     window.setTimeout(() => {
  //       update();
  //     }, 500),
  //     window.setTimeout(() => {
  //       countries(countries().toSpliced(2, 1));
  //     }, 1000),
  //     window.setTimeout(() => {
  //       countries([...countries(), 'Brazil']);
  //     }, 1500),
  //     window.setTimeout(() => {
  //       const arr = [...countries()];
  //       arr[0] = 'United States';
  //       countries(arr);
  //     }, 2000),
  //     window.setTimeout(() => {
  //       const arr = [...countries()];
  //       [arr[0], arr[1]] = [arr[1], arr[0]];
  //       countries(arr);
  //       className('click-section updated');
  //     }, 2500),
  //   );
  // };

  // const clearUpdates = () => {
  //   timeoutIds.forEach((id) => window.clearTimeout(id));
  //   timeoutIds.length = 0;
  // };

  return {
    template: html`
      <div class="box" style="background-color: ${color()}">huhguyuyguygu</div>
    `,
    styles: css`
      .box {
        width: 100%;
        height: 20px;
        border-radius: 5px;
        border: 1px solid black;
      }

      .box2 {
        width: 100%;
        height: 20px;
        border-radius: 5px;
        border: 2px solid green;
      }

      .click-section {
        border: 1px solid #ccc;
        border-radius: 5px;
      }

      .click-section.updated {
        background-color: lightgreen;
      }

      .click-section button {
        margin: 5px;
        padding: 8px 16px;
        cursor: pointer;
      }
    `
  };
});
