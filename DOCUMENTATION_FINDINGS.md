# Daml Enterprise 2.10.2 Documentation Findings

## Key Findings

### 1. Party Allocation Methods

The documentation reveals **two different APIs** for party management:

#### A. Canton Admin API (Console Commands)
- **Purpose**: Node administration (managing participants, domains, etc.)
- **Access**: Via Canton console commands
- **Method**: `parties.enable` - registers a party with the participant
- **Note**: This is for **internal party management**, not HTTP REST API

#### B. Ledger API Admin Package (gRPC)
- **Purpose**: Party allocation on the ledger
- **Service**: `PartyManagementService`
- **Method**: `AllocateParty`
- **Protocol**: **gRPC** (NOT HTTP REST)
- **Authorization**: Requires `ParticipantAdmin` right OR `IdentityProviderAdmin`
- **Endpoint**: This is a gRPC service, not an HTTP endpoint

### 2. Important Distinction

**From Documentation (line 59575-59579):**
> "Note: Canton's Admin APIs must not be confused with the admin package of the Ledger API. The admin package of the Ledger API provides services for managing parties and packages on any Daml participant. Canton's Admin APIs allows you to administrate Canton-based nodes."

**Key Points:**
- **Canton Admin API** = Node administration (console commands)
- **Ledger API Admin Package** = Party/package management (gRPC service)

### 3. Party Allocation Details

**From Documentation (lines 20020-20033):**
```
AllocateParty method, v1/admin
Allocates a new party on a ledger and adds it to the set managed by the participant. 
Caller specifies a party identifier suggestion, the actual identifier allocated might 
be different and is implementation specific.

Authorization: HasRight(ParticipantAdmin) OR IsAuthenticatedIdentityProviderAdmin(identity_provider_id)

Request: AllocatePartyRequest
  - party_id_hint: string (Optional)
  - display_name: string (Optional)
  - local_metadata: ObjectMeta (Optional)
  - identity_provider_id: string (Optional)

Response: AllocatePartyResponse
  - party_details: PartyDetails
```

**Important Notes:**
- This is a **gRPC service**, not HTTP REST
- The party_id_hint is just a suggestion - Canton may allocate a different ID
- Requires `ParticipantAdmin` or `IdentityProviderAdmin` permissions

### 4. Client Controlled Party (External Parties)

**From Documentation (lines 84740-84839):**
- This is a complex process for creating parties in a different namespace
- Requires:
  1. Client creates a signing key
  2. Client creates root certificate
  3. Client creates party delegation
  4. Hosting node imports certificates
  5. Hosting node enables the party

This might be what the client means by "external parties" - parties not in the participant's namespace.

### 5. HTTP JSON API

**From Documentation:**
- The HTTP JSON API is for **querying and submitting commands**, not party allocation
- It's a "proxy" to the Ledger API
- Does NOT provide party allocation endpoints

## Current Implementation Issues

### Issue 1: Wrong API Type
**Current Code:** Trying to use HTTP REST endpoint `/v1/parties/allocate`
**Reality:** Party allocation is via **gRPC** using `PartyManagementService.AllocateParty`

### Issue 2: Wrong Endpoint
**Current Code:** `http://95.216.34.215:30100/v1/parties/allocate`
**Reality:** 
- Port 30100 is the **Canton Admin API** (for console commands, not HTTP REST)
- Party allocation should use the **Ledger API** (port 31217) via **gRPC**
- OR use the JSON API if it has a party allocation endpoint (needs verification)

### Issue 3: Authorization
**Current Code:** Using validator-app token
**Reality:** Token needs `ParticipantAdmin` right OR `IdentityProviderAdmin` for the identity provider

## Recommended Solutions

### Option 1: Use Ledger API gRPC (Recommended)
Use the gRPC `PartyManagementService.AllocateParty` method:
- **Endpoint**: `95.216.34.215:31217` (Ledger API port)
- **Service**: `com.daml.ledger.api.v1.admin.PartyManagementService`
- **Method**: `AllocateParty`
- **Protocol**: gRPC
- **Authorization**: Bearer token with `ParticipantAdmin` right

### Option 2: Use JSON API (If Available)
Check if the JSON API (port 31539) has a party allocation endpoint:
- **Endpoint**: `http://95.216.34.215:31539/v1/parties/allocate` (needs verification)
- **Method**: POST
- **Authorization**: Bearer token

### Option 3: Use Canton Console Commands
If HTTP access is not available, use Canton console:
```scala
participant.parties.enable(partyId, displayName)
```

## What We Need to Verify

1. **Does the JSON API (port 31539) support party allocation?**
   - Check if there's an HTTP endpoint for party allocation
   - Verify the correct URL path

2. **What permissions does validator-app token have?**
   - Does it have `ParticipantAdmin` right?
   - Does it have `IdentityProviderAdmin` for the identity provider?

3. **Are we trying to create "external parties" or regular parties?**
   - If external parties, we need the client-controlled party process
   - If regular parties, we can use `AllocateParty`

4. **Can we use gRPC from Node.js?**
   - Need to install gRPC client library
   - Or use a gRPC-to-HTTP proxy if available

## Next Steps

1. **Check JSON API documentation** for party allocation endpoint
2. **Verify validator-app token permissions** - does it have ParticipantAdmin?
3. **Decide on approach**: gRPC vs HTTP (if available) vs Console commands
4. **Update implementation** based on findings

## References

- **PartyManagementService**: Lines 19982-20081
- **Canton Admin API**: Lines 59555-59583
- **Client Controlled Party**: Lines 84740-84839
- **Ledger API Admin Package**: Lines 59575-59579

