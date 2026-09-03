/**
 * 讨论实时广播器（内存单例）。
 *
 * 多人讨论在后台异步跑（runDiscussion），前端本应轮询才能看到进展。
 * 这里提供一个进程内的广播器：后端每写一条消息 / 变更一次状态就 publish，
 * 前端通过 SSE 端点订阅同一键（discussion id）来收到「有变化」的通知，再回源拉取。
 *
 * 说明：本应用是本地单实例（Next.js + SQLite），用模块级 Map 即可跨请求共享；
 * 若未来多实例部署，需要换成 Redis pub/sub 之类的外部通道。
 */
type Listener = (event: { type: string }) => void;

const channels = new Map<string, Set<Listener>>();

/** 订阅某个 discussion 的通知，返回取消订阅函数 */
export function subscribe(id: string, cb: Listener): () => void {
  let set = channels.get(id);
  if (!set) {
    set = new Set();
    channels.set(id, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) channels.delete(id);
  };
}

/** 向某个 discussion 的所有订阅方广播一个通知 */
export function publish(id: string, event: { type: string }) {
  const set = channels.get(id);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(event);
    } catch {
      /* 忽略单个监听器异常 */
    }
  }
}
