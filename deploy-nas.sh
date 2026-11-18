#!/usr/bin/env bash
# input: 本机构建 + 个人设置（~/.config/nas-movie/env、config.json、shows.json）；
# output: NAS 上的 CLI 副本、本机模式配置和 systemd user 定时任务；pos: nas-movie 在 NAS 上的自动化部署。
set -euo pipefail
cd "$(dirname "$0")"

# 个人设置（NAS 主机、片库路径、书签来源）放在 env 文件里，不写进脚本。
ENV_FILE=${NAS_MOVIE_ENV:-$HOME/.config/nas-movie/env}
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
NAS_SSH=${NAS_SSH:?请在 $ENV_FILE 里设置 NAS_SSH（ssh config 里的 NAS 主机名）}
# 磁力和元数据网页在 NAS 上直连不通时，经 NAS 本机的 HTTP 代理出去（如 mihomo）。
PROXY=${NAS_MOVIE_PROXY:-http://127.0.0.1:7890}
MODE=${1:-}

STAGE=$(mktemp -d)
# 整个部署复用一条 ssh 连接：经 Tailscale 中转时每次握手要 7–10 秒，十几次连接就是两分钟。
ssh() { command ssh -o ControlMaster=auto -o ControlPath="$STAGE/cm" -o ControlPersist=600 "$@"; }
trap 'command ssh -o ControlPath="$STAGE/cm" -O exit "$NAS_SSH" 2>/dev/null; rm -rf "$STAGE"' EXIT

REMOTE_HOME=$(ssh "$NAS_SSH" 'printf %s "$HOME"')
REMOTE_UID=$(ssh "$NAS_SSH" 'id -u')
DIR=${NAS_DIR:-$REMOTE_HOME/.local/share/nas-movie}
CONF_DIR=${NAS_CONF_DIR:-$REMOTE_HOME/.config/nas-movie}
SHOWS_ROOT=${NAS_MOVIE_SHOWS_ROOT:-$REMOTE_HOME/Media/Shows}

generate_config() {
  python3 - "$STAGE/config.json" <<'PY'
import json, os, sys
path = os.path.expanduser(os.environ.get('NAS_MOVIE_CONFIG') or '~/.config/nas-movie/config.json')
src = json.load(open(path))
# NAS 上 CLI 与本机迅雷接口同机，走本机命令而不是 SSH。
src['ssh'] = {'host': 'localhost', 'port': 22, 'user': src['ssh']['user']}
src['thunder']['headers'].pop('pan-auth', None)
json.dump(src, open(sys.argv[1], 'w'), ensure_ascii=False, indent=2)
PY
  chmod 600 "$STAGE/config.json"
}

if [ "$MODE" = "--token" ]; then
  echo "== 只推送连接配置（授权由 NAS 本机页面提供）=="
  generate_config
  ssh "$NAS_SSH" "mkdir -p '$CONF_DIR'"
  ssh "$NAS_SSH" "cat > '$CONF_DIR/config.json'" < "$STAGE/config.json"
  ssh "$NAS_SSH" "chmod 600 '$CONF_DIR/config.json'"
  echo "已推送 $CONF_DIR/config.json"
  exit 0
fi

echo "== 1/9 编译 =="
# 只同步 dist：teachers/status/paths/shows 不依赖 cheerio，NAS 的 Node 18 也就不需要 undici。
# search/fetch（Jackett/观影）继续在 Mac 上跑。
npm run build >/dev/null
mkdir -p "$STAGE/app"
cp -R dist package.json "$STAGE/app/"
node "$STAGE/app/dist/cli.js" --help >/dev/null

echo "== 2/9 导出老师名册 =="
# NAS 上的名册是演员身份（书签名 → JavDB id）的唯一写源：先取回来，旧 id 照用，只给新名字找人。
ssh "$NAS_SSH" "cat '$CONF_DIR/performers.json' 2>/dev/null || echo '[]'" > "$STAGE/previous.json"
if node --experimental-strip-types src/cli.ts teachers names --names "$STAGE/previous.json" --save "$STAGE/performers.json" >"$STAGE/names.out" 2>"$STAGE/names.err"; then
  python3 -c "import json;r=json.load(open('$STAGE/names.out'));print('名册', r['count'], '人｜固定 id', r['pinned'], '人', ('｜没找到 id：' + '、'.join(r['unresolved']) + '（NAS 会把她们记为失败，下次部署再试，或在名册 actors 里手填 id）') if r['unresolved'] else '')"
else
  echo "读 Edge 书签失败（Windows 机器不可达？），本次跳过名册更新：$(tail -1 "$STAGE/names.err")"
  rm -f "$STAGE/performers.json"
fi

echo "== 3/9 生成本机模式配置 =="
generate_config

echo "== 4/9 同步到 $NAS_SSH:$DIR =="
# 这台 NAS 的 rsync 拒绝绝对路径（invalid path），改用压缩包 + cat 上传。
# 不走 tar|ssh 管道：远端 tar 偶尔在传输完成后仍等不到 EOF，整个部署会卡住。
ssh "$NAS_SSH" "mkdir -p '$DIR' '$CONF_DIR/state' && rm -rf '$DIR/dist' '$DIR/node_modules'"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$STAGE/app" -czf "$STAGE/app.tgz" dist package.json
ssh "$NAS_SSH" "cat > '$DIR/app.tgz'" < "$STAGE/app.tgz"
ssh "$NAS_SSH" "tar -xzf '$DIR/app.tgz' -C '$DIR' && rm -f '$DIR/app.tgz'"
ssh "$NAS_SSH" "cat > '$CONF_DIR/config.json'" < "$STAGE/config.json"
[ -f "$STAGE/performers.json" ] && ssh "$NAS_SSH" "cat > '$CONF_DIR/performers.json'" < "$STAGE/performers.json"
# 个人设置同步过去：NAS 上的整理、片库墙、自动下载用同一份片库路径。
[ -f "$ENV_FILE" ] && ssh "$NAS_SSH" "cat > '$CONF_DIR/env' && chmod 600 '$CONF_DIR/env'" < "$ENV_FILE"
# 剧集订阅配置在 Mac 上维护，部署时同步；NAS 上的账本在 state/shows.json，不会被覆盖。
SHOWS_CONF="${NAS_MOVIE_SHOWS:-$HOME/.config/nas-movie/shows.json}"
if [ -f "$SHOWS_CONF" ]; then
  ssh "$NAS_SSH" "cat > '$CONF_DIR/shows.json'" < "$SHOWS_CONF"
  SHOWS_COUNT=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["subscriptions"]))' "$SHOWS_CONF")
  echo "已同步剧集订阅 $SHOWS_COUNT 个"
