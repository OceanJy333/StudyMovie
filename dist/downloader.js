// input: config; output: the configured download backend; pos: download boundary shared by CLI, timers, web wall and organize.
import { downloaderKind } from "./config.js";
import { Thunder } from "./thunder.js";
import { Aria2 } from "./aria2.js";
export function downloader(config) {
    return downloaderKind(config) === 'aria2' ? new Aria2(config) : new Thunder(config);
}
