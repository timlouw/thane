declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;

  export interface ExpectMatchers {
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toHaveLength(expected: number): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
  }

  export function expect(actual: unknown): ExpectMatchers;
}
