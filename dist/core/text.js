// input: 任意文本；output: HTML 安全字符串；pos: 视图转义。
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
    return value.replace(/[&<>"']/g, char => ESCAPES[char] ?? char);
}
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0)
        return '0 MB';
    const gb = bytes / 2 ** 30;
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 2 ** 20)} MB`;
}
