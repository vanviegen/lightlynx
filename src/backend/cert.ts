// @ts-ignore
import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.11.2";
// @ts-ignore
import { createClient } from "https://esm.sh/@libsql/client@0.15.2/web";

// ============================================================================
// CONFIGURATION
// ============================================================================

const DOMAIN = "lightlynx.eu";
const BUNNY_DNS_API_BASE = "https://api.bunny.net";
const ACME_DIRECTORY_URL = "https://acme-v02.api.letsencrypt.org/directory";
// For testing, use: "https://acme-staging-v02.api.letsencrypt.org/directory"

const CERT_VALIDITY_DAYS = 90;

// CORS headers for browser requests (app subdomain only)
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": `https://app.${DOMAIN}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// Secrets from environment
// @ts-ignore
const BUNNY_DNS_ZONE_ID: string = process.env.BUNNY_DNS_ZONE_ID;
// @ts-ignore
const BUNNY_ACCESS_KEY: string = process.env.BUNNY_ACCESS_KEY;
// @ts-ignore
const CERT_SERVER_SECRET: string = process.env.CERT_SERVER_SECRET;
// @ts-ignore
const BUNNY_DB_URL: string = process.env.BUNNY_DB_URL;
// @ts-ignore
const BUNNY_DB_TOKEN: string = process.env.BUNNY_DB_TOKEN;

const db = createClient({ url: BUNNY_DB_URL, authToken: BUNNY_DB_TOKEN });

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function generateKeyPair(): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-256",
        },
        true,
        ["sign", "verify"]
    );
}

async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey(
        {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
    );
}

