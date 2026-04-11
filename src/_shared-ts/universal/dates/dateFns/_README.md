---
created: 2023-03-14
---

# Migrating away from date-fns

## Why?

1 - When trying to upgrade from Deno 1.30.3 to 1.31.x, tests break because of some dateFns typescript fuckery.

2 - date-fns no longer seems maintained. Surprisingly, the last commit was 6+ months ago on either 2.x or 3.x.

3 - Bringing this in-house will allow me to migrate to Temporal API easier when that gets released.
