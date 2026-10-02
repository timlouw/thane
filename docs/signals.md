# Signals

Signals are the core reactive primitive in Thane. A signal holds a value and notifies subscribers when it changes. The runtime uses push-based notification: a write notifies its subscribers synchronously, and a write made while subscribers are running is notified after they finish.

## Creating a Signal

```typescript
import { signal } from 'thane';

const count = signal(0);
```

## Reading a Signal

Call with no arguments to read:

```typescript
count(); // 0
```

Inside `computed()` or `effect()`, reading a signal automatically tracks it as a dependency.

## Writing a Signal

Call with a value to write:

```typescript
count(5); // sets count to 5, notifies subscribers
```

Writes only notify when the value actually changes (compared with `Object.is`):

```typescript
count(5);
count(5); // no notification — same value
```

## Read-Only Signals

`ReadonlySignal<T>` is a signal that can be read and subscribed to, but not written: a `computed()` is one, and so is a
signal handed out by a store that keeps its writes to itself. `Signal<T>` is a `ReadonlySignal<T>` that can be written too,
so it goes where a `ReadonlySignal<T>` is asked for, but not the other way round: a `computed()` where a `Signal<T>` is
asked for is a type error.

```typescript
const count = signal(0);
const doubled = computed(() => count() * 2);
const view: ReadonlySignal<number> = count; // ✅
const write: Signal<number> = doubled;      // ❌ type error: a computed cannot be written
```

## Subscribing Manually

Use `.subscribe()` for explicit observation outside of `computed`/`effect`:

```typescript
const unsubscribe = count.subscribe((value) => {
  console.log('Count is now:', value);
});
// subscriber is called immediately with the current value

// Optionally skip the initial call:
const unsub = count.subscribe((value) => {
  console.log('Changed to:', value);
}, true); // true = skip initial

// Clean up when done
unsubscribe();
```

`.subscribe()` returns an unsubscribe function. Calling it removes the listener immediately.

### Writes Inside Subscribers

A subscriber (or effect) may write other signals. The new value is stored at once, so a read sees it, but its notification waits until every subscriber of the signal being notified has run. The waiting signals are then notified one after the other, each one's own follow-up writes being notified before the next signal's subscribers run. A signal set several times in one such cascade is notified once, with its last value.

```typescript
const a = signal(0);
const b = signal(0);

a.subscribe((v) => b(v * 10), true); // writes b while a is notifying
a.subscribe((v) => console.log('a2 sees b =', b()), true);
b.subscribe((v) => console.log('b is now', v), true);

a(1);
// "a2 sees b = 10"  (b already holds its new value)
// "b is now 10"     (b's subscribers run after a's)
```

---

## Computed Signals

`computed()` creates a derived signal that auto-tracks dependencies and re-evaluates lazily.

```typescript
import { signal, computed } from 'thane';

const firstName = signal('John');
const lastName = signal('Doe');
const fullName = computed(() => `${firstName()} ${lastName()}`);

fullName(); // 'John Doe'

firstName('Jane');
fullName(); // 'Jane Doe'
```

Computed signals:

- **Pull-on-read** — re-evaluation only happens when you read the value after a dependency changed. If nobody reads, no work is done.
- **Dirty-marking** — a dependency that notifies marks the computed dirty; re-evaluation is deferred until the next read. A computed over two computeds that share a source (a diamond) notifies its own subscribers once, with the final value.
- **Differential tracking** — if a re-evaluation reads different signals than before, subscriptions are updated automatically. New deps are added, old deps are removed.
- **Subscribe** — computeds expose `.subscribe()` just like regular signals.

A read is always fresh. Inside a `batch()` function, and while subscribers run, a source can have changed without having notified the computed yet; a computed read there computes again when any signal was written since it last computed:

```typescript
import { signal, computed, batch } from 'thane';

const price = signal(10);
const doubled = computed(() => price() * 2);

batch(() => {
  price(20);
  doubled(); // 40
});
```

Its subscribers are still notified once, with the final value, after the batch or the cascade.

### Disposing a Computed

```typescript
const doubled = computed(() => count() * 2);

// Later, when no longer needed:
doubled.dispose();
```

`.dispose()` unsubscribes from all tracked dependencies and prevents further re-evaluation.

---

## Effects

`effect()` runs a side-effect function and re-runs it whenever any signal read inside changes.

```typescript
import { signal, effect } from 'thane';

const name = signal('world');

const dispose = effect(() => {
  console.log(`Hello, ${name()}!`);
});
// logs: "Hello, world!"

name('Thane');
// logs: "Hello, Thane!"

dispose(); // stops the effect
```

Effects:

