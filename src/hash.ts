export async function hashSecret(username: string, password: string): Promise<string> {
    if (!password) return '';
    const saltString = "LightLynx-Salt-v1-" + username.trim().toLowerCase();
    const salt = new TextEncoder().encode(saltString);
    const pw = new TextEncoder().encode(password);
    
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", 
        pw, 
        "PBKDF2", 
        false, 
        ["deriveBits"]
    );
    
    const derivedBits = await window.crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        256
    );
    
    return Array.from(new Uint8Array(derivedBits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
