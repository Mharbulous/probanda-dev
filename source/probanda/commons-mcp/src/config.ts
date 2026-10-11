// Public, non-secret Supabase project URL. After the three-layer teardown (B5,
// 2026-07-14) the only remaining Supabase consumer is the layer-3 legal-commons
// client (legal-commons/config.ts), which reads this as the default host for its
// static-credential PostgREST calls. The cloud anon key, per-session auth config,
// and matter_id UUID validation were removed with the retired case-data surface.
export const BAKED_SUPABASE_URL = "https://nbzkuhgiqscjkypedqff.supabase.co";