- Run **immediately** on creation (captures initial dependencies).
- **Auto-track** signals — if a re-run reads different signals, the dependency set updates.
- Return a **dispose function** — call it to stop the effect and unsubscribe from all dependencies.
- **Survive errors** — if the effect function throws, the error is surfaced asynchronously via `queueMicrotask` but the effect stays alive and continues tracking.

### Cleaning Up Between Runs

The effect's function may return a cleanup: it runs before the next run, and when the effect is disposed. So does an
`onCleanup()` function the run registers, and a `computed()` or `effect()` the run creates is disposed then:

```typescript
effect(() => {
  const id = setInterval(tick, delay());
  return () => clearInterval(id); // a new delay() starts a new interval, and the old one stops
});
```

---

## Ownership

A `computed()` or an `effect()` created while a component's setup or its `onMount` runs belongs to the component:
destroying the component disposes it, so it stops following its signals. `onCleanup(fn)` called there runs `fn` when the
component is destroyed ([Components](components.md#oncleanup)); called in an effect's run, before the next run.

```typescript
export const Clock = defineComponent(() => {
  const now = signal(Date.now());
  const id = setInterval(() => now(Date.now()), 1000);
  onCleanup(() => clearInterval(id));
  const time = computed(() => new Date(now()).toLocaleTimeString()); // disposed with the component
  return html`<time>${time()}</time>`;
});
```

Anywhere else, in an event handler or a store module, nothing owns what is created: it lives until it is disposed, and
`onCleanup()` throws in a development build, since nothing would call its function.

---

## Batch

`batch()` defers all signal notifications until the batch function completes. This prevents intermediate states from propagating to subscribers.

```typescript
import { signal, batch } from 'thane';

const first = signal('John');
const last = signal('Doe');

// Without batch: each write notifies at once, so a subscriber of `first`
// sees the old `last` value
first('Jane');
last('Smith');

// With batch: both values are set before anything is notified
batch(() => {
  first('Jane');
  last('Smith');
});
```

Key behaviors:

- Signal values are updated **immediately** inside the batch — reads see the new value right away.
- Notifications are **deferred** until the outermost batch ends. Each changed signal is then notified **once**, with its final value, in the order the signals were first set. An effect that reads several of them runs once per changed signal, and sees the final values every time; a `computed` over several of them notifies once.
- Batches **nest** — only the outermost batch triggers notifications.
- A `batch()` called inside a subscriber notifies its signals, and any signal the cascade set before it, before it returns. The follow-up writes their subscribers make wait, like any write inside a subscriber, until the outer notification has finished.
- A `computed` read inside the batch function returns the value its sources give it now (see [Computed Signals](#computed-signals)).

---

## Untrack

`untrack()` reads signals without registering a dependency. Use it inside `computed()` or `effect()` when you want to read a value without tracking it.

```typescript
import { signal, computed, untrack } from 'thane';

const label = signal('Count');
const count = signal(0);

const display = computed(() => {
  // label() is NOT tracked — changing label won't re-evaluate this computed
  const labelText = untrack(() => label());
  // count() IS tracked — changing count will re-evaluate
  return `${labelText}: ${count()}`;
});

display(); // 'Count: 0'
count(5);
display(); // 'Count: 5'
label('Total');
display(); // still 'Count: 5' — label wasn't tracked
```

---

## Circular Dependencies

When subscribers keep setting each other's signals, each round of the cascade runs one level deeper on the call stack. In a development build (`thane dev`, `thane build` without `--prod`), a cycle that has not settled after 500 rounds stops with an error that says so, and later writes notify as usual:

```
Error: [thane] Signals keep setting each other: a subscriber's write triggers itself again, 500 cascades deep.
```

The same holds for a `computed` whose subscriber sets the computed's own source; that error is reported the way any subscriber's error is, asynchronously. A production build has no check, which would cost every app bytes: there a cycle that never settles ends in a stack overflow (`RangeError: Maximum call stack size exceeded`), and the runtime's bookkeeping can be left broken, so that later writes are never notified. Treat a cycle as a bug to fix, not an error to catch. A cascade that settles, such as two signals that set each other until a limit is reached, runs to the end.

---

## Summary

| Function          | Purpose                              | Returns                           |
| :---------------- | :----------------------------------- | :-------------------------------- |
| `signal(initial)` | Create a read/write reactive value   | `Signal<T>`                       |
| `computed(fn)`    | Derived value, auto-tracked, lazy    | `ReadonlySignal<T> & { dispose }` |
| `effect(fn)`      | Side effect, auto-tracked, immediate | `() => void` (dispose)            |
| `batch(fn)`       | Defer notifications until complete   | `void`                            |
| `untrack(fn)`     | Read signals without tracking        | `T` (return value of fn)          |
| `onCleanup(fn)`   | Run `fn` when the component or the effect run that calls it ends | `void`                |

← [Back to Docs](README.md)
