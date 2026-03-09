declare module 'node:child_process' {
  export * from 'child_process';
}

declare module 'node:path' {
  export * from 'path';
}

declare module 'node:url' {
  export * from 'url';
}

declare const process: NodeJS.Process;
