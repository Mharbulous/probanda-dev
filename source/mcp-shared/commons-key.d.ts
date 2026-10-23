// Types for commons-key.js. Keep in step with it.

export declare const BAKED_SUPABASE_URL: string;

export declare const CLOUD_KEY_TARGET: string;

/** Where the key is kept: Windows Credential Manager, or a fake in tests. */
export interface CloudKeyStore {
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
  delete(): Promise<void>;
}

export declare const credentialManagerStore: CloudKeyStore;

/** Swaps the store loadCommonsKey and saveCommonsKey use by default (tests). Returns the previous one. */
export declare function setCloudKeyStore(store: CloudKeyStore): CloudKeyStore;

export interface CommonsKey {
  supabaseUrl: string;
  staticKey: string; // service_role / sb_secret_ key; empty until configured
  // Set when a stored credential exists but could not be read.
  credentialError?: string;
}

/** The legacy file's path, read only to migrate a key an earlier version saved there. */
export declare function credentialPath(env?: NodeJS.ProcessEnv): string;

export declare function loadCommonsKey(env?: NodeJS.ProcessEnv, store?: CloudKeyStore): Promise<CommonsKey>;

export declare function saveCommonsKey(staticKey: string, env?: NodeJS.ProcessEnv, store?: CloudKeyStore): Promise<void>;
