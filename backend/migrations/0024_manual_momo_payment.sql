-- Manual Mobile Money payment: customer pays a merchant number and declares the
-- transfer reference; staff verify then validate (tickets + e-mail) or reject.
-- An order is "to verify" when status = 'pending' AND manual_payment_ref IS NOT NULL.
ALTER TABLE orders ADD COLUMN manual_operator TEXT;
ALTER TABLE orders ADD COLUMN manual_payment_ref TEXT;
ALTER TABLE orders ADD COLUMN manual_payment_phone TEXT;
ALTER TABLE orders ADD COLUMN verified_at TEXT;
ALTER TABLE orders ADD COLUMN verified_by TEXT;
ALTER TABLE orders ADD COLUMN rejection_reason TEXT;

-- A transfer reference can back only one live (pending or paid) order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_manual_payment_ref_active
    ON orders (manual_payment_ref)
    WHERE manual_payment_ref IS NOT NULL AND status IN ('pending', 'paid');
