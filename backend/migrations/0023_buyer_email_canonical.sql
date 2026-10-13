-- pg-only
-- Canonicalisation a l'ecriture via auth.email_canonical (application).
-- Ne pas mass-UPDATE buyer_email ici : risque de violation idx_orders_event_buyer_email_active
-- (ex. pentest-sec@ et pentest-sec+1@). Nettoyage manuel : docs/PENTEST-CLEANUP.md
SELECT 1;
