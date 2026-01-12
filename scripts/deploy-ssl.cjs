const fs = require('fs');

const code = fs.readFileSync('src/backend/create-ssl-domain.ts', 'utf8');
const scriptId = process.env.BUNNY_SSL_SCRIPT_ID;
const accessKey = process.env.BUNNY_ACCESS_KEY;

if (!scriptId || !accessKey) {
    console.error('Error: BUNNY_SSL_SCRIPT_ID or BUNNY_ACCESS_KEY not set.');
    process.exit(1);
}

const data = JSON.stringify({ Code: code });

(async () => {
    const getRes = await fetch(`https://api.bunny.net/compute/script/${scriptId}/code`, {
        headers: {
            'AccessKey': accessKey,
            'Accept': 'application/json'
        }
    });

    if (getRes.ok) {
        const current = await getRes.json();
        if (current.Code === code) {
            console.log("No changes detected, skipping update.");
            return;
        }
    }

    const res = await fetch(`https://api.bunny.net/compute/script/${scriptId}/code`, {
        method: 'POST',
        headers: {
            'AccessKey': accessKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: data
    });

    if (res.status == 204) {
        console.log("Updated!");
    } else {
        console.log(`Status: ${res.status}`);
        console.log(await res.text());
        process.exit(1);
    }
})();
