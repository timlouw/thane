import { defineComponent, signal, html, when, repeat } from 'thane';

/**
 * Nested-directive scenario for the benchmark harness (`bun run bench --app nested`).
 *
 * 1,000 rows. Each row has a text binding, a `when()` on a row property with a text binding
 * inside, and an inner keyed `repeat()` of 3 items with text bindings only. No events and no
 * directives inside the inner rows, and the inner list sits outside the `when()` and below the
 * row's root element: that shape also compiled correctly before rows could hold nested directives,
 * so the same source measures builds from either side of that change.
 */

const adjectives = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
];
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const nouns = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
];

const pick = (arr: string[]) => arr[Math.round(Math.random() * 1000) % arr.length]!;
const buildLabel = () => `${pick(adjectives)} ${pick(colours)} ${pick(nouns)}`;

interface Child {
  id: number;
  label: string;
}

interface RowData {
  id: number;
  label: string;
  show: boolean;
  children: Child[];
}

let nextId = 1;
let nextChildId = 1;
/** Every "replace inner lists" click starts a new generation, so a check can tell the lists apart. */
let generation = 0;

const buildChildren = (): Child[] => {
  const children: Child[] = new Array(3);
  for (let k = 0; k < 3; k++) {
    children[k] = { id: nextChildId++, label: `[g${generation}] c${k}` };
  }
  return children;
};

const buildData = (count: number): RowData[] => {
  const data: RowData[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = { id: nextId++, label: buildLabel(), show: true, children: buildChildren() };
  }
  return data;
};

export const Nested = defineComponent('bench-nested', () => {
  const rows = signal<RowData[]>([]);

  const run = () => {
    rows(buildData(1000));
  };

  const toggle = () => {
    const data = [...rows()];
    for (let i = 0; i < data.length; i += 10) {
      const row = data[i]!;
      data[i] = { ...row, show: !row.show };
    }
    rows(data);
  };

  const replaceInner = () => {
    generation++;
    const data = [...rows()];
    for (let i = 0; i < data.length; i += 10) {
      data[i] = { ...data[i]!, children: buildChildren() };
    }
    rows(data);
  };

  const swapRows = () => {
    const data = rows();
    if (data.length > 998) {
      const newData = [...data];
      const temp = newData[1]!;
      newData[1] = newData[998]!;
      newData[998] = temp;
      rows(newData);
    }
  };

  const clear = () => {
    rows([]);
  };

  return html`
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Thane Nested Benchmark</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="run" @click=${run}
                  >Create 1,000 rows</button
                >
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="toggle" @click=${toggle}
                  >Toggle every 10th row</button
                >
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="inner" @click=${replaceInner}
                  >Replace every 10th inner list</button
                >
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="swaprows" @click=${swapRows}
                  >Swap Rows</button
                >
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="clear" @click=${clear}>Clear</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody id="tbody">
          ${repeat(
            rows(),
            (row) => html`
              <tr>
                <td class="col-md-1">${row.id}</td>
                <td class="col-md-4"><span ${when(row.show)}>${row.label}</span></td>
                <td class="col-md-7">
                  <div class="inner">
                    ${repeat(row.children, (child) => html`<span>${child.label}</span>`, { key: 'id' })}
                  </div>
                </td>
              </tr>
            `,
            { key: 'id' },
          )}
        </tbody>
      </table>
    </div>
  `;
});
