# Audeeo macOS 0.1.0 distribution preparation

Updated September 16, 2026. App Store Connect app: **Audeeo: Live Subtitles**,
Apple ID `6811510356`. This document records preparation, not approval or release.

## Distribution candidate

- Use `artifacts/mac-app-store/Audeeo-6.pkg` — **0.1.0 (6)**, production billing,
  Apple silicon and Intel, macOS 13+.
- SHA-256: `dbc16ea03223b1847e568cd7f6b0f21cd1c6eba1ea87b440bd3e346131cb0158`.
- App Store application and installer signatures, profile/certificate match,
  sandbox/audio/network entitlements, both privacy manifests, architecture and
  build-number checks passed. See `Audeeo-6.verification.json` beside the package.
- The built frontend uses native App Store billing and the hosted relay. No
  configured server credentials were found in its JavaScript bundle.
- Builds 1–5 are superseded. Do not submit the sandbox-configured TestFlight package.
- Build 5 delivery failed Apple validation (90276): RevenueCat’s resource bundle
  lacked CFBundleIdentifier. The packager now supplies resource-bundle metadata
  before signing and verifies every nested resource bundle has an identifier.
  Build 6 passed local checks and was successfully delivered through Transporter
  on September 16 at 6:13 PM Pacific. Apple is processing the app. No App Store
  installation or review submission has been performed.
- Developer `.env` and the `npm run desktop` workflow remain unchanged.

## Prepared changes

The relay now supports a separate `APP_REVIEW_USER_IDS` allowlist for dedicated
review accounts. A production binary uses verified sandbox subscriptions,
consumables, purchase confirmation and session metering for those accounts.
Ordinary customers continue to use production balances. The client cannot enroll
itself, and sandbox credit never becomes production credit. A review account is
not unlimited and still uses the existing metering and purchase verification.

Deployed relay version: `5e819c76-09f6-459d-a215-5c4bb11a21fd`.
Post-deploy `/health` passed. `/v1/release-readiness` confirms account-deletion
and purchase-recovery configuration; production minute-pack checkout is still
disabled for ordinary production users. The dedicated reviewer account is now
enrolled in `APP_REVIEW_USER_IDS` (secret update after the code deployment above).

Reviewer login verification (September 16): enabled Supabase email authentication,
created the user-authorized dedicated email/password account with confirmed email,
and verified direct sign-in in the existing `npm run desktop` app. The account is
shown as Audeeo Reviewer, Free plan, 30 minutes remaining, and survives frontend
reload. Its authenticated usage API returns HTTP 200 and the sandbox wallet for
both production and sandbox client environment headers; packs are enabled and
usage remains metered. General signup email confirmation remains enabled. No
passwords are stored in this document. The user explicitly approved the AI agreement; onboarding was completed in the
dev app. A synthetic speech fixture passed through the live production relay
using the reviewer account with production client headers: captions at 1x charged
8 seconds, and Spanish spoken translation at 3x charged 33 seconds, produced
translated text and 10 audio chunks, and settled both sandbox leases. See
`artifacts/reviewer-live-verification.json`. This verifies the live server path,
not macOS capture in the distribution binary. Native two-pack checkout completed in Apple Sandbox with the user handling the
Apple prompt. This exposed an account-switch reconciliation bug: RevenueCat kept
a prior original customer ID, which skipped the verified quantity correction;
older receipts belonging to another wallet also blocked restore. The deployed
fix preserves recorded wallet ownership, skips other wallets during restoration,
and applies verified quantity corrections to the existing owner. The app now
shows 120 purchased minutes from two 60-minute packs, plus 600 restored sandbox
subscription minutes. Two server restores and native Restore purchases retained
720 total minutes without duplicate credit. See
`artifacts/reviewer-purchase-verification.json`. A subsequent cancellation test
was cancelled by the user, who confirmed the Apple dialog was closed; do not repeat checkout.

