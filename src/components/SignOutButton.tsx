import type {User} from '@supabase/supabase-js';
import {Button} from './Button';
import {ProviderIcon} from './ProviderIcon';

export function SignOutButton({user,disabled=false,onSignOut}:{user?:User;disabled?:boolean;onSignOut:()=>void}) {
  // Prefer the most recently used identity over the original signup provider.
  const identity=[...(user?.identities ?? [])].sort((a,b)=>(Date.parse(b.last_sign_in_at ?? '') || 0)-(Date.parse(a.last_sign_in_at ?? '') || 0))[0];
  const provider=identity?.provider || user?.app_metadata?.provider;
  const providerName=provider==='google' ? 'Google' : provider==='apple' ? 'Apple' : provider==='email' ? 'Email' : 'Account';
  return <Button className="sign-out-button" variant="outline" disabled={disabled} onClick={onSignOut}
    aria-label={`Sign out (${providerName})`} title={`Sign out of your ${providerName.toLowerCase()} account`}>
    {(provider==='google'||provider==='apple')&&<ProviderIcon provider={provider}/>}
    <span>Sign out</span>
  </Button>;
}
