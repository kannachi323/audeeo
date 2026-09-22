// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it} from 'vitest';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SubscriptionSummary} from '../src/components/SubscriptionSummary';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  // jsdom does not implement native modal dialogs; browser QA covers focus and Escape.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable:true, value:function () { this.setAttribute('open', ''); }});
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {configurable:true, value:function () { this.removeAttribute('open'); }});
});
afterEach(() => {
  cleanup();
  for (const [key, descriptor] of [['showModal', originalShow], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});

it.each([true, false])('opens complete billing details without triggering checkout (Apple: %s)', async apple => {
  render(<SubscriptionSummary apple={apple}/>);
  expect(screen.getByText('600 usage minutes / month')).toBeTruthy();
  expect(screen.queryByText(/Cloud caption minutes reset/)).toBeNull();
  await userEvent.click(screen.getByRole('button', {name: 'More info'}));
  const dialog = screen.getByRole('dialog', {name: 'About Audeeo Pro'});
  expect(within(dialog).getByText(/Cloud caption minutes reset monthly and do not roll over/)).toBeTruthy();
  expect(within(dialog).getByText(apple ? /Payment is charged to your Apple Account/ : /Your subscription renews automatically until cancelled/)).toBeTruthy();
  expect(within(dialog).getByText(/does not cancel a store subscription/)).toBeTruthy();
  expect(within(dialog).getByRole('link', {name: 'Privacy'}).getAttribute('href')).toBe('https://audeeo.app/privacy');
  await userEvent.click(within(dialog).getByRole('button', {name: 'Close subscription details'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button', {name: 'More info'}));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', {cancelable: true}));
  expect(screen.queryByRole('dialog')).toBeNull();
});
