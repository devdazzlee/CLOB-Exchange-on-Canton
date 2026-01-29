const config = require('./src/config');
const CantonAdmin = require('./src/services/canton-admin');
const path = require('path');

async function main() {
    try {
        require('dotenv').config();
        const admin = new CantonAdmin();

        console.log('Fetching admin token...');
        const token = await admin.getAdminToken();
        console.log('Token obtained.');

        const darPath = path.resolve('../.daml/dist/clob-exchange-splice-1.0.0.dar');
        console.log(`Uploading DAR from: ${darPath}`);

        await admin.uploadDar(darPath, token);
        console.log('✅ DAR Uploaded Successfully');

    } catch (error) {
        console.error('ERROR:', error);
    }
}

main();
