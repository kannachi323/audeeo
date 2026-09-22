import {useState} from 'react';
import type {User} from '@supabase/supabase-js';
import {UserRound} from 'lucide-react';
import {SignOutButton} from './SignOutButton';

export function AccountProfile({user,disabled,onSignOut}:{user:User;disabled:boolean;onSignOut:()=>void}) {
  const [failedAvatar,setFailedAvatar]=useState('');
  const metadata=user.user_metadata ?? {};
  const name=[metadata.full_name,metadata.name,metadata.display_name].find(v=>typeof v==='string' && v.trim()) || user.email?.split('@')[0] || 'Audeeo account';
  const candidate=metadata.avatar_url || metadata.picture;
  const avatar=typeof candidate==='string' && candidate.startsWith('https://') ? candidate : '';
  return <div className="account-profile">
    <div className="account-avatar">{avatar && avatar!==failedAvatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={()=>setFailedAvatar(avatar)}/> : <UserRound aria-hidden="true"/>}</div>
    <div className="account-identity"><strong>{name}</strong><span>{user.email || 'Audeeo account'}</span></div>
    <SignOutButton user={user} disabled={disabled} onSignOut={onSignOut}/>
  </div>;
}
