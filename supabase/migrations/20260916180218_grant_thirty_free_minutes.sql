-- One lifetime allowance per account. Existing consumption remains deducted;
-- refreshing, restoring purchases, or changing plans must not grant it again.
update public.billing_settings
set free_seconds = 1800
where singleton;
