export function usableMagnets(magnets) {
    return magnets.filter(magnet => /^[a-f0-9]{40}$/i.test(magnet.hash || ''));
}
const FULL_RELEASE_MB = 400;
/** 候选比当前更值得下：先看高清，再看体积（小一点更省盘），未知体积排最后。 */
function preferSmaller(candidate, current) {
    const clarity = Number(Boolean(candidate.hd)) - Number(Boolean(current.hd));
    if (clarity)
        return clarity < 0;
    const next = Number(candidate.size) || 0, prev = Number(current.size) || 0;
    if (next > 0 && prev > 0 && next !== prev)
        return next < prev;
    if ((next > 0) !== (prev > 0))
        return next > 0;
    return false;
}
export function bestMagnet(magnets) {
    const full = magnets.filter(magnet => (Number(magnet.size) || 0) >= FULL_RELEASE_MB);
    const known = magnets.filter(magnet => (Number(magnet.size) || 0) > 0);
    const pool = full.length ? full : known.length ? known : [...magnets];
    return pool.reduce((best, magnet) => best && !preferSmaller(magnet, best) ? best : magnet, null);
}
export function bestHash(magnets) {
    return bestMagnet(usableMagnets(magnets))?.hash?.toLowerCase() ?? null;
}
