// Types for commons-key.js. Keep in step with it.

export declare const BAKED_SUPABASE_URL: string;

export interface CommonsKey {
  supabaseUrl: string;
  staticKey: string; // service_role / sb_secret_ key; empty until configured
  // Set when a credential file exists but could not be read.
  credentialError?: string;
}

export declare function credentialPath(env?: NodeJS.ProcessEnv): string;

export declare function loadCommonsKey(env?: NodeJS.ProcessEnv): Promise<CommonsKey>;
