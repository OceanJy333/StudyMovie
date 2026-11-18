// input: authorized Ego task/page identifiers; output: HTML or imported session; pos: browser verification adapter.
import { spawn } from 'node:child_process';
import type { Config } from './config.ts';
import { saveConfig } from './config.ts';

export async function browserCode(code: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('浏览器请求超时')); }, 60000);
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', status => {
      clearTimeout(timer);
      const output = stdout + '\n' + stderr;
      if (status !== 0) return reject(new Error(output.replace(/MOVIE_RESULT:.*/g, '[session data redacted]').slice(-1200)));
      const result = output.split('\n').find(l => l.startsWith('MOVIE_RESULT:'));
      if (!result) return reject(new Error('浏览器没有返回预期结果'));
      try { resolve(JSON.parse(result.slice(13))); } catch { reject(new Error('浏览器返回结构异常')); }
    });
    child.stdin.end(code);
  });
}

export async function browserHtml(space: number, page: string, url: string) {
  const resourcePage = /\/mv\/[a-z\d]+/i.test(new URL(url).pathname);
  return await browserCode(`
const t = await taskSpace(${JSON.stringify(space)});
const p = t.page(${JSON.stringify(page)});
await p.goto(${JSON.stringify(url)});
await p.waitForFunction((resourcePage) => /登录后访问受限内容/.test(document.body.innerText) || (resourcePage ? document.querySelector('a[href^="magnet:"]') : [...document.querySelectorAll('a[href]')].some(a=>/\\/mv\\/[a-z\\d]+/i.test(a.getAttribute('href')))), ${resourcePage}, {timeout:30000});
console.log('MOVIE_RESULT:' + JSON.stringify(await p.evaluate(() => document.documentElement.outerHTML)));
`) as string;
}

export async function importSession(config: Config, space: number, nasPage?: string, sitePage?: string) {
  const data = await browserCode(`
const t = await taskSpace(${JSON.stringify(space)});
const out = {};
${nasPage ? `
out.thunder = await t.page(${JSON.stringify(nasPage)}).evaluate(() => {
  const w = document.querySelector('iframe[name="xunlei"]')?.contentWindow?.document.querySelector('iframe')?.contentWindow;
  if (!w) throw new Error('请先在 NAS 页面打开迅雷');
  const entries = w.performance.getEntriesByType('resource').map(r=>r.name);
  const request = entries.reverse().find(u=>u.includes('drive/v1/tasks?space=') && u.includes('pan_auth='));
  if (!request) throw new Error('尚未捕获迅雷登录态，稍后再试');
  const q = new URL(request).searchParams;
  return {headers:{'content-type':'application/json','device-space':q.get('device_space')},space:q.get('space')};
});` : ''}
${sitePage ? `
const g = t.page(${JSON.stringify(sitePage)}), url = await g.url();
const cookies = await g.cdp('Network.getCookies', {urls:[url]});
out.gying = {baseUrl:new URL(url).origin+'/',cookie:cookies.cookies.map(c=>c.name+'='+c.value).join('; '),userAgent:await g.evaluate(()=>navigator.userAgent)};` : ''}
console.log('MOVIE_RESULT:' + JSON.stringify(out));
`);
  if (data.thunder) config.thunder = { ...config.thunder, ...data.thunder };
  if (data.gying) config.gying = { ...config.gying, ...data.gying };
  await saveConfig(config);
  return { imported: Object.keys(data), secretFileMode: '0600' };
}
