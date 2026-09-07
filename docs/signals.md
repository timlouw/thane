# Signals

Signals are the core reactive primitive in Thane. A signal holds a value and notifies subscribers when it changes. The runtime uses push-based notification with automatic batching for glitch-free updates.

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
- **Dirty-marking** — prevents diamond dependency glitches. Dependencies mark the computed as dirty; actual re-evaluation is deferred until the next read.
- **Differential tracking** — if a re-evaluation reads different signals than before, subscriptions are updated automatically. New deps are added, old deps are removed.
- **Subscribe** — computeds expose `.subscribe()` just like regular signals.

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

---

## Batch

`batch()` defers all signal notifications until the batch function completes. This prevents intermediate states from propagating to subscribers.

```typescript
import { signal, batch } from 'thane';

const first = signal('John');
const last = signal('Doe');

// Without batch: subscribers fire twice (once per signal write)
first('Jane');
last('Smith');

// With batch: subscribers fire once after both values are set
batch(() => {
  first('Jane');
  last('Smith');
});
```

Key behaviors:

- Signal values are updated **immediately** inside the batch — reads see the new value right away.
- Notifications are **deferred** until the outermost batch ends.
- Batches **nest** — only the outermost batch triggers notifications.
- Cascading updates (signals set during notification) are auto-batched and flushed iteratively, up to a **maximum depth of 100** to catch circular dependencies.

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

## Circular Dependency Detection

If cascading signal updates form a cycle, Thane detects it after 100 iterations and throws:

```
Error: Circular signal dependency
```

This typically indicates signals subscribing to and setting each other in an infinite loop.

---

## Summary

| Function | Purpose | Returns |
|:---------|:--------|:--------|
| `signal(initial)` | Create a read/write reactive value | `Signal<T>` |
| `computed(fn)` | Derived value, auto-tracked, lazy | `ReadonlySignal<T> & { dispose }` |
| `effect(fn)` | Side effect, auto-tracked, immediate | `() => void` (dispose) |
| `batch(fn)` | Defer notifications until complete | `void` |
| `untrack(fn)` | Read signals without tracking | `T` (return value of fn) |

← [Back to Docs](README.md)
