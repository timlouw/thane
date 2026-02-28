/**
 * Public mount API — single entry point for all bootstrap modes.
 *
 * Tree-shakable: the router module uses a registration bridge pattern.
 * When an app imports `defineRoutes` (or any router symbol), the router
 * self-registers its start/stop callbacks. For apps that don't use routing,
 * the router code is never loaded and is excluded from the bundle entirely.
 *
 * ── Mode A: Component only ──────────────────────────
 * mount({ component: App });
 * mount({ component: App, target: document.getElementById('app')! });
 *
 * ── Mode B: Shell component + router ────────────────
 * mount({ component: ShellApp, router: { routes: Routes } });
 *
 * ── Mode C: Router only (no shell) ─────────────────
 * mount({ router: { routes: Routes } });
 */

import { mountComponent, unmount } from './component.js';
import type { MountHandle, ComponentHTMLSelector } from './component.js';
import type { RouterConfig } from './router.js';
import { __routerStart, __routerStop } from './router-bridge.js';

// ─────────────────────────────────────────────────────────────
//  Mount options
// ─────────────────────────────────────────────────────────────

/** Options for the `mount()` function. */
export interface MountOptions {
  /** Component to mount (return value of `defineComponent()`). Omit for Mode C. */
  component?: ComponentHTMLSelector<any> | undefined;
  /** Target element. Defaults to `document.body`. */
  target?: HTMLElement | undefined;
  /** Component props. */
  props?: Record<string, any> | undefined;
  /** Router configuration. Omit for Mode A (no routing). */
  router?: RouterConfig | undefined;
}

// ─────────────────────────────────────────────────────────────
//  mount()
// ─────────────────────────────────────────────────────────────

/**
 * Mount a Thane application.
 *
 * @returns A MountHandle for the shell/component (Modes A & B), or a
 *          handle whose `destroy()` stops the router (Mode C).
 */
export function mount(options: MountOptions): MountHandle {
  const target = options.target ?? document.body;
  const routerDeps = { mountComponent, unmount };

  // ── Mode A: component only ──
  if (options.component && !options.router) {
    return mountComponent(options.component, target, options.props);
  }

  // ── Mode B: shell component + router ──
  if (options.component && options.router) {
    if (!__routerStart || !__routerStop) {
      throw new Error(
        '[thane] mount(): router option provided but the router module has not been imported. ' +
        'Import `defineRoutes` from \'thane/router\' in your routes file to activate the router.',
      );
    }

    const shellHandle = mountComponent(options.component, target, options.props);
    const routerConfig = options.router;
    const { notFound, ...routeMap } = routerConfig.routes;

    // Find the outlet element inside the shell — defaults to 'router-outlet'
    const outletId = routerConfig.outletId ?? 'router-outlet';
    const outlet = shellHandle.root.querySelector<HTMLElement>(`#${outletId}`)
      ?? document.getElementById(outletId);

    if (!outlet) {
      throw new Error(
        `[thane] Router outlet element with id="${outletId}" not found. ` +
        'In Mode B (shell + router), your shell component\'s template must contain ' +
        `an element with id="${outletId}".`,
      );
    }

    __routerStart({ routes: routeMap, notFound }, outlet, routerDeps);

    return {
      root: shellHandle.root,
      destroy: () => {
        __routerStop!();
        shellHandle.destroy();
      },
    };
  }

  // ── Mode C: router only (no shell) ──
  if (options.router) {
    if (!__routerStart || !__routerStop) {
      throw new Error(
        '[thane] mount(): router option provided but the router module has not been imported. ' +
        'Import `defineRoutes` from \'thane/router\' in your routes file to activate the router.',
      );
    }

    const { notFound, ...routeMap } = options.router.routes;
    __routerStart({ routes: routeMap, notFound }, target, routerDeps);

    return {
      root: target as any,
      destroy: () => {
        __routerStop!();
      },
    };
  }

  throw new Error(
    '[thane] mount(): provide at least `component` or `router` (or both).',
  );
}

// Re-export unmount for convenience
export { unmount };
