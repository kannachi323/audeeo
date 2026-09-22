import type {Env} from './backend';

type DeletionUser = {id:string; identities?:Array<{provider:string; id?:string; identity_data?:{sub?:string}}>;
  app_metadata?:Record<string,unknown> & {audeeo_deletion?:{appleSubject?:string; tokenHash?:string}}};
const timeout = () => AbortSignal.timeout(8000);

async function apple(env:Env, path:string, values:Record<string,string>) {
  return fetch(`https://appleid.apple.com/auth/${path}`, {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.APPLE_CLIENT_ID!, client_secret:env.APPLE_CLIENT_SECRET!, ...values}), signal:timeout()});
}

/** Deletion is retryable; never remove the identity until provider cleanup is accepted.
 * Apple proof is stored in server-managed app_metadata, never user_metadata.
 * Only a SHA-256 digest is persisted, not the provider credential itself.
 */
export async function deleteAccount(env:Env, owner:string, accessToken:string, refreshToken?:unknown) {
  const headers = {apikey:env.SUPABASE_SECRET_KEY, 'Content-Type':'application/json'};
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${accessToken}`}, signal:timeout()});
  if (!response.ok) throw new Error('Sign in again before deleting your account.');
  const user = await response.json() as DeletionUser;
  if (user.id !== owner) throw new Error('Account changed. Reopen Account settings.');
  if (!env.REVENUECAT_SECRET_KEY) throw new Error('Account deletion is unavailable. Contact mattdev727@gmail.com.');
  const appleIdentity = user.identities?.find(identity=>identity.provider==='apple');
  let proof = user.app_metadata?.audeeo_deletion;
  if (appleIdentity) {
    if (!env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET)
      throw new Error('Apple account deletion is not configured. Contact mattdev727@gmail.com.');
    if (typeof refreshToken !== 'string' || refreshToken.length < 8 || refreshToken.length > 8192)
      throw new Error('Reconnect with Apple, then confirm account deletion again.');
    const subject = appleIdentity.identity_data?.sub || appleIdentity.id;
    if (!subject) throw new Error('Could not verify your Apple identity. Contact support.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken));
    const tokenHash = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    if (proof?.appleSubject !== subject || proof?.tokenHash !== tokenHash) {
      const validation = await apple(env,'token',{grant_type:'refresh_token',refresh_token:refreshToken});
      if (!validation.ok) throw new Error('Reconnect with Apple, then confirm account deletion again.');
      const tokens = await validation.json() as {id_token?:string};
      // This token comes directly from Apple's authenticated HTTPS token endpoint,
      // never from the client. Its subject must match the Supabase Apple identity.
      let claims: {sub?:string;aud?:string;iss?:string;exp?:number};
      try {claims=JSON.parse(atob(tokens.id_token!.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}
      catch {throw new Error('Apple did not verify your identity. Reconnect with Apple.');}
      if (claims.sub !== subject || claims.aud !== env.APPLE_CLIENT_ID ||
          !['https://appleid.apple.com','https://account.apple.com'].includes(claims.iss || '') ||
          !claims.exp || claims.exp*1000 <= Date.now())
        throw new Error('Apple account does not match this Audeeo account.');
      proof = {appleSubject:subject,tokenHash};
    }
  }
  // Freeze new server operations while deletion is pending, including retries.
  const marked = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`, {method:'PUT',headers,
    body:JSON.stringify({app_metadata:{...user.app_metadata,audeeo_deletion:proof || {}}}), signal:timeout()});
  if (!marked.ok) throw new Error('Could not begin account deletion. Please retry.');
  if (appleIdentity) {
    const revoked = await apple(env,'revoke',{token:refreshToken as string,token_type_hint:'refresh_token'});
    if (!revoked.ok) throw new Error('Apple authorization could not be revoked. Retry account deletion.');
  }
  const billing = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(owner)}`, {
    method:'DELETE',headers:{Authorization:`Bearer ${env.REVENUECAT_SECRET_KEY}`},signal:timeout()});
  if (!billing.ok && billing.status !== 404) throw new Error('Billing data deletion could not be requested. Retry account deletion.');
  // Hard deletion cascades through owner foreign keys and removes refresh sessions.
  const removed = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${owner}`, {
    method:'DELETE',headers,signal:timeout()});
  if (!removed.ok && removed.status !== 404) throw new Error('Account deletion could not finish. Please retry.');
  return {deleted:true};
}
