// Token-hash confirmation links (recommended Supabase email template):
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding
// Same handler as /auth/callback; verifyOtp works on any device, unlike PKCE codes.
export { GET } from "../callback/route";
