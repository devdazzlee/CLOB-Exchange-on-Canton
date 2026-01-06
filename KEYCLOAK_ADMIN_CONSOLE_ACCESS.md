# 🔧 How to Access Keycloak Admin Console

## Current Location
You're currently at: **User Account Page** (`/account/applications`)
This is for managing YOUR applications, not configuring Keycloak clients.

## What You Need
**Admin Console** - Where you configure clients, redirect URIs, etc.

## Steps to Access Admin Console

### Step 1: Go to Admin Console URL
Navigate directly to:
```
https://keycloak.wolfedgelabs.com:8443/admin
```

### Step 2: Login
- Username: `zoya`
- Password: `Zoya123!`

### Step 3: Select Realm
- In the top-left dropdown, select: **canton-devnet**

### Step 4: Navigate to Clients
- In the left sidebar, click **"Clients"** (not "Applications")
- This shows all configured clients in the realm

### Step 5: Find Your Client
- Look for client ID: `4roh9X7y4TyT89feJu7AnM2sMZbR9xh7`
- Click on it

### Step 6: Add Redirect URI
- Click **Settings** tab
- Scroll to **Valid redirect URIs**
- Click **Add valid redirect URI**
- Enter: `http://localhost:3000/auth/callback`
- Click **Save**

## Visual Guide

```
Current Page (Wrong):
https://keycloak.wolfedgelabs.com:8443/realms/canton-devnet/account/applications
                                                          ^^^^^^
                                                          User account page

Admin Console (Correct):
https://keycloak.wolfedgelabs.com:8443/admin
                                      ^^^^^^
                                      Admin console
```

## Difference

**Account Page** (`/account/*`):
- User-facing
- Shows YOUR applications
- Can't configure clients
- Can't add redirect URIs

**Admin Console** (`/admin`):
- Admin-facing
- Configure clients, realms, users
- Can add redirect URIs
- Full configuration access

## Quick Link
Click this link to go directly to Admin Console:
[Open Admin Console](https://keycloak.wolfedgelabs.com:8443/admin)



