// input: URL 与请求参数；output: JSON / 二进制响应；pos: 出站 HTTP 客户端（keep-alive、重试、限流）。
import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';
import type { Duplex } from 'node:stream';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { Semaphore, sleep } from './async.ts';

export class HttpError extends Error {
  readonly status: number | null;
  readonly transient: boolean;
  constructor(message: string, status: number | null = null, transient = false) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.transient = transient;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** 这些状态码视为可重试的临时故障。 */
  retryStatus?: readonly number[];
}

const RETRY_STATUS = [408, 429, 500, 502, 503, 504] as const;

export interface HttpClientOptions {
  label: string;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  /** HTTP 代理（如 NAS 上的 mihomo `http://127.0.0.1:7890`）；只用于 https 目标，走 CONNECT 隧道。 */
  proxy?: string;
  /** 两次请求开始之间的最小间隔。对端按速率限流（JavDB 网页约每秒 2 次）时用，比压并发更准。 */
  minIntervalMs?: number;
}

/**
 * 连接复用是 JavDB 抓取的主要提速点：默认 keep-alive，单次 TLS 握手服务几十个请求。
 * 并发用信号量卡住，避免 429；所有错误都带 label，日志能看出是谁失败。
 */
export class HttpClient {
  private readonly httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 8 });
  private readonly httpsAgent: HttpsAgent;
  private readonly gate: Semaphore;
  private readonly defaults: Required<Pick<HttpClientOptions, 'timeoutMs' | 'retries'>>;

  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.httpsAgent = options.proxy ? new TunnelAgent(options.proxy) : new HttpsAgent({ keepAlive: true, maxSockets: 8 });
    this.gate = new Semaphore(options.concurrency ?? 4);
    this.defaults = { timeoutMs: options.timeoutMs ?? 25_000, retries: options.retries ?? 4 };
  }

  async json<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const body = await this.send(url, { ...options, headers: { accept: 'application/json', ...options.headers } });
    try {
      return JSON.parse(body.toString('utf8')) as T;
    } catch {
      throw new HttpError(`${this.options.label} 没有返回 JSON`, null);
    }
  }

  async bytes(url: string, options: RequestOptions = {}): Promise<Buffer> {
    return this.send(url, options);
  }

  close(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  private async send(url: string, options: RequestOptions): Promise<Buffer> {
    let last: HttpError | null = null;
    const attempts = Math.max(1, (options.retries ?? this.defaults.retries) + 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.gate.run(async () => { await this.pace(); return this.once(url, options); });
      } catch (error) {
        const failure = error instanceof HttpError ? error
          : new HttpError(error instanceof Error ? error.message : `${this.options.label} 请求失败`, null, true);
        last = failure;
        if (!failure.transient || attempt === attempts - 1) break;
        await sleep(400 * (attempt + 1));
      }
    }
    throw last ?? new HttpError(`${this.options.label} 请求失败`);
  }

  private nextAt = 0;

  private async pace(): Promise<void> {
    const interval = this.options.minIntervalMs ?? 0;
    if (!interval) return;
    const now = Date.now();
    const wait = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + interval;
    if (wait) await sleep(wait);
  }

  private once(url: string, options: RequestOptions): Promise<Buffer> {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const agent = target.protocol === 'https:' ? this.httpsAgent : this.httpAgent;
    const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs;
    return new Promise<Buffer>((resolve, reject) => {
      const request = client(target, {
        method: options.method ?? 'GET',
        agent,
        headers: {
          'accept-encoding': 'gzip, br',
          'user-agent': `${this.options.label}/1.0`,
          ...options.headers,
          ...(options.body ? { 'content-length': String(Buffer.byteLength(options.body)) } : {}),
        },
      }, (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', error => reject(new HttpError(error.message, status, true)));
        response.on('end', () => {
          if (status < 200 || status >= 300) {
            const transient = (options.retryStatus ?? RETRY_STATUS).includes(status);
            const detail = Buffer.concat(chunks).toString('utf8').slice(0, 120);
            reject(new HttpError(`${this.options.label} HTTP ${status}${detail ? `：${detail}` : ''}`, status, transient));
            return;
          }
          try {
            resolve(decode(Buffer.concat(chunks), response.headers['content-encoding']));
          } catch (error) {
            reject(new HttpError(error instanceof Error ? error.message : '响应解压失败', status, true));
          }
        });
      });
      // 总时限：连接、隧道、慢速响应都算在内，挂起只会变成一次可重试的超时，不会卡住整个任务。
      const deadline = setTimeout(() => request.destroy(new HttpError(`${this.options.label} 请求超时`, null, true)), timeoutMs);
      request.once('close', () => clearTimeout(deadline));
      request.on('error', error => reject(
        error instanceof HttpError ? error : new HttpError(error.message, null, true)));
      if (options.body) request.write(options.body);
      request.end();
    });
  }
}

/** 经 HTTP 代理的 https：在 Agent 里先发 CONNECT 再套 TLS，连接池和超时照常由 Agent/请求管理。 */
class TunnelAgent extends HttpsAgent {
  private readonly proxy: URL;
  constructor(proxy: string) {
    super({ keepAlive: true, maxSockets: 8 });
    this.proxy = new URL(proxy);
  }

  override createConnection(options: ConnectionOptions, done: (error: Error | null, socket?: Duplex) => void): undefined {
    const connect = httpRequest({
      host: this.proxy.hostname, port: this.proxy.port || 80, method: 'CONNECT', path: `${options.host}:${options.port}`,
    });
    connect.once('connect', (response, socket) => {
      if (response.statusCode === 200) done(null, tlsConnect({ ...options, socket, servername: options.servername || options.host }));
      else { socket.destroy(); done(new HttpError(`代理拒绝 CONNECT ${response.statusCode}`, null, true)); }
    });
    connect.once('error', error => done(new HttpError(error.message, null, true)));
    connect.end();
    return undefined;
  }
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (encoding === 'gzip') return gunzipSync(body);
  if (encoding === 'br') return brotliDecompressSync(body);
  return body;
}
