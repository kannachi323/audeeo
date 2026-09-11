#!/usr/bin/env python3
"""Compute sustainable included-minute economics from a measured session; never set live prices."""
import argparse,json
p=argparse.ArgumentParser();p.add_argument('metrics');p.add_argument('--included-minutes',type=float,required=True);p.add_argument('--store-fee',type=float,required=True);p.add_argument('--target-margin',type=float,required=True);p.add_argument('--overhead-per-subscriber',type=float,required=True);args=p.parse_args()
m=json.load(open(args.metrics))
if not m.get('measured') or not m.get('sessionSeconds'):raise SystemExit('A measured session is required. No commercial price recommendation is available yet.')
provider=m['recognitionBilledSeconds']/60*.0077 + (m['translationInputTokens']*.16+m['translationOutputTokens']*.49)/1e6 + m['spokenCharacters']/10000*.13
hour=(provider+m['relayAndHistoryCostUSD'])*3600/m['sessionSeconds']
net=1-args.store_fee-args.target_margin
if net<=0:raise SystemExit('Store fee plus margin must be less than 1.')
print(json.dumps({'regularRateRegion':'Deepgram US / Qwen Singapore','measuredCostPerSessionHourUSD':hour,'minimumMonthlyPriceAtFullAllowanceUSD':(hour*args.included_minutes/60+args.overhead_per_subscriber)/net,'includedMinutes':args.included_minutes,'rollover':False,'status':'recommendation only; taxes, refunds, free-tier subsidy and RevenueCat fees must be included in overhead'},indent=2))
