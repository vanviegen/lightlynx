// @ts-ignore
import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.11.2";

// ============================================================================
// CONFIGURATION
// ============================================================================

const DOMAIN = "lightlynx.eu";
const BUNNY_DNS_API_BASE = "https://api.bunny.net";
const ACME_DIRECTORY_URL = "https://acme-v02.api.letsencrypt.org/directory";
// For testing, use: "https://acme-staging-v02.api.letsencrypt.org/directory"

const CERT_VALIDITY_DAYS = 90;

// Hard-coded secrets
const BUNNY_DNS_ZONE_ID = "684184";
const BUNNY_DNS_API_KEY = "fb28817b-30ad-4820-ba78-e5d8279be8a7a93097b3-a224-4241-96d3-382b00b336e2";

// ============================================================================
// IP CONVERSION
// ============================================================================

function ipToHex(ip: string): string | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts.map(p => p.toString(16).padStart(2, '0')).join('');
}

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
    AccessKey: BUNNY_DNS_API_KEY,
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

  async pollOrderStatus(orderUrl: string, maxAttempts: number = 30): Promise<ACMEOrder> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await this.signedRequest(orderUrl, "");
      const order: ACMEOrder = await response.json();

      if (order.status === "ready" || order.status === "valid") {
        return order;
      }

      if (order.status === "invalid") {
        throw new Error(`Order became invalid: ${JSON.stringify(order)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
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
    // Export the public key in SPKI format
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
    const sanNames = domains.map(domain => 
      DERBuilder.contextSpecific(2, new TextEncoder().encode(domain), false)
    );
    const sanExtension = DERBuilder.sequence([
      DERBuilder.objectIdentifier("2.5.29.17"), // Subject Alternative Name OID
      DERBuilder.octetString(DERBuilder.sequence(sanNames))
    ]);
    
    const extensions = DERBuilder.contextSpecific(0, DERBuilder.sequence([
      DERBuilder.sequence([sanExtension])
    ]));

    // Version (0 for v1)
    const version = DERBuilder.integer(0);

    // CertificationRequestInfo
    const certRequestInfo = DERBuilder.sequence([
      version,
      subject,
      publicKeyBytes,
      extensions
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
    await new Promise((resolve) => setTimeout(resolve, 10000));

    for (const challengeUrl of challengeUrls) {
        await acme.respondToChallenge(challengeUrl);
    }

    const readyOrder = await acme.pollOrderStatus(orderUrl);

    const certKeyPair = await generateRSAKeyPair();
    const privateKeyPEM = await exportPrivateKeyPEM(certKeyPair.privateKey);

    await acme.finalizeOrder(readyOrder.finalize, domains, certKeyPair);

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

async function handleCreate(request: Request): Promise<Response> {
  try {
    const zoneId = BUNNY_DNS_ZONE_ID;
    const originIP = getClientIP(request);

    if (!originIP) {
      return jsonResponse(
        { success: false, error: "Could not determine client IP address" },
        400
      );
    }

    const { internalIp, useExternalIp } = await request.json();

    const domains: string[] = [];

    if (internalIp) {
      const hex = ipToHex(internalIp);
      if (hex) {
        domains.push(`x${hex}.${DOMAIN}`);
      }
    }

    if (useExternalIp) {
      const hex = ipToHex(originIP);
      if (hex) {
        domains.push(`x${hex}.${DOMAIN}`);
      }
    }

    if (domains.length === 0) {
      return jsonResponse(
        { success: false, error: "At least one valid IP (internalIp or useExternalIp) must be provided" },
        400
      );
    }

    const certResult = await issueCertificate(domains, zoneId);
    const expiresAt = certResult.issuedAt + CERT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;

    return jsonResponse({
      expiresAt,
      nodeHttpsOptions: {
        cert: certResult.certificate,
        key: certResult.privateKey,
      },
    }, 201);
  } catch (error) {
    console.error("Create error:", error);
    return jsonResponse(
      { error: `Failed to create: ${(error as Error).message}` },
      500
    );
  }
}

function jsonResponse<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ============================================================================
// MAIN HANDLER - BUNNY.NET EDGE SCRIPT ENTRY POINT
// ============================================================================

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/ip") {
      const ip = getClientIP(request);
      return new Response(ip, {
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed" },
        405
      );
    }

    if (url.pathname === "/create") {
      return await handleCreate(request);
    }
    
    return jsonResponse(
      { error: "Not found" },
      404
    );
  } catch (error) {
    console.error("Unhandled error:", error);
    return jsonResponse(
      { success: false, error: "Internal server error" },
      500
    );
  }
});
