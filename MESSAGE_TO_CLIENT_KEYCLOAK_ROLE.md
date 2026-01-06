# Message to Client - Keycloak Service Account Role Configuration

---

Hi,

I found the issue. The validator-app service account you shared works for authentication, but it doesn't have permission to create users in Keycloak. The error we're getting is that the service account "Sesnp3u6udkFF983rfprvsBbx3X3mBpw" doesn't have the "manage-users" role, so it can't create users.

Can you assign the "manage-users" role to the validator-app service account? To do this, open Keycloak Admin Console at https://keycloak.wolfedgelabs.com:8443, go to Clients, find "Sesnp3u6udkFF983rfprvsBbx3X3mBpw" which is the validator-app, open the "Service Account Roles" tab, click "Assign Role", filter by clients and select "realm-management", then select the "manage-users" role and click Assign and Save.

The reason we need this is because our backend creates a Keycloak user for each party and generates a token for them. Without the manage-users role, the service account can't create users, which blocks the entire party creation process.

Once you've assigned the role, let me know and I'll test it. It should work right away after that.

Thanks!

---
