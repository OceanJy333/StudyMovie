// input: Unix 秒；output: JavDB 请求签名与查询串；pos: 接口协议细节。
import { createHash } from 'node:crypto';
export const JAVDB_HOST = 'jdforrepam.com';
const SIGN_TAIL = '71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa';
export function javdbSign(unixSeconds) {
    const ts = String(unixSeconds);
    return `${ts}.lpw6vgqzsp.${createHash('md5').update(ts + SIGN_TAIL).digest('hex')}`;
}
export function javdbQuery(params) {
    const enc = (value) => encodeURIComponent(value).replace(/%3A/g, ':');
    return Object.entries(params).map(([key, value]) => `${enc(key)}=${enc(String(value))}`).join('&');
}
export function javdbUrl(path, params) {
    return `https://${JAVDB_HOST}${path}${params ? `?${javdbQuery(params)}` : ''}`;
}