The privacy manifest now also declares sign-in names and account-linked usage
activity. The website privacy text has been corrected to remove the nonexistent
AI-withdrawal control and explicitly include profile data. The production website
build passed and was deployed as `a50bf4d1-de44-462a-88ac-a8aa090a888b`. Live
privacy, terms, and support routes returned HTTP 200; the live asset contains the
updated policy, and configured server secrets were absent from the bundle. The
same stale withdrawal reference was removed from native onboarding in build 5.

Validation: 319 tests were covered. The full run passed 317; two UI tests hit their
five-second timeout while parallel builds/tests were running, then their 37-test
files passed with two workers. The 32 billing/reviewer/session tests also passed
together. Relay typechecking and release compilation passed.

## App Store Connect draft

- Six screenshots are already uploaded. Current ordering is summaries,
  translation, appearance, captions, history, screen context. Review the intended
  marketing order before submission.
- Saved subtitle: **Live captions and translation**. Saved category: **Utilities**.
- Saved free download pricing ($0.00 base price), with availability on release in
  all 175 storefronts. The app is still unreleased. Review regional requirements
  before submission or narrow the storefront selection.
- All eight privacy data types are configured in the draft: Name, Email Address,
  Photos or Videos, Audio Data, Other User Content, User ID, Purchase History,
  Product Interaction. Each is account-linked, used for App Functionality, and
  not used for tracking. The user published the privacy label personally; App
  Store Connect’s “Published … by Matthew Chen” status was verified on September 16.
- The version description and review notes below are saved. Manual release is
  selected and was verified after reloading the version page.
- The user-provided App Review contact name, email, and phone are saved and were
  verified after reload. User-provided dedicated reviewer credentials are saved
  in App Store Connect and verified after reload; no password is stored here.
  The user-authorized dedicated Audeeo email/password account now authenticates
  successfully and is enrolled in reviewer billing mode. Saved review notes
  explicitly direct reviewers to Continue with email, not Google. The personal
  contact account has not been enrolled in reviewer billing mode.
- Existing age rating is 4+; its answers have not been independently requalified.
- Content-rights information is unset. Export-compliance questions remain to be
  completed against the submitted binary. The existing non-trader declaration
  requires the account holder's review; it was not changed.
- Apple production and sandbox server-notification URLs are unset. Configure the
  RevenueCat-provided Apple notification endpoint and verify refund/renewal
  delivery before release; do not use the Audeeo RevenueCat webhook URL here.
- First-purchase submission attachment still needs final review. Include both
  subscriptions and all three consumables with the
  initial app submission; product setup does not imply Apple approval.

## Apple validation result (September 16, 2026)

The version’s **Add for Review** action reported **Unable to Add for Review**:

- An Admin must provide the app’s privacy information (draft needs publishing).
- A build must be chosen (no upload yet).
- Content Rights Information must be completed.

No review submission was sent. The user signed in to Transporter. Privacy has
now been published. The user selected the affirmative content-rights declaration,
but its Save step remains incomplete: Apple’s latest Add for Review validation
lists only Content Rights and choosing a build. Build 6 was successfully delivered
at 6:13 PM Pacific and is processing after fixing the build 5 resource-bundle
identifier rejection.
App Store Connect’s three errors are the current portal blockers, not a substitute
for purchase testing or any requirements exposed after build processing.

Focused re-verification: 33 auth, AI agreement, sandbox, payment, and review-account
tests passed. Universal build 5 packaging and local signature checks passed.

## Remaining steps before submission and release

1. Verify the dedicated email login in the distribution binary; login and session
   persistence have been verified in the existing development app.
2. Verify subscription, pack quantity, cancellation,
   restored balances, and native capture with the reviewer account in the
   production binary before submission. Reviewer billing enrollment is complete.
   Do not add personal or paying accounts: reviewers always use sandbox balances.
3. Confirm and publish the privacy draft; the website policy is now deployed.
   Complete content rights, export compliance, availability, and any outstanding
   Apple business requirements. No agreements were accepted during preparation.
