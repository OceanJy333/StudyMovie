// input: 发行标题；output: 拼盘/蓝光判定；pos: 作品分类规则。
// 拼盘/合集：多女优的精选、总集编、按主题拼的 Best。这类作品的番号会挂在一堆老师名下，单人补片时不该算进去。
// 判定要「宁可漏，不可错」：误杀会让一部正常的单体作品永远补不上。
// 真正的强信号是「同一番号被多位老师翻到」（catalog 里按 sources 判），标题特征只做兜底。
const DURATION = /\d+\s*(?:時間|小時|分)/;
const COMPILATION_WORD = /ベスト|BEST|総集編|コレクション|セレクション|完全版|豪華版|大全|オムニバス|特選/i;
// `16位美少女`、`4名収録`、`17名の`、`33連発` 这类；但 `1人のスター`、`2人きり`、`21発`、`24時間` 是单体作品，不能命中。
const MULTI_COUNT = /\d{2,}\s*(?:人|名|位)\s*(?:的|美少女|女優|ガール|の)|\d+\s*(?:人|名)\s*収録|\d+\s*連発/;
const PLAIN = /総集編|オムニバス|共演|大全/;
export function looksLikeCompilation(title) {
    const text = (title ?? '').trim();
    if (!text)
        return false;
    if (PLAIN.test(text))
        return true;
    // 时长 + 合集词同时出现才算（`8時間ベスト`、`ドキュメントベスト8時間`、`440分ベスト`）。
    if (DURATION.test(text) && COMPILATION_WORD.test(text))
        return true;
    if (MULTI_COUNT.test(text))
        return true;
    if (/\d+\s*タイトル/.test(text))
        return true;
    // 标题以「ベスト」收尾的基本都是精选集；单体作品极少这么写。
    if (/ベスト[\s！!。]*$/.test(text))
        return true;
    return false;
}
export function isBluRayEdition(title) {
    return /ブルーレイ|\bBlu-?ray\b/i.test(title ?? '');
}
