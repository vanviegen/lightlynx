const fs = require('fs');

const scriptId = process.argv[2] || process.env.BUNNY_SSL_SCRIPT_ID;
const accessKey = process.argv[3] || process.env.BUNNY_ACCESS_KEY;
const filename = process.argv[4] || 'src/backend/cert.ts';

if (!scriptId || !accessKey) {
    console.error('Usage: node deploy-bunny-script.cjs <script_id> <access_key> [filename]');
    console.error('Or set BUNNY_SSL_SCRIPT_ID and BUNNY_ACCESS_KEY environment variables.');
    process.exit(1);
}

const code = fs.readFileSync(filename, 'utf8');

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

    let res = await fetch(`https://api.bunny.net/compute/script/${scriptId}/code`, {
        method: 'POST',
        headers: {
            'AccessKey': accessKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ Code: code })
    });

    if (res.status != 204) {
        console.log(`Code push failed: ${res.status}`);
        console.log(await res.text());
        process.exit(1);
    }

    res = await fetch(`https://api.bunny.net/compute/script/${scriptId}/publish`, {
        method: 'POST',
        headers: {
            'AccessKey': accessKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });

    if (res.status != 204) {
        console.log(`Publish code failed: ${res.status}`);
        console.log(await res.text());
        process.exit(1);
    }

    console.log("Done!");
})();
