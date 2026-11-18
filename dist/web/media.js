// input: 文件名与 Range 头；output: 分片范围、MIME 与路径校验；pos: 在线播放协议细节。
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { videoExtensions } from "../library/naming.js";
const videoTypes = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.ts': 'video/mp2t', '.m2ts': 'video/mp2t', '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv',
    '.avi': 'video/x-msvideo', '.flv': 'video/x-flv', '.rmvb': 'application/vnd.rn-realmedia-vbr',
};
export function contentType(name) {
    return videoTypes[extname(name).toLowerCase()] ?? 'application/octet-stream';
}
/** 剧集目录允许子目录，但必须落在根目录内。 */
export function safeNestedMediaPath(root, name) {
    const base = resolve(root);
    const target = resolve(base, name);
    if (target !== base && !target.startsWith(base + sep))
        return null;
    if (!videoExtensions.has(extname(name).toLowerCase()))
        return null;
    return target;
}
/** 只允许片库根目录下的直接文件，杜绝 ../ 穿越和非视频扩展名。 */
export function safeMediaPath(root, name) {
    const target = resolve(root, name);
    if (dirname(target) !== resolve(root))
        return null;
    if (basename(target) !== name)
        return null;
    if (!videoExtensions.has(extname(name).toLowerCase()))
        return null;
    return target;
}
// RFC 7233 单区间：`bytes=0-`、`bytes=100-200`、`bytes=-500`。null 表示没有 Range 头，'invalid' 表示 416。
export function parseRange(header, size) {
    if (!header)
        return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match)
        return 'invalid';
    const [, rawStart, rawEnd] = match;
    if (rawStart === '' && rawEnd === '')
        return 'invalid';
    let start, end;
    if (rawStart === '') {
        const length = Number(rawEnd);
        if (!length || !Number.isFinite(length))
            return 'invalid';
        start = Math.max(0, size - length);
        end = size - 1;
    }
    else {
        start = Number(rawStart);
        end = rawEnd === '' ? size - 1 : Number(rawEnd);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
        return 'invalid';
    return { start, end: Math.min(end, size - 1) };
}
