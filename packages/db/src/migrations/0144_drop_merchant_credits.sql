-- Release 2 of the credit unification. 0143 folded every merchant_credits
-- balance into the owning user's user_credits row and wrote a
-- MERCHANT_CREDITS_MIGRATION ledger entry for each. Both tables have been
-- unread and unwritten since that release deployed and production balances
-- were verified, so they can now go.
--
-- merchant_payments is deliberately retained: merchants keep their own Razorpay
-- checkout and their own MERCHANT_PLAN_BILLING pricing. Only the credit
-- destination moved.

DROP TABLE IF EXISTS "merchant_credit_ledger";
DROP TABLE IF EXISTS "merchant_credits";
