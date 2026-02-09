export default function handleQuery({request}) {
    const hostname = request.hostname.split('.')[0].toLowerCase();
    
    if (request.queryType === 'A') {
        if (hostname === 'int-auto') {
            // Resolve int-auto to a CNAME: auto-<hex_of_caller_external_ip>.lightlynx.eu
            // This only works when the DNS resolver IP matches the user's external IP
            const clientIP = request.clientIP;
            if (clientIP && clientIP.indexOf(".") >= 0) {
                const hex = clientIP.split('.').map(p => parseInt(p).toString(16).padStart(2, '0')).join('');
                return new CNAMERecord(`auto-${hex}.lightlynx.eu`, 30);
            }
        }
        else if (hostname === 'ext-auto') {
            // Resolve ext-auto to the caller's IP address
            if (request.clientIP && request.clientIP.indexOf(".") >= 0) {
                return new ARecord(request.clientIP, 30);
            }
        }
    }
}