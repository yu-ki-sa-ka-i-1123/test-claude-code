// LockService のラッパー。Webhook受信処理と定期判定ジョブの両方から使い、
// 同時実行によるシートへの二重書き込み(=二重送信)を防ぐ。

function withScriptLock(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(timeoutMs || 30000);
  if (!acquired) {
    throw new Error('LockService: ロック取得がタイムアウトしました。他の処理の完了を待って再試行してください。');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
