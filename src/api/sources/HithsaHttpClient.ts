/**
 * HithsaHttpClient —— 同花顺金融数据服务官方 REST 客户端（底层 HTTP 封装）。
 *
 * 契约要点（来自 skill 官方契约）：
 *  - Base URL: https://fuyao.aicubes.cn
 *  - 认证: HTTP Header `X-api-key: <API_KEY>`
 *  - 成功判定: HTTP 200 且响应 `code == 0`
 *  - 响应信封: { code, message, request_id, data }
 *  - thscode: 完整代码（如 600519.SH），不许纯 6 位代码
 *  - 时间戳: 毫秒 Unix 时间戳
 *  - 空值: null 表示未披露，不得补零
 *
 * 本类负责：读写 API Key（从安全存储/环境变量读取，绝不硬编码）、拼 URL、发请求、
 * 解析信封、按 code 抛 DataSourceError（携带上游 code）、对有界错误码做指数退避重试。
 *
 * 注意：RN 端没有 Node 的 fetch 全局（0.87 起已内置 global fetch），但为兼容稳妥，
 * 这里优先用 global fetch；若运行环境无 fetch 可后续替换为 axios/react-native-netinfo。
 */
import { DataSourceError } from '../MarketDataSource';

const BASE_URL = 'https://fuyao.aicubes.cn';
const SOURCE_ID = 'hithsa';

/** 从安全位置读取 API Key 的抽象。默认从全局注入（如 RN 的 Config / 环境变量）。 */
export type ApiKeyProvider = () => string | undefined;

export interface Envelope<T> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

export class HithsaHttpClient {
  private apiKeyProvider: ApiKeyProvider;
  private baseUrl: string;

  constructor(apiKeyProvider?: ApiKeyProvider, baseUrl: string = BASE_URL) {
    this.apiKeyProvider = apiKeyProvider ?? (() => HithsaHttpClient.resolveUnifiedKey());
    this.baseUrl = baseUrl;
  }

  /** 默认 Key 来源：全局注入（由 App 在启动时设置），避免写死到代码/逻辑中 */
  private static _defaultKey: string | undefined;
  static setDefaultKey(key: string | undefined): void {
    this._defaultKey = key;
  }
  private static defaultKey(): string | undefined {
    return this._defaultKey;
  }

  /**
   * 统一 API Key 解析（Skill 核心规则：所有接口复用同一把 Key）。
   * 优先级：显式注入的 _defaultKey -> 统一环境变量 HITHINK_FINANCE_API_KEY。
   * 禁止重复/硬编码 Key，所有 hithsa 调用均从此处取。
   */
  private static resolveUnifiedKey(): string | undefined {
    if (this._defaultKey) return this._defaultKey;
    return process.env?.HITHINK_FINANCE_API_KEY;
  }

  /** 供源层在每次调用前确保统一 Key 已就绪（无副作用，若已注入则保持）。 */
  static setHithsaKey(): void {
    // 当前仅依赖 resolveUnifiedKey 的默认值；保留为显式钩子以便后续扩展。
  }

  /** 读取 Key；缺失时抛明确错误 */
  private resolveKey(): string {
    const key = this.apiKeyProvider();
    if (!key) {
      throw new DataSourceError('缺少同花顺 API Key（X-api-key）', SOURCE_ID);
    }
    return key;
  }

  /** 发起 GET 请求并解析信封，返回 data。自动重试可重试错误。 */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    const key = this.resolveKey();
    const maxRetries = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'X-api-key': key, Accept: 'application/json' },
        });
        if (!resp.ok) {
          throw new DataSourceError(`HTTP ${resp.status}`, SOURCE_ID);
        }
        const env = (await resp.json()) as Envelope<T>;
        if (env.code !== 0) {
          throw new DataSourceError(env.message || `业务错误 code=${env.code}`, SOURCE_ID, env.code);
        }
        return env.data;
      } catch (err) {
        lastErr = err;
        const de = err instanceof DataSourceError ? err : new DataSourceError(String(err), SOURCE_ID);
        if (!de.retryable || attempt >= maxRetries) {
          throw de;
        }
        // 指数退避：400ms, 800ms, 1600ms
        const backoff = 400 * Math.pow(2, attempt);
        await new Promise<void>((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr instanceof Error ? lastErr : new DataSourceError(String(lastErr), SOURCE_ID);
  }

  private buildUrl(path: string, query: Record<string, string | number | undefined>): string {
    const qs: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    const sep = path.includes('?') ? '&' : '?';
    return `${this.baseUrl}${path}${qs.length ? sep + qs.join('&') : ''}`;
  }
}