4. Validate/upload **Audeeo-6.pkg** using the signed-in Apple upload tooling, wait
   for processing, select build 6, and attach the purchase products. Keep manual
   release selected. Uploading is separate from submitting for review.
5. After product approval and final billing verification, change the relay's
   `MINUTE_PACKS_ENABLED` to `true`, deploy and verify the public account response
   before manually releasing the app. Keep reconciliation/refunds running if
   checkout must be rolled back. Do not announce pack purchases while the gate
   remains false.

## Version description

Audeeo turns speech and desktop audio into live captions and translations. Keep captions in a floating panel while you watch a presentation, join a meeting, or listen to a lecture. Choose microphone, desktop, or application audio, adjust caption appearance, and add context for names and specialized terminology.

Translate captions and optionally hear spoken translations. Add context manually, from a link, or from a screen capture you initiate. With Save sessions enabled, completed sessions sync across devices signed into the same account and expire after 30 days. Generate session summaries and ask questions about a transcript.

Start with 30 free usage minutes per account. Audeeo Pro costs $8/month or $80/year in the United States and includes 600 usage minutes each monthly allowance period on either plan. Included minutes do not roll over. You can also buy 60, 180, or 600 usage minutes without a subscription. Purchased minutes do not expire. Captions and translated text use 1 usage minute per minute; spoken translation uses 3. Prices vary by region and are shown before purchase. Subscriptions renew automatically unless cancelled.

Cloud features require an internet connection and agreement to processing by the named AI providers. AI output may contain errors.

Privacy policy: https://audeeo.app/privacy

Terms of use: https://audeeo.app/terms

Apple standard EULA: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

## App Review notes

Audeeo is a macOS captioning and translation app. For review, choose Continue with email and use the dedicated Audeeo credentials in Sign-In Information. These credentials are for Audeeo only; do not use Google sign-in. Complete the AI agreement, then continue with the free allowance. A subscription is not required to enter the app or to use purchased minute packs.

To test captions, select microphone, desktop, or application audio and start a session. macOS requests microphone or screen/audio capture permission for the selected source. Play speech in the selected source. The floating caption panel uses public AppKit APIs. Select source and target languages to test text translation; enable spoken translation in the audio controls to hear translated speech.

The AI agreement covers audio and context processing by Soniox and OpenAI, including summaries, transcript questions, and screen context. Fill from screen captures only when explicitly initiated by the user. Save sessions synchronizes completed sessions and expires saved history after 30 days.

Free accounts receive 30 usage minutes once. Pro includes 600 usage minutes per monthly allowance period on either plan length. Captions use 1x usage; spoken translation uses 3x. The 60, 180, and 600-minute consumables can be bought without Pro, in quantities of 1–10. Remaining allowance and purchased minutes are shown together in Account settings.

Account settings include Restore purchases, Manage subscription, and Delete account. Apple-linked account deletion may require reconnecting with Apple to revoke authorization. Deleting an Audeeo account does not cancel an Apple subscription.

## Privacy evidence

Names/emails/profile images are supplied by sign-in providers and kept with the
account. Purchase history and usage counters fund and meter the account. Audio,
screenshots and user context are processed by the configured AI services; saved
transcripts, translations and summaries are stored against the account. The
declaration conservatively includes provider handling and does not claim that
all transient inputs are exempt from disclosure. Confirm provider retention and
any operational analytics changes before publishing the declarations.

References: [Apple privacy definitions](https://developer.apple.com/app-store/app-privacy-details/),
[RevenueCat sandbox behavior](https://www.revenuecat.com/docs/test-and-launch/sandbox),
[Apple submission workflow](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).

Additional billing validation: 38 focused payment/review/UI tests passed; the strengthened ownership regression file passed all 19 tests; relay typechecking passed. No database schema changes were needed. The user requested stopping additional tests and prioritizing submission; remaining work is the Apple portal declarations and authenticated upload/processing of build 5.