else
  echo "本机没有 $SHOWS_CONF，跳过剧集订阅同步（NAS 上保留原配置）"
fi
# 剧集根目录必须存在：迅雷按「已存在目录」解析下载目标，shows organize 也从这里扫。
ssh "$NAS_SSH" "mkdir -p '$SHOWS_ROOT'"
ssh "$NAS_SSH" "chmod 600 '$CONF_DIR/config.json'; [ -f '$CONF_DIR/performers.json' ] && chmod 600 '$CONF_DIR/performers.json' || true; [ -f '$CONF_DIR/shows.json' ] && chmod 600 '$CONF_DIR/shows.json' || true"

echo "== 5/9 安装定时任务：18:00 下载 / 15:00 整理 / 03:00 作品目录 / 04:00 剧集检查 / 08+20:00 剧集归档（systemd user timer）=="
# 这台 NAS 拒绝非 root crontab，root 又只允许密钥登录；Jackett 已经是 user service，这里沿用同一套。
ssh "$NAS_SSH" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/nas-movie-auto.service <<UNIT
[Unit]
Description=nas-movie 每日扫描订阅老师和系列并提交迅雷下载
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
Environment=NAS_MOVIE_PROXY=$PROXY
TimeoutStartSec=30min
ExecStart=/usr/bin/node dist/cli.js teachers auto --apply --names $CONF_DIR/performers.json
StandardOutput=append:$DIR/auto.log
StandardError=append:$DIR/auto.log
UNIT
cat > ~/.config/systemd/user/nas-movie-auto.timer <<UNIT
[Unit]
Description=每天 18:00 运行 nas-movie 自动下载

[Timer]
OnCalendar=*-*-* 18:00:00
Persistent=true
AccuracySec=1min
Unit=nas-movie-auto.service

[Install]
WantedBy=timers.target
UNIT
cat > ~/.config/systemd/user/nas-movie-organize.service <<UNIT
[Unit]
Description=nas-movie 把下载完成的片子平铺进片库，命名成「发行日期 番号 演员」
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
Environment=NAS_MOVIE_PROXY=$PROXY
TimeoutStartSec=30min
ExecStart=/usr/bin/node dist/cli.js organize --apply
StandardOutput=append:$DIR/organize.log
StandardError=append:$DIR/organize.log
UNIT
cat > ~/.config/systemd/user/nas-movie-organize.timer <<UNIT
[Unit]
Description=每天 15:00 整理一次片库

[Timer]
OnCalendar=*-*-* 15:00:00
Persistent=true
AccuracySec=1min
Unit=nas-movie-organize.service

