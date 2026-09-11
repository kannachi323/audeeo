// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({
  info: vi.fn(), plans: vi.fn(), action: vi.fn(), reconcile: vi.fn(), native: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.native }));
vi.mock("../src/lib/account", () => ({ accountRequest: mocks.reconcile }));
vi.mock("../src/lib/subscriptions", () => ({
  customerInfo: mocks.info, subscriptionPlans: mocks.plans,
  subscriptionAction: mocks.action, subscriptionManagementURL: () => null,
}));
import { Subscriptions } from "../src/components/Subscriptions";
const session = { user: { id: "owner" }, access_token: "test" } as any;
beforeEach(() => {
  vi.clearAllMocks(); mocks.native.mockReturnValue(false);
  mocks.info.mockResolvedValue({ active: false });
  mocks.plans.mockResolvedValue([{ id: "yearly", price: "$99.00", productID: "yearly" }]);
  mocks.reconcile.mockResolvedValue({ active: true });
});
afterEach(cleanup);
it("retains purchased entitlement and directs refresh when server reconciliation fails", async () => {
  render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={() => {}} />);
  const yearly = await screen.findByRole("button", { name: "Yearly · $99.00 / year" });
  await waitFor(() => expect((yearly as HTMLButtonElement).disabled).toBe(false));
  mocks.action.mockResolvedValue({ active: true });
  mocks.reconcile.mockRejectedValue(new Error("offline"));
  await userEvent.click(yearly);
  expect(await screen.findByText("Active")).toBeTruthy();
  expect(await screen.findByText(/do not purchase again/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Yearly · $99.00 / year" })).toBeNull();
});
it("refreshes native customer information on focus without triggering restorePurchases", async () => {
  mocks.native.mockReturnValue(true);
  render(<Subscriptions session={session} platform="ios" disabled={false} onBusy={() => {}} />);
  await waitFor(() => expect(mocks.plans).toHaveBeenCalledTimes(1));
  fireEvent.focus(window);
  await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(2));
  expect(mocks.action).not.toHaveBeenCalled();
});
it("does not display a late result after account view disposal", async () => {
  let resolve!: (result: unknown) => void;
  mocks.info.mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = render(<Subscriptions session={session} platform="browser" disabled={false} onBusy={() => {}} />);
  view.unmount(); resolve({ active: true });
  await Promise.resolve();
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
