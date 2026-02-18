declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function mock(fn?: (...args: any[]) => any): any;

  interface MockInstance {
    mockImplementation(fn: (...args: any[]) => any): MockInstance;
    mockRestore(): void;
    mock: { calls: any[][] };
  }
  export function spyOn(obj: any, method: string): MockInstance;

  export interface ExpectMatchers {
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toHaveLength(expected: number): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: string | RegExp): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(count: number): void;
    not: ExpectMatchers;
  }

  export function expect(actual: unknown): ExpectMatchers;
}
