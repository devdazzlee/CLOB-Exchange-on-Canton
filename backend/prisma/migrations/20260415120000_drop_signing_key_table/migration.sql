-- Non-custodial policy: never persist user private keys server-side.
-- SigningKey table removed; use browser-only signing + signature payloads to API.

DROP TABLE IF EXISTS "SigningKey";
