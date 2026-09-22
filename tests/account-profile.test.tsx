// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AccountProfile} from '../src/components/AccountProfile';
afterEach(cleanup);
it('uses the actual profile and most recent sign-in provider on the sign-out button',async()=>{
  const signOut=vi.fn();
  const user={email:'alex@example.com',user_metadata:{full_name:'Alex Rivera',avatar_url:'https://example.com/avatar.png'},app_metadata:{provider:'apple'},identities:[{provider:'apple',last_sign_in_at:'2026-09-01'},{provider:'google',last_sign_in_at:'2026-09-15'}]} as any;
  const {container}=render(<AccountProfile user={user} disabled={false} onSignOut={signOut}/>);
  expect(screen.getByText('Alex Rivera')).toBeTruthy();
  expect(screen.getByText('alex@example.com')).toBeTruthy();
  const signOutButton=screen.getByRole('button',{name:'Sign out (Google)'});
  expect(signOutButton.querySelector('svg.provider-icon')?.getAttribute('aria-hidden')).toBe('true');
  const avatar=container.querySelector('img')!;
  fireEvent.error(avatar);
  expect(container.querySelector('img')).toBeNull();
  await userEvent.click(signOutButton);
  expect(signOut).toHaveBeenCalledOnce();
});
it('handles email accounts with no name or photo and respects disabled actions',async()=>{
  const signOut=vi.fn();
  render(<AccountProfile user={{email:'alex@example.com',user_metadata:{},app_metadata:{provider:'email'}} as any} disabled onSignOut={signOut}/>);
  expect(screen.getByText('alex')).toBeTruthy();
  await userEvent.click(screen.getByRole('button',{name:'Sign out (Email)'}));
  expect(signOut).not.toHaveBeenCalled();
});
