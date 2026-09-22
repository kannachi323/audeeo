
export function SubscriptionDisclosure({apple=true}:{apple?:boolean}) {
  return <div className="subscription-disclosure">
    <p className="subscription-allowance"><strong>600 usage minutes / month</strong><span>Included with both plans</span></p>
    <p>Cloud caption minutes reset monthly and do not roll over. Captions use 1× minutes; spoken translation uses 3×. After your allowance, choose whether to use purchased minutes.</p>
    <p>{apple ? 'Payment is charged to your Apple Account. Your subscription renews automatically unless cancelled at least 24 hours before the period ends. Renewal is charged within the final 24 hours. Manage or cancel in your Apple Account subscription settings.' : 'Your subscription renews automatically until cancelled. Manage or cancel using your billing email or account settings.'}</p>
  </div>;
}
