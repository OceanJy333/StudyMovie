// input: 无；output: 影片墙共享样式；pos: 视图样式。
export const sharedStyle = `
  :root { color-scheme: dark; --bg:#0e0e12; --card:#17171d; --line:#25252e; --text:#e9e9f0; --dim:#8a8a99; --accent:#ff6b9a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,"Helvetica Neue","PingFang SC",sans-serif; }
  header { position:sticky; top:0; z-index:20; backdrop-filter:blur(12px); background:rgba(14,14,18,.9);
           border-bottom:1px solid var(--line); padding:12px 18px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  h1 { font-size:16px; margin:0; white-space:nowrap; }
  h1 small { color:var(--dim); font-weight:400; font-size:12px; margin-left:8px; }
  input[type=search], select { background:#1c1c24; color:var(--text); border:1px solid var(--line); border-radius:8px;
           padding:7px 10px; font-size:14px; outline:none; }
  input[type=search] { width:min(260px,42vw); }
  input[type=search]:focus, select:focus { border-color:var(--accent); }
  .spacer { flex:1; }
  a.nav { color:var(--dim); font-size:13px; text-decoration:none; border:1px solid var(--line);
          border-radius:8px; padding:6px 11px; white-space:nowrap; }
  a.nav:hover { color:var(--text); border-color:#3a3a48; }
  .seg { display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .seg button { background:transparent; border:0; color:var(--dim); padding:6px 10px; font-size:13px; cursor:pointer; }
  .seg button.on { background:#26262f; color:var(--text); }
  #grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(186px,1fr)); gap:14px; padding:16px 18px 60px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden;
          transition:transform .12s ease, border-color .12s ease; }
  .card.dl { cursor:pointer; }
  .card:hover { border-color:#3a3a48; }
  .card.dl:hover { transform:translateY(-2px); }
  .shot { position:relative; aspect-ratio:3/2; background:#000; }
  .shot img { width:100%; height:100%; object-fit:cover; display:block; }
  .card.miss .shot img { opacity:.55; }
  .card.miss:hover .shot img { opacity:.8; }
  .ph { display:flex; width:100%; height:100%; align-items:center; justify-content:center;
        color:#4a4a58; font-family:ui-monospace,monospace; font-size:13px; background:linear-gradient(135deg,#15151b,#1e1e27); }
  .new { position:absolute; top:6px; left:6px; background:var(--accent); color:#14141a; font-size:10px; font-weight:700;
         padding:2px 6px; border-radius:999px; letter-spacing:.04em; }
  .badge { position:absolute; right:6px; top:6px; font-size:11px; font-weight:700; padding:2px 7px; border-radius:999px;
           background:rgba(10,10,14,.8); color:var(--text); }
  .badge.ok { color:#7fd88f; }
  .badge.wait { color:#ffd166; }
  .cap { padding:8px 10px 2px; display:flex; gap:6px; align-items:baseline; }
  .num { font-family:ui-monospace,monospace; font-size:12px; color:var(--accent); }
  .who { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sub { padding:0 10px 9px; display:flex; gap:8px; font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; }
  .sub .t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #empty { padding:60px 20px; text-align:center; color:var(--dim); }
  @media (max-width:560px) { #grid { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px; padding:12px; } }
`;
