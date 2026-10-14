// Types for dpapi-store.js. Keep in step with it. NodeJS and Buffer come from
// the compiling package's @types/node.

export declare function defaultStateDir(env?: NodeJS.ProcessEnv, name?: string): string;

export declare function readProtectedJson<T>(path: string, fallback: T | null, protect?: boolean): Promise<T | null>;

export declare function writeProtectedJson(path: string, value: unknown, protect?: boolean): Promise<void>;

export declare function protectLocalSecret(data: Buffer): Promise<Buffer>;

export declare function unprotectLocalSecret(data: Buffer): Promise<Buffer>;