async function exportPrivateKeyPEM(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey("pkcs8", key);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array | string): string {
    let bytes: Uint8Array;
    if (typeof data === "string") {
        bytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
    } else {
        bytes = data;
    }
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ============================================================================
// ASN.1 DER ENCODING UTILITIES
// ============================================================================

class DERBuilder {
    static integer(value: number | Uint8Array): Uint8Array {
        let bytes: Uint8Array;
        if (typeof value === 'number') {
            if (value === 0) {
                bytes = new Uint8Array([0]);
            } else {
                const hex = value.toString(16);
                const hexPadded = hex.length % 2 ? '0' + hex : hex;
                bytes = new Uint8Array(hexPadded.match(/.{2}/g)!.map(b => parseInt(b, 16)));
                // Add leading zero if high bit is set (to indicate positive number)
                if (bytes.length > 0 && bytes[0]! & 0x80) {
                    const padded = new Uint8Array(bytes.length + 1);
                    padded[0] = 0;
                    padded.set(bytes, 1);
                    bytes = padded;
                }
            }
        } else {
            bytes = value;
            // Add leading zero if high bit is set
            if (bytes.length > 0 && bytes[0]! & 0x80) {
                const padded = new Uint8Array(bytes.length + 1);
                padded[0] = 0;
                padded.set(bytes, 1);
                bytes = padded;
            }
        }
        return this.wrap(0x02, bytes);
    }

    static bitString(data: Uint8Array, unusedBits: number = 0): Uint8Array {
        const content = new Uint8Array(data.length + 1);
        content[0] = unusedBits;
        content.set(data, 1);
        return this.wrap(0x03, content);
    }

    static octetString(data: Uint8Array): Uint8Array {
        return this.wrap(0x04, data);
    }

    static null_(): Uint8Array {
        return new Uint8Array([0x05, 0x00]);
    }

    static objectIdentifier(oid: string): Uint8Array {
        const parts = oid.split('.').map(Number);
        const bytes: number[] = [];
        
        // First two components are encoded as 40*first + second
        bytes.push(40 * (parts[0] || 0) + (parts[1] || 0));
        
        // Remaining components
        for (let i = 2; i < parts.length; i++) {
            let value = parts[i]!;
            if (value < 128) {
                bytes.push(value);
            } else {
                const encoded: number[] = [];
                while (value > 0) {
                    encoded.unshift((value & 0x7f) | (encoded.length > 0 ? 0x80 : 0));
                    value >>= 7;
                }
                bytes.push(...encoded);
            }
        }
        
        return this.wrap(0x06, new Uint8Array(bytes));
    }

    static utf8String(str: string): Uint8Array {
        return this.wrap(0x0c, new TextEncoder().encode(str));
    }

    static ia5String(str: string): Uint8Array {
        // IA5String is ASCII-only, tag 0x16
        return this.wrap(0x16, new TextEncoder().encode(str));
    }

    static sequence(items: Uint8Array[]): Uint8Array {
        return this.wrap(0x30, this.concat(items));
    }

    static set(items: Uint8Array[]): Uint8Array {
        return this.wrap(0x31, this.concat(items));
    }

    static contextSpecific(tag: number, data: Uint8Array, constructed: boolean = true): Uint8Array {
        const tagByte = 0x80 | (constructed ? 0x20 : 0) | tag;
        return this.wrap(tagByte, data);
    }

    private static wrap(tag: number, content: Uint8Array): Uint8Array {
        const length = content.length;
        let header: Uint8Array;

        if (length < 128) {
            header = new Uint8Array([tag, length]);
        } else if (length < 256) {
            header = new Uint8Array([tag, 0x81, length]);
        } else if (length < 65536) {
            header = new Uint8Array([tag, 0x82, (length >> 8) & 0xff, length & 0xff]);
        } else {
            header = new Uint8Array([tag, 0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
        }

        const result = new Uint8Array(header.length + content.length);
        result.set(header);
        result.set(content, header.length);
        return result;
    }

    private static concat(arrays: Uint8Array[]): Uint8Array {
        const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }
}

// ============================================================================
// BUNNY DNS API
// ============================================================================

interface BunnyDNSRecord {
    Id: number;
    Type: number;
    Ttl: number;
    Value: string;
    Name: string;
}

async function bunnyDNSRequest(
    method: string,
    path: string,
    body?: unknown
): Promise<Response> {
    const url = `${BUNNY_DNS_API_BASE}${path}`;

    const headers: Record<string, string> = {
        AccessKey: BUNNY_ACCESS_KEY,
        "Content-Type": "application/json",
    };

    const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    return response;
}

async function createDNSRecord(
    zoneId: string,
    type: number,
    name: string,
    value: string,
    ttl: number = 300
): Promise<BunnyDNSRecord> {
    const response = await bunnyDNSRequest("PUT", `/dnszone/${zoneId}/records`, {
        Type: type,
        Ttl: ttl,
        Value: value,
        Name: name,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to create DNS record: ${response.status} ${text}`);
    }

    return await response.json();
}

async function getDNSRecords(zoneId: string): Promise<BunnyDNSRecord[]> {
    const response = await bunnyDNSRequest("GET", `/dnszone/${zoneId}`);
    if (!response.ok) {
        throw new Error(`Failed to get DNS records: ${response.status}`);
    }
    const data = await response.json();
    return data.Records || [];
}

async function deleteDNSRecord(zoneId: string, recordId: number): Promise<void> {
    const response = await bunnyDNSRequest(
        "DELETE",
        `/dnszone/${zoneId}/records/${recordId}`
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to delete DNS record: ${response.status} ${text}`);
    }
}


async function setTXTRecords(
    zoneId: string,
    names: string[],
    values: string[]
): Promise<number[]> {
    const records = await getDNSRecords(zoneId);
    const recordIds: number[] = [];

    for (let i = 0; i < names.length; i++) {
        const existingTXT = records.filter(
            (r) => r.Type === 3 && r.Name === names[i]
        );
        for (const record of existingTXT) {
            await deleteDNSRecord(zoneId, record.Id);
        }
        const newRecord = await createDNSRecord(zoneId, 3, names[i]!, values[i]!, 60);
        recordIds.push(newRecord.Id);
    }
    return recordIds;
}

/** Upsert A records: for each name/value pair, delete existing A records with that name, then create new one. */
async function setARecords(
    zoneId: string,
    entries: { name: string; value: string; ttl?: number }[]
): Promise<void> {
    const records = await getDNSRecords(zoneId);
    for (const entry of entries) {
        const existing = records.filter(
            (r) => r.Type === 0 && r.Name === entry.name
        );
        for (const record of existing) {
            // Only delete+recreate if value changed
            if (record.Value === entry.value && record.Ttl === (entry.ttl || 300)) continue;
            await deleteDNSRecord(zoneId, record.Id);
        }
        // Check if record already exists with correct value
        const alreadyCorrect = existing.some(r => r.Value === entry.value && r.Ttl === (entry.ttl || 300));
        if (!alreadyCorrect) {
            await createDNSRecord(zoneId, 0, entry.name, entry.value, entry.ttl || 300);
        }
    }
}

function generateInstanceId(): string {
    // Generate a short but very likely unique code: [a-z][a-z0-9]{5}
    // 26 * 36^5 = ~1.6 billion possibilities
    const first = 'abcdefghijklmnopqrstuvwxyz';
    const rest = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = first[Math.floor(Math.random() * first.length)]!;
    for (let i = 0; i < 5; i++) {
        code += rest[Math.floor(Math.random() * rest.length)];
    }
    return code;
}

// ============================================================================
// INSTANCE KEY AUTHENTICATION
// ============================================================================

async function generateInstanceKey(instanceId: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(CERT_SERVER_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(instanceId)
    );
    return base64UrlEncode(signature);
}

async function verifyInstanceKey(instanceId: string, instanceKey: string): Promise<boolean> {
    const expected = await generateInstanceKey(instanceId);
    return expected === instanceKey;
}

// ============================================================================
// ACME / LET'S ENCRYPT IMPLEMENTATION
// ============================================================================

interface ACMEDirectory {
    newNonce: string;
    newAccount: string;
    newOrder: string;
    revokeCert: string;
    keyChange: string;
}

interface ACMEOrder {
    status: string;
    expires: string;
    identifiers: { type: string; value: string }[];
    authorizations: string[];
    finalize: string;
    certificate?: string;
}

interface ACMEAuthorization {
    identifier: { type: string; value: string };
    status: string;
    challenges: ACMEChallenge[];
}

interface ACMEChallenge {
    type: string;
    url: string;
    status: string;
    token: string;
}

class ACMEClient {
    private directory: ACMEDirectory | null = null;
    private accountUrl: string | null = null;
    private accountKey: CryptoKeyPair | null = null;
    private nonce: string | null = null;

    async init(): Promise<void> {
        const response = await fetch(ACME_DIRECTORY_URL);
        this.directory = await response.json();
        this.accountKey = await generateKeyPair();
    }

    private async getNonce(): Promise<string> {
        if (this.nonce) {
            const nonce = this.nonce;
            this.nonce = null;
            return nonce;
        }
        const response = await fetch(this.directory!.newNonce, { method: "HEAD" });
        return response.headers.get("replay-nonce")!;
    }

    private async getJWK(): Promise<object> {
        const publicKey = await crypto.subtle.exportKey("jwk", this.accountKey!.publicKey);
        return {
            kty: publicKey.kty,
            crv: publicKey.crv,
            x: publicKey.x,
            y: publicKey.y,
        };
    }

    private async getThumbprint(): Promise<string> {
        const jwk = await this.getJWK();
        const ordered = JSON.stringify({
            crv: (jwk as any).crv,
            kty: (jwk as any).kty,
            x: (jwk as any).x,
            y: (jwk as any).y,
        });
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ordered));
        return base64UrlEncode(hash);
    }

    private async signedRequest(
        url: string,
        payload: unknown,
        useJWK: boolean = false
    ): Promise<Response> {
        const nonce = await this.getNonce();

        const protectedHeader: Record<string, unknown> = {
            alg: "ES256",
            nonce,
            url,
        };

        if (useJWK) {
            protectedHeader.jwk = await this.getJWK();
        } else {
            protectedHeader.kid = this.accountUrl;
        }

        const protectedB64 = base64UrlEncode(JSON.stringify(protectedHeader));
        const payloadB64 = payload === "" ? "" : base64UrlEncode(JSON.stringify(payload));

        const signatureInput = new TextEncoder().encode(`${protectedB64}.${payloadB64}`);
        const signature = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            this.accountKey!.privateKey,
            signatureInput
        );

        const sigArray = new Uint8Array(signature);
        const r = sigArray.slice(0, 32);
        const s = sigArray.slice(32, 64);
        const rawSig = new Uint8Array(64);
        rawSig.set(r);
        rawSig.set(s, 32);

        const body = JSON.stringify({
            protected: protectedB64,
            payload: payloadB64,
            signature: base64UrlEncode(rawSig),
        });

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/jose+json" },
            body,
        });

        const newNonce = response.headers.get("replay-nonce");
        if (newNonce) {
            this.nonce = newNonce;
        }

        return response;
    }

    async createAccount(email: string): Promise<void> {
        const response = await this.signedRequest(
            this.directory!.newAccount,
            {
                termsOfServiceAgreed: true,
                contact: [`mailto:${email}`],
            },
            true
        );

        if (response.status !== 200 && response.status !== 201) {
            const text = await response.text();
            throw new Error(`Failed to create ACME account: ${response.status} ${text}`);
        }

        this.accountUrl = response.headers.get("location")!;
    }

    async createOrder(domains: string[]): Promise<{ order: ACMEOrder; orderUrl: string }> {
        const response = await this.signedRequest(this.directory!.newOrder, {
            identifiers: domains.map(d => ({ type: "dns", value: d })),
        });

        if (response.status !== 201) {
            const text = await response.text();
            throw new Error(`Failed to create order: ${response.status} ${text}`);
        }

        const order = await response.json();
        const orderUrl = response.headers.get("location")!;
        return { order, orderUrl };
    }

    async getAuthorization(authUrl: string): Promise<ACMEAuthorization> {
        const response = await this.signedRequest(authUrl, "");
        return await response.json();
    }

    async getDNS01ChallengeValue(token: string): Promise<string> {
        const thumbprint = await this.getThumbprint();
        const keyAuth = `${token}.${thumbprint}`;
        const hash = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(keyAuth)
        );
        return base64UrlEncode(hash);
    }

    async respondToChallenge(challengeUrl: string): Promise<void> {
        const response = await this.signedRequest(challengeUrl, {});
        if (response.status !== 200) {
            const text = await response.text();
            throw new Error(`Failed to respond to challenge: ${response.status} ${text}`);
        }
    }

    async pollOrderStatus(orderUrl: string, maxAttempts: number = 60): Promise<ACMEOrder> {
        for (let i = 0; i < maxAttempts; i++) {
            const response = await this.signedRequest(orderUrl, "");
            const order: ACMEOrder = await response.json();

            if (order.status === "ready" || order.status === "valid") {
                return order;
            }

            if (order.status === "invalid") {
                throw new Error(`Order became invalid: ${JSON.stringify(order)}`);
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error("Order did not become ready in time");
    }

    async finalizeOrder(
        finalizeUrl: string,
        domains: string[],
        keyPair: CryptoKeyPair
    ): Promise<void> {
        const csr = await this.generateCSR(domains, keyPair);
        const response = await this.signedRequest(finalizeUrl, {
            csr: base64UrlEncode(csr),
        });

        if (response.status !== 200) {
            const text = await response.text();
            throw new Error(`Failed to finalize order: ${response.status} ${text}`);
        }
    }

    private async generateCSR(domains: string[], keyPair: CryptoKeyPair): Promise<Uint8Array> {
        // Export the public key in SPKI format (already properly encoded)
        const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
        const publicKeyBytes = new Uint8Array(publicKeyDer);

        // Build the subject: CN=first domain
        const commonName = DERBuilder.sequence([
            DERBuilder.objectIdentifier("2.5.4.3"), // CN OID
            DERBuilder.utf8String(domains[0]!)
        ]);
        
        const rdnSequence = DERBuilder.set([commonName]);
        const subject = DERBuilder.sequence([rdnSequence]);

        // Build SAN extension
        // DNS names in GeneralName use implicit [2] tagging
        const sanNames = domains.map(domain => 
            DERBuilder.contextSpecific(2, new TextEncoder().encode(domain), false)
        );
        const sanSequence = DERBuilder.sequence(sanNames);
        
        const sanExtension = DERBuilder.sequence([
            DERBuilder.objectIdentifier("2.5.29.17"), // Subject Alternative Name OID
            DERBuilder.octetString(sanSequence)
        ]);
        
        const extensionsSequence = DERBuilder.sequence([sanExtension]);
        
        // Build attributes: extensionRequest attribute containing the extensions
        // Attributes is SET OF Attribute, not SEQUENCE
        const extensionRequestAttr = DERBuilder.sequence([
            DERBuilder.objectIdentifier("1.2.840.113549.1.9.14"), // extensionRequest OID
            DERBuilder.set([extensionsSequence])
        ]);
        
        // Attributes is [0] IMPLICIT SET OF Attribute
        const attributes = DERBuilder.contextSpecific(0, extensionRequestAttr, true);

        // Version (0 for v1)
        const version = DERBuilder.integer(0);

        // CertificationRequestInfo
        const certRequestInfo = DERBuilder.sequence([
            version,
            subject,
            publicKeyBytes,
            attributes
        ]);

        // Sign the CertificationRequestInfo
        const signature = await crypto.subtle.sign(
            { name: "RSASSA-PKCS1-v1_5" },
            keyPair.privateKey,
            certRequestInfo as any
        );

        // Signature algorithm: sha256WithRSAEncryption
        const signatureAlgorithm = DERBuilder.sequence([
            DERBuilder.objectIdentifier("1.2.840.113549.1.1.11"), // sha256WithRSAEncryption
            DERBuilder.null_()
        ]);

        // Build the complete CSR
        const csr = DERBuilder.sequence([
            certRequestInfo,
            signatureAlgorithm,
            DERBuilder.bitString(new Uint8Array(signature))
        ]);

        return csr;
    }

    async downloadCertificate(certificateUrl: string): Promise<string> {
        const response = await this.signedRequest(certificateUrl, "");
        if (response.status !== 200) {
            const text = await response.text();
            throw new Error(`Failed to download certificate: ${response.status} ${text}`);
        }
        return await response.text();
    }
}

// ============================================================================
// CERTIFICATE ISSUANCE
// ============================================================================

interface CertificateResult {
    certificate: string;
    privateKey: string;
    issuedAt: number;
}

async function issueCertificate(
    domains: string[],
    zoneId: string
): Promise<CertificateResult> {
    const acme = new ACMEClient();

    await acme.init();
    await acme.createAccount(`admin@${DOMAIN}`);

    const { order, orderUrl } = await acme.createOrder(domains);

    const challengeValues: string[] = [];
    const txtRecordNames: string[] = [];
    const challengeUrls: string[] = [];

    for (const authUrl of order.authorizations) {
        const auth = await acme.getAuthorization(authUrl);
        const dns01Challenge = auth.challenges.find((c) => c.type === "dns-01");
        if (!dns01Challenge) throw new Error("No DNS-01 challenge available");
        
        const parts = auth.identifier.value.split('.');
        const subdomain = parts.slice(0, parts.length - 2).join('.');
        
        challengeValues.push(await acme.getDNS01ChallengeValue(dns01Challenge.token));
        txtRecordNames.push(`_acme-challenge.${subdomain}`);
        challengeUrls.push(dns01Challenge.url);
    }

    const txtRecordIds = await setTXTRecords(zoneId, txtRecordNames, challengeValues);

    try {
        // Wait for DNS propagation
        await new Promise((resolve) => setTimeout(resolve, 5000));

        for (const challengeUrl of challengeUrls) {
            await acme.respondToChallenge(challengeUrl);
        }

        const readyOrder = await acme.pollOrderStatus(orderUrl);

        const certKeyPair = await generateRSAKeyPair();
        const privateKeyPEM = await exportPrivateKeyPEM(certKeyPair.privateKey);

        // Extract domains from order identifiers in the correct order
        const orderedDomains = readyOrder.identifiers.map(id => id.value);
        await acme.finalizeOrder(readyOrder.finalize, orderedDomains, certKeyPair);

        const validOrder = await acme.pollOrderStatus(orderUrl);
        if (!validOrder.certificate) {
            throw new Error("No certificate URL in valid order");
        }

        const certificate = await acme.downloadCertificate(validOrder.certificate);

        return {
            certificate,
            privateKey: privateKeyPEM,
            issuedAt: Date.now(),
        };
    } finally {
        for (const recordId of txtRecordIds) {
                await deleteDNSRecord(zoneId, recordId);
        }
    }
}

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

function getClientIP(request: Request): string | undefined {
    const headers = [
        "cf-connecting-ip",
        "x-real-ip",
        "x-forwarded-for",
        "true-client-ip",
    ];

    for (const header of headers) {
        const value = request.headers.get(header);
        if (value) {
            return value.split(",")[0]!.trim();
        }
    }
    return undefined;
}

async function handleCert(request: Request): Promise<Response> {
    try {
        const zoneId = BUNNY_DNS_ZONE_ID;
        const originIP = getClientIP(request);

        if (!originIP) {
            return jsonResponse({ error: "Could not determine client IP address" }, 400);
        }

        const {
            instanceId: providedId,
            instanceKey: providedKey,
            localIp,
            externalPort,
            needsCert,
            needsDns,
            needsDb,
        } = await request.json();

        // Use provided instance ID or generate a new one
        const isNew = !providedId;
        const instanceId = providedId || generateInstanceId();

        // Verify instanceKey for existing instances
        if (!isNew) {
            if (!providedKey) {
                return jsonResponse({ error: "instanceKey is required for existing instances" }, 403);
            }
            if (!await verifyInstanceKey(instanceId, providedKey)) {
                return jsonResponse({ error: "Invalid instanceKey" }, 403);
            }
        }

        // Generate the (new) key for this instance
        const instanceKey = await generateInstanceKey(instanceId);

        const result: Record<string, any> = { instanceId, instanceKey };

        // Update DNS A records if requested (IP changed or new instance)
        if (needsDns && localIp) {
            await setARecords(zoneId, [
                { name: `int-${instanceId}`, value: localIp, ttl: 60 },
                { name: `ext-${instanceId}`, value: originIP, ttl: 60 },
            ]);
            result.externalIp = originIP;
        }

        // Update externals database if requested (port or external IP changed)
        if (needsDb && externalPort != null) {
            await upsertExternal(instanceId, originIP, externalPort);
        }

        // Issue new certificate if requested (new instance or near expiry)
        if (needsCert) {
            if (!localIp) {
                return jsonResponse({ error: "localIp is required for certificate issuance" }, 400);
            }
            // Ensure DNS records exist before issuing cert
            if (!needsDns) {
                await setARecords(zoneId, [
                    { name: `int-${instanceId}`, value: localIp, ttl: 60 },
                    { name: `ext-${instanceId}`, value: originIP, ttl: 60 },
                ]);
            }
            const domains = [
                `int-${instanceId}.${DOMAIN}`,
                `ext-${instanceId}.${DOMAIN}`,
            ];
            const certResult = await issueCertificate(domains, zoneId);
            result.expiresAt = certResult.issuedAt + CERT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
            result.nodeHttpsOptions = {
                cert: certResult.certificate,
                key: certResult.privateKey,
            };
            result.localIp = localIp;
            result.externalIp = originIP;
        }

        return jsonResponse(result, isNew ? 201 : 200);
    } catch (error) {
        console.error("Cert error:", error);
        return jsonResponse({ error: `Failed: ${(error as Error).message}` }, 500);
    }
}

function jsonResponse<T>(data: T, status: number = 200, cors: boolean = false): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...(cors ? CORS_HEADERS : {}),
        },
    });
}

