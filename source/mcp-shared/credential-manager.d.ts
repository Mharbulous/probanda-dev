// Types for credential-manager.js. Keep in step with it.

export declare function readCredential(target: string): Promise<string | null>;

export declare function writeCredential(target: string, secret: string): Promise<void>;

export declare function deleteCredential(target: string): Promise<void>;
