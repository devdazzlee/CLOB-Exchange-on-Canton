const config = require('./src/config');
const cantonService = require('./src/services/cantonService');
const tokenProvider = require('./src/services/tokenProvider');

async function main() {
    try {
        require('dotenv').config();

        console.log('Fetching token...');
        const token = await tokenProvider.getServiceToken();
        console.log('Token obtained:', token.substring(0, 20) + '...');

        const hint = 'clob-operator-' + Date.now().toString().slice(-4);
        console.log(`Allocating party with hint: ${hint}...`);

        try {
            const partyDetails = await cantonService.allocateExternalParty({
                partyIdHint: hint,
                annotations: { app: 'clob-exchange' }
            }, token);

            console.log('ALLOCATED PARTY:', JSON.stringify(partyDetails, null, 2));
        } catch (e) {
            console.error('Allocation failed:', e.message);
            // Fallback: List parties to see if we have one to use
            console.log('Listing existing parties...');
            const parties = await cantonService.listParties(token);
            console.log('Existing parties:', parties.map(p => p.party));
        }

    } catch (error) {
        console.error('ERROR:', error);
    }
}

main();
