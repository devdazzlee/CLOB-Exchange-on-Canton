// Keycloak Protocol Mapper Configuration
// Add this to your Keycloak realm configuration

const keycloakConfig = {
  realm: 'canton-devnet',
  clientId: 'your-client',
  mappers: [
    {
      name: 'Canton Party ID',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-attribute-mapper',
      config: {
        'user.attribute': 'cantonPartyId',
        'claim.name': 'canton_party_id',
        'jsonType.label': 'String',
        'access.token.claim': 'true',
        'id.token.claim': 'true'
      }
    },
    {
      name: 'DAML Ledger API Scope',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.value': 'daml_ledger_api',
        'claim.name': 'scope',
        'jsonType.label': 'String',
        'access.token.claim': 'true'
      }
    },
    {
      name: 'DAML actAs Claims',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.value': '["8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"]',
        'claim.name': 'actAs',
        'jsonType.label': 'JSON',
        'access.token.claim': 'true'
      }
    },
    {
      name: 'DAML readAs Claims',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.value': '["8100b2db-86cf-40a1-8351-55483c151cdc::122087fa379c37332a753379c58e18d397e39cb82c68c15e4af7134be46561974292"]',
        'claim.name': 'readAs',
        'jsonType.label': 'JSON',
        'access.token.claim': 'true'
      }
    }
  ]
};

// Instructions for Keycloak setup:
/*
1. Go to Keycloak Admin Console
2. Select your realm (canton-devnet)
3. Go to Clients → Your Client
4. Go to Mappers tab
5. Click "Create" for each mapper above
6. Configure with the settings shown
7. Save and test

Note: This is an alternative to the backend token exchange approach.
The backend approach is more secure and flexible for production.
*/
