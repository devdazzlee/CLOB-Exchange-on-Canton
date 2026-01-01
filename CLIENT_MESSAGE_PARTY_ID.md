# Message to Client - Party ID Mismatch

---

Hi Huzefa,

I've updated the code to use `filtersByParty` instead of `filtersForAnyParty`, but I'm still getting 403 errors.

I noticed that my wallet's party ID might be different from the one that has rights configured.

**My wallet public key**: `d14bd7fd5bdb59b4da7e93a4c66f61b93cfffbc0f19b2b8db4a1031eaca0509e`

**My party ID would be**: `8100b2db-86cf-40a1-8351-55483c151cdc::d14bd7fd5bdb59b4da7e93a4c66f61b93cfffbc0f19b2b8db4a1031eaca0509e`

**But you showed rights for**: `8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292`

These are different party IDs. Can you either:

1. **Grant `can_read_as` rights** for my actual party ID: `8100b2db-86cf-40a1-8351-55483c151cdc::d14bd7fd5bdb59b4da7e93a4c66f61b93cfffbc0f19b2b8db4a1031eaca0509e`

OR

2. **Tell me what party ID** I should be using from the wallet UI?

The token is valid and has the correct scopes, but the party ID mismatch is causing the 403 errors.

Thanks!

---



