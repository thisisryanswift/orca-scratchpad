// The few Node APIs the worker and its tests use, so `tsc` passes without node_modules.
declare module 'node:fs' {
  export interface FSWatcher {
    close(): void
  }
  export function watch(path: string, listener: (event: string, name: string | null) => void): FSWatcher
}
declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>
  export function writeFile(path: string, data: string, encoding?: 'utf8'): Promise<void>
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>
}
declare module 'node:os' {
  export function homedir(): string
  export function hostname(): string
  export function tmpdir(): string
}
declare module 'node:path' {
  export function basename(path: string): string
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}