[Install]
WantedBy=timers.target
UNIT
cat > ~/.config/systemd/user/nas-movie-catalog.service <<UNIT
[Unit]
Description=nas-movie 抓取收藏夹老师完整片单，供片库墙显示未下载作品
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=/usr/bin/node dist/cli.js catalog --pages 12 --names $CONF_DIR/performers.json
StandardOutput=append:$DIR/catalog.log
StandardError=append:$DIR/catalog.log
UNIT
cat > ~/.config/systemd/user/nas-movie-catalog.timer <<UNIT
[Unit]
Description=每天 03:00 同步作品目录

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
AccuracySec=1min
Unit=nas-movie-catalog.service

[Install]
WantedBy=timers.target
UNIT
cat > ~/.config/systemd/user/nas-movie-shows.service <<UNIT
[Unit]
Description=nas-movie 搜索电视剧/番剧新集并归档
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=-/usr/bin/node dist/cli.js shows check --apply --limit 8
StandardOutput=append:$DIR/shows.log
StandardError=append:$DIR/shows.log
UNIT
cat > ~/.config/systemd/user/nas-movie-shows-organize.service <<UNIT
[Unit]
Description=nas-movie 把下载完的剧集归档到 剧名/Season NN
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=/usr/bin/node dist/cli.js shows organize --apply --settle 10
StandardOutput=append:$DIR/shows.log
StandardError=append:$DIR/shows.log
UNIT
cat > ~/.config/systemd/user/nas-movie-shows-organize.timer <<UNIT
[Unit]
Description=每天 08:00 / 20:00 归档剧集

[Timer]
OnCalendar=*-*-* 08,20:00:00
Persistent=true
AccuracySec=1min
Unit=nas-movie-shows-organize.service

[Install]
WantedBy=timers.target
UNIT
cat > ~/.config/systemd/user/nas-movie-shows.timer <<UNIT
[Unit]
Description=每天 04:00 检查剧集更新

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true
AccuracySec=1min
Unit=nas-movie-shows.service

[Install]
WantedBy=timers.target
UNIT
export XDG_RUNTIME_DIR=/run/user/$REMOTE_UID
systemctl --user daemon-reload
systemctl --user enable --now nas-movie-auto.timer nas-movie-organize.timer nas-movie-catalog.timer nas-movie-shows.timer nas-movie-shows-organize.timer
systemctl --user list-timers 'nas-movie-*' --no-pager"

echo "== 6/9 安装片库墙常驻服务（局域网 ${NAS_WEB_PORT:-8850}）=="
ssh "$NAS_SSH" "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/nas-movie-web.service <<UNIT
[Unit]
Description=nas-movie 片库墙（局域网封面墙 + 在线播放 + 剧集）
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
Environment=NAS_MOVIE_PROXY=$PROXY
ExecStart=/usr/bin/node dist/cli.js web --port ${NAS_WEB_PORT:-8850}
Restart=always
RestartSec=5
StandardOutput=append:$DIR/web.log
StandardError=append:$DIR/web.log

[Install]
WantedBy=default.target
UNIT
export XDG_RUNTIME_DIR=/run/user/$REMOTE_UID
systemctl --user daemon-reload
# 常驻服务跑的是旧 dist，必须 restart 才会换成新代码；enable --now 对已在跑的进程无效。
systemctl --user enable nas-movie-web.service
systemctl --user restart nas-movie-web.service
sleep 3
systemctl --user is-active nas-movie-web.service
curl -s --max-time 10 http://127.0.0.1:${NAS_WEB_PORT:-8850}/api/health
curl -s --max-time 10 http://127.0.0.1:${NAS_WEB_PORT:-8850}/api/shows | head -c 200; echo"

echo "== 7/9 NAS 上 dry-run 计划 =="
ssh "$NAS_SSH" "cd $DIR && NAS_MOVIE_PROXY=$PROXY timeout 300 /usr/bin/node dist/cli.js teachers auto --names $CONF_DIR/performers.json --limit 5" | tail -25

echo "== 8/9 NAS 上整理计划 dry-run =="
ssh "$NAS_SSH" "cd $DIR && NAS_MOVIE_PROXY=$PROXY timeout 300 /usr/bin/node dist/cli.js organize" | python3 -c "
import json, sys
plan = json.load(sys.stdin)
print('计数', json.dumps(plan['counts'], ensure_ascii=False))
for row in plan['review']: print('待确认', row['number'], row['actress'], row['how'])
"

echo "== 9/9 剧集订阅状态 =="
ssh "$NAS_SSH" "cd $DIR && /usr/bin/node dist/cli.js shows list" | python3 -c "
import json, sys
plan = json.load(sys.stdin)
print('剧集根目录', plan['root'], '｜订阅', len(plan['subscriptions']), '部｜已归档', plan['totals']['episodes'], '集')
for row in plan['shows'][:10]: print('  ', row['name'], len(row['episodes']), '集')
"
