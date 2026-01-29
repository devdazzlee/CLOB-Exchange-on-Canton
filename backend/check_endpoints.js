require('dotenv').config();
const config = require('./src/config');
const tokenProvider = require('./src/services/tokenProvider');

async function testEndpoints() {
    try {
        const token = await tokenProvider.getServiceToken();
        const base = config.canton.jsonApiBase;

        const endpoints = [
            '/v2/synchronizers',
            '/v2/parties',
            '/v2/packages',
            '/livez',
            '/readyz'
        ];

        console.log(`Testing endpoints on ${base} with token prefix ${token.substring(0, 10)}...`);

        for (const ep of endpoints) {
            console.log(`\n--- Testing GET ${ep} ---`);
            try {
                const res = await fetch(`${base}${ep}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                console.log(`Status: ${res.status} ${res.statusText}`);
                const text = await res.text();
                console.log(`Body: ${text.substring(0, 500)}`);
            } catch (e) {
                console.log(`Error: ${e.message}`);
            }
        }

    } catch (error) {
        console.error('Setup Error:', error);
    }
}

testEndpoints();
