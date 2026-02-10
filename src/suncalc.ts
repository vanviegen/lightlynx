const PI = Math.PI,
    sin = Math.sin,
    cos = Math.cos,
    asin = Math.asin,
    acos = Math.acos,
    rad = PI / 180,
    dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    J2000 = 2451545,
    e = rad * 23.4397, // obliquity of the Earth
    J0 = 0.0009;

function toJulian(date: Date): number { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j: number): Date  { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date: Date): number   { return toJulian(date) - J2000; }
function declination(l: number, b: number)    { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }
function solarMeanAnomaly(d: number) { return rad * (357.5291 + 0.98560028 * d); }
function julianCycle(d: number, lw: number) { return Math.round(d - J0 - lw / (2 * PI)); }
function approxTransit(Ht: number, lw: number, n: number) { return J0 + (Ht + lw) / (2 * PI) + n; }
function solarTransitJ(ds: number, M: number, L: number)  { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }
function hourAngle(h: number, phi: number, d: number) { return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d))); }
function observerAngle(height: number) { return -2.076 * Math.sqrt(height) / 60; }

function eclipticLongitude(M: number): number {
    const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), // equation of center
        P = rad * 102.9372; // perihelion of the Earth
    return M + C + P + PI;
}

// returns set time for the given sun altitude
function getSetJ(h: number, lw: number, phi: number, dec: number, n: number, M: number, L: number): number {
    const w = hourAngle(h, phi, dec),
        a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
}


/** Calculates sun times for a given date, latitude/longitude, and, optionally,
 * the observer height (in meters) relative to the horizon
 */
export function getSunTimes(date: Date, lat: number, lng: number, height: number = 0) {
    const lw = rad * -lng,
        phi = rad * lat,
        dh = observerAngle(height),
        d = toDays(date),
        n = julianCycle(d, lw),
        ds = approxTransit(0, lw, n),
        M = solarMeanAnomaly(ds),
        L = eclipticLongitude(M),
        dec = declination(L, 0),
        Jnoon = solarTransitJ(ds, M, L);

    const h0 = (dh - 0.833) * rad;
    const Jset = getSetJ(h0, lw, phi, dec, n, M, L);
    const Jrise = Jnoon - (Jset - Jnoon);

    return {rise: fromJulian(Jrise), set: fromJulian(Jset)};
}
