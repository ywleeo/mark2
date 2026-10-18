use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::time::sleep;

/// 退避序列：2s / 8s / 30s，共三次。
/// 与《订单支付重试机制改造方案》里的结论保持一致，改这里要同步改文档。
const BACKOFF: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(8),
    Duration::from_secs(30),
];

/// 渠道返回的错误分类。
/// 只有 `Transient` 才进重试队列，`Declined` 一律转终态，避免把「卡被拒」也重试一遍。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelError {
    /// 渠道超时、限流、网络抖动等瞬时错误。
    Transient,
    /// 余额不足、卡被拒等明确失败。
    Declined,
    /// 渠道熔断中，直接放弃本轮重试。
    CircuitOpen,
}

/// 一笔待重试的支付单。
///
/// `idempotency_key` 在所有重试之间保持不变，渠道侧据此保证只扣一次款。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAttempt {
    pub payment_id: String,
    pub idempotency_key: String,
    pub channel: String,
    pub amount_cents: i64,
    pub attempt: usize,
    #[serde(skip, default = "Instant::now")]
    pub first_seen: Instant,
}

impl PaymentAttempt {
    /// 下一次重试前需要等待的时长；返回 `None` 表示次数已经用尽。
    pub fn next_backoff(&self) -> Option<Duration> {
        BACKOFF.get(self.attempt).copied()
    }

    /// 从首次请求算起已经过去多久，对账时按这个时间归集。
    pub fn elapsed(&self) -> Duration {
        self.first_seen.elapsed()
    }
}

/// 重试队列的运行指标，暴露给监控面板。
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryMetrics {
    pub enqueued: AtomicU64,
    pub recovered: AtomicU64,
    pub exhausted: AtomicU64,
}

impl RetryMetrics {
    fn record_enqueue(&self) {
        self.enqueued.fetch_add(1, Ordering::Relaxed);
    }

    fn record_result(&self, recovered: bool) {
        let counter = if recovered {
            &self.recovered
        } else {
            &self.exhausted
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    /// 重试挽回率：recovered / (recovered + exhausted)。
    pub fn recovery_rate(&self) -> f64 {
        let ok = self.recovered.load(Ordering::Relaxed) as f64;
        let failed = self.exhausted.load(Ordering::Relaxed) as f64;
        if ok + failed == 0.0 {
            return 0.0;
        }
        ok / (ok + failed)
    }
}

/// 支付重试队列。
///
/// 设计上只做三件事：判断该不该重试、按退避排队、把结果回报给调用方。
/// 真正的扣款动作由传入的 `submit` 闭包完成，方便在测试里替换成假渠道。
pub struct RetryQueue {
    inflight: Mutex<HashMap<String, PaymentAttempt>>,
    metrics: Arc<RetryMetrics>,
    sender: mpsc::Sender<PaymentAttempt>,
}

impl RetryQueue {
    pub fn new(capacity: usize) -> (Arc<Self>, mpsc::Receiver<PaymentAttempt>) {
        let (sender, receiver) = mpsc::channel(capacity);
        let queue = Arc::new(Self {
            inflight: Mutex::new(HashMap::new()),
            metrics: Arc::new(RetryMetrics::default()),
            sender,
        });
        (queue, receiver)
    }

    pub fn metrics(&self) -> Arc<RetryMetrics> {
        Arc::clone(&self.metrics)
    }

    /// 处理一次渠道返回。返回 `true` 表示已排进重试队列。
    pub async fn on_channel_error(
        &self,
        mut attempt: PaymentAttempt,
        error: ChannelError,
    ) -> bool {
        if error != ChannelError::Transient {
            self.finish(&attempt.payment_id, false);
            return false;
        }

        let Some(delay) = attempt.next_backoff() else {
            self.finish(&attempt.payment_id, false);
            return false;
        };

        attempt.attempt += 1;
        self.inflight
            .lock()
            .insert(attempt.payment_id.clone(), attempt.clone());
        self.metrics.record_enqueue();

        // 退避等待放在队列内部，调用方不需要关心定时器。
        sleep(delay).await;
        self.sender.send(attempt).await.is_ok()
    }

    /// 渠道最终确认后调用，清理在途记录并记一次指标。
    pub fn finish(&self, payment_id: &str, recovered: bool) {
        if self.inflight.lock().remove(payment_id).is_some() || recovered {
            self.metrics.record_result(recovered);
        }
    }

    /// 当前仍在重试中的支付单数量，灰度期间盯这个值。
    pub fn inflight_len(&self) -> usize {
        self.inflight.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt(id: &str, n: usize) -> PaymentAttempt {
        PaymentAttempt {
            payment_id: id.to_string(),
            idempotency_key: format!("idem-{id}"),
            channel: "alipay".to_string(),
            amount_cents: 12_900,
            attempt: n,
            first_seen: Instant::now(),
        }
    }

    #[test]
    fn backoff_runs_out_after_three_attempts() {
        assert_eq!(attempt("p1", 0).next_backoff(), Some(BACKOFF[0]));
        assert_eq!(attempt("p1", 2).next_backoff(), Some(BACKOFF[2]));
        assert_eq!(attempt("p1", 3).next_backoff(), None);
    }

    #[tokio::test]
    async fn declined_is_not_retried() {
        let (queue, _rx) = RetryQueue::new(8);
        let queued = queue
            .on_channel_error(attempt("p2", 0), ChannelError::Declined)
            .await;
        assert!(!queued);
        assert_eq!(queue.inflight_len(), 0);
    }
}
