-- pg-only
-- Canonicalize stored buyer emails (lower case, strip +tags, Gmail dot folding).
-- SQLite test databases skip this file; new orders are canonicalized in application code.
UPDATE orders o
SET buyer_email = sub.canon
FROM (
    SELECT
        id,
        lower(
            CASE
                WHEN lower(trim(split_part(buyer_email, '@', 2))) IN ('gmail.com', 'googlemail.com') THEN
                    regexp_replace(
                        regexp_replace(split_part(trim(buyer_email), '@', 1), '\+.*$', ''),
                        '\.',
                        '',
                        'g'
                    )
                ELSE
                    regexp_replace(split_part(trim(buyer_email), '@', 1), '\+.*$', '')
            END || '@' || lower(trim(split_part(buyer_email, '@', 2)))
        ) AS canon
    FROM orders
    WHERE buyer_email LIKE '%@%'
) sub
WHERE o.id = sub.id
  AND o.buyer_email IS DISTINCT FROM sub.canon;
