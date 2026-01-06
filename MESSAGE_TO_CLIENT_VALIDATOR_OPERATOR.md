# Message to Client - Using Validator-Operator for Party Assignment

---

Hi,

I've updated the code to use validator-operator's user for assigning external parties, as you requested. Here's what changed:

**What's New:**

Instead of creating a new Keycloak user for each party, the system now:
1. Assigns parties to the validator-operator user via Canton's UserManagementService
2. Generates tokens for validator-operator with the party included in the actAs claim
3. Allows multiple parties to be assigned to a single validator-operator user

**Technical Details:**

- The `/api/create-party` endpoint now uses `UserManagementService.GrantUserRights` to assign `CanActAs` rights for each party to the validator-operator user
- Token generation uses the validator-app service account (client_credentials grant) to get a token for validator-operator
- All parties are now managed under the validator-operator user instead of creating separate users

**Testing:**

The endpoint should work the same way from the frontend perspective - you still call `/api/create-party` with a public key, and it returns a token. The difference is that all tokens are now for the validator-operator user with different parties assigned.

Let me know if you'd like me to test this or if you have any questions.

Thanks!

---

