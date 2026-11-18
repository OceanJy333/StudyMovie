import { stderrNote } from "../core/log.js";
import { nowIso } from "../core/time.js";
import { Jackett } from "../jackett.js";
import { Thunder, assertDownloadPath } from "../thunder.js";
import { ensureThunderAuth } from "../thunder-auth.js";
import { readShows, showsPath } from "./config.js";
import { scanShows } from "./library.js";
import { episodeKey } from "./parse.js";
import { buildGroups } from "./search.js";
import { readShowsState, showsStatePath, writeShowsState } from "./state.js";
export async function checkShows(options) {
    assertDownloadPath(options.shows.root);
    const statePath = options.statePath ?? showsStatePath;
    const state = await readShowsState(statePath);
    const library = await scanShows(options.shows.root, options.shows.subscriptions);
    const owned = new Set(library.flatMap(show => show.episodes.map(episode => episodeKey(show.name, episode.season, episode.episode))));
    const search = options.search ?? ((query) => new Jackett(options.config).searchRaw(query));
    const results = [];
    const notes = [];
    let groupsSeen = 0, fresh = 0, submitted = 0, remaining = 0, errors = 0;
    const startedAt = nowIso();
    const thunder = options.apply ? new Thunder(options.config) : null;
    if (thunder)
        await ensureThunderAuth(options.config);
    for (const subscription of options.shows.subscriptions.filter(item => item.enabled)) {
        let groups;
        try {
            groups = buildGroups(subscription, await search(`${subscription.query}${subscription.year ? ` ${subscription.year}` : ''}`))
                .map(group => ({
                ...group,
                episodes: subscription.totalEpisodes
                    ? group.episodes.filter(episode => episode <= subscription.totalEpisodes)
                    : group.episodes,
            }))
                .filter(group => group.episodes.length > 0);
        }
        catch (error) {
            errors++;
            notes.push(`${subscription.name}：搜索失败 ${error instanceof Error ? error.message : '未知错误'}`);
            continue;
        }
        groupsSeen += groups.length;
        const todo = groups.filter(group => group.episodes.some(episode => {
            const key = episodeKey(subscription.name, group.season, episode);
            return !state.seen[key] && !owned.has(key);
        }));
        fresh += todo.length;
        if (!todo.length)
            continue;
        for (const group of todo) {
            if (submitted >= options.limit) {
                remaining++;
                continue;
            }
            if (!options.apply) {
                submitted++;
                results.push({
                    show: group.show, season: group.season, episodes: group.episodes, title: group.title,
                    hash: group.hash, sizeBytes: group.sizeBytes, seeds: group.seeds, action: 'would-download',
                });
                continue;
            }
            try {
                const result = await thunder.download(group.magnet, options.shows.root, false);
                const at = nowIso();
                for (const episode of group.episodes) {
                    state.seen[episodeKey(subscription.name, group.season, episode)] = {
                        at, hash: group.hash, title: group.title, action: result.action, taskId: result.task?.id,
                        show: subscription.name, season: group.season, episodes: [episode], sizeBytes: group.sizeBytes,
                    };
                }
                state.lastCheck = at;
                await writeShowsState(state, statePath);
                submitted++;
                results.push({
                    show: group.show, season: group.season, episodes: group.episodes, title: group.title,
                    hash: group.hash, sizeBytes: group.sizeBytes, seeds: group.seeds,
                    action: result.action, taskId: result.task?.id,
                });
                stderrNote(`剧集 ${subscription.name} ${group.episodes.join(',')} ${result.action}`);
            }
            catch (error) {
                errors++;
                const message = error instanceof Error ? error.message : '下载失败';
                results.push({
                    show: group.show, season: group.season, episodes: group.episodes, title: group.title,
                    hash: group.hash, sizeBytes: group.sizeBytes, seeds: group.seeds, action: 'error', error: message,
                });
                stderrNote(`剧集 ${subscription.name} ${group.episodes.join(',')} 失败：${message}`);
            }
        }
    }
    state.lastCheck = startedAt;
    if (options.apply)
        await writeShowsState(state, statePath);
    const counts = {
        subscriptions: options.shows.subscriptions.filter(item => item.enabled).length,
        groups: groupsSeen, fresh, submitted, remaining, errors,
    };
    stderrNote(`剧集订阅 ${counts.subscriptions} 个｜候选 ${counts.groups} 组｜新 ${counts.fresh}｜处理 ${counts.submitted}`
        + `｜超出上限 ${counts.remaining}｜失败 ${counts.errors}`);
    return { apply: options.apply, root: options.shows.root, lastCheck: state.lastCheck, counts, results, notes };
}
export async function summarizeShows(config, state, library) {
    return {
        root: config.root,
        subscriptions: config.subscriptions.length,
        episodes: library.reduce((sum, show) => sum + show.episodes.length, 0),
        totalBytes: library.reduce((sum, show) => sum + show.totalBytes, 0),
        lastCheck: state.lastCheck,
        shows: library,
    };
}
export async function loadShowsSummary(path = showsPath) {
    const config = await readShows(path);
    const [state, library] = await Promise.all([readShowsState(), scanShows(config.root, config.subscriptions)]);
    return summarizeShows(config, state, library);
}