async function findExternalByIp(externalIp: string): Promise<{ instanceId: string; externalPort: number } | undefined> {
    const result = await db.execute({
        sql: "SELECT instanceId, externalPort FROM externals WHERE externalIp = ?",
        args: [externalIp],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return { instanceId: row.instanceId as string, externalPort: row.externalPort as number };
}

async function findExternalById(instanceId: string): Promise<{ externalPort: number } | undefined> {
    const result = await db.execute({
        sql: "SELECT externalPort FROM externals WHERE instanceId = ?",
        args: [instanceId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return { externalPort: row.externalPort as number };
}

async function upsertExternal(instanceId: string, externalIp: string, externalPort: number): Promise<void> {
    await db.execute({
        sql: "INSERT INTO externals (instanceId, externalIp, externalPort) VALUES (?, ?, ?) ON CONFLICT(instanceId) DO UPDATE SET externalIp = excluded.externalIp, externalPort = excluded.externalPort",
        args: [instanceId, externalIp, externalPort],
    });
}

// ============================================================================
// MAIN HANDLER - BUNNY.NET EDGE SCRIPT ENTRY POINT
// ============================================================================

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
    try {
        const url = new URL(request.url);

        if (url.pathname === "/cert") {
            if (request.method !== "POST") {
                return jsonResponse({ error: "Method not allowed" }, 405, true);
            }
            return await handleCert(request);
        }

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS,
            });
        }

        if (request.method !== "GET") {
            return jsonResponse({ error: "Method not allowed" }, 405, true);
        }

        if (url.pathname === "/auto") {
            const ip = getClientIP(request);
            if (!ip) return jsonResponse({ error: "Could not determine client IP" }, 200, true);
            try {
                const external = await findExternalByIp(ip);
                if (!external) return jsonResponse({ error: "No instance found for this IP" }, 200, true);
                return jsonResponse({ instanceId: external.instanceId }, 200, true);
            } catch (error) {
                console.error("Auto lookup error:", error);
                return jsonResponse({ error: "Database lookup failed" }, 200, true);
            }
        }

        if (url.pathname === "/port") {
            const instanceId = url.searchParams.get("id");
            if (!instanceId) return jsonResponse({ error: "id parameter required" }, 200, true);
            try {
                const external = await findExternalById(instanceId);
                if (!external) return jsonResponse({ error: "Instance not found" }, 200, true);
                return jsonResponse({ externalPort: external.externalPort }, 200, true);
            } catch (error) {
                console.error("Port lookup error:", error);
                return jsonResponse({ error: "Database lookup failed" }, 200, true);
            }
        }


        
        return jsonResponse({ error: "Not found" }, 404, true);
    } catch (error) {
        console.error("Unhandled error:", error);
        return jsonResponse({ error: "Internal server error" }, 500);
    }
});
