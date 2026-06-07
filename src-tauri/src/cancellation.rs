/// Cancellation utilities for async operations
/// Provides CancellationToken support for clean async cancellation
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use thiserror::Error;
use tokio::sync::Notify;

/// A simple cancellation token implementation
#[derive(Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
    notifier: Arc<Notify>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            notifier: Arc::new(Notify::new()),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notifier.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notifier.notified().await;
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Error returned when an operation is cancelled
#[derive(Debug, Error)]
pub enum CancellationError {
    #[error("Operation was cancelled")]
    Cancelled,
}

/// A wrapper that adds cancellation support to any future
pub struct Cancellable<F> {
    future: F,
    token: CancellationToken,
}

impl<F> Cancellable<F> {
    pub fn new(future: F, token: CancellationToken) -> Self {
        Self { future, token }
    }
}

impl<F: Future> Future for Cancellable<F> {
    type Output = Result<F::Output, CancellationError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        // Check if cancelled first
        if self.token.is_cancelled() {
            return Poll::Ready(Err(CancellationError::Cancelled));
        }

        // Poll the inner future
        let future = unsafe { self.as_mut().map_unchecked_mut(|s| &mut s.future) };
        match future.poll(cx) {
            Poll::Ready(output) => Poll::Ready(Ok(output)),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Extension trait to add cancellation support to futures
pub trait CancellableExt: Future + Sized {
    fn with_cancellation(self, token: CancellationToken) -> Cancellable<Self>;
}

impl<F: Future> CancellableExt for F {
    fn with_cancellation(self, token: CancellationToken) -> Cancellable<Self> {
        Cancellable::new(self, token)
    }
}

/// Helper to run a future with a timeout and cancellation support
pub async fn with_timeout_and_cancellation<F, T>(
    future: F,
    timeout: std::time::Duration,
    token: CancellationToken,
) -> Result<T, CancellationError>
where
    F: Future<Output = T>,
{
    tokio::select! {
        result = future => Ok(result),
        _ = tokio::time::sleep(timeout) => {
            token.cancel();
            Err(CancellationError::Cancelled)
        }
        _ = token.cancelled() => Err(CancellationError::Cancelled),
    }
}

/// Helper for retrying with cancellation support
pub async fn retry_with_cancellation<F, Fut, T, E>(
    mut operation: F,
    max_attempts: usize,
    base_delay: std::time::Duration,
    token: CancellationToken,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::error::Error + Send + Sync + 'static,
{
    let mut last_error: Option<E> = None;

    for attempt in 0..max_attempts {
        if token.is_cancelled() {
            return Err(last_error.unwrap_or_else(|| {
                // This shouldn't happen in practice, but we need to return something
                panic!("Operation cancelled with no previous error");
            }));
        }

        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = Some(e);
                if attempt < max_attempts - 1 {
                    let delay = base_delay * (2_u32.pow(attempt as u32));
                    tokio::select! {
                        _ = token.cancelled() => return Err(last_error.unwrap()),
                        _ = tokio::time::sleep(delay) => {}
                    }
                }
            }
        }
    }

    Err(last_error.unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_cancellation_token() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());

        token.cancel();
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn test_with_timeout_and_cancellation() {
        let token = CancellationToken::new();

        // Test successful completion
        let result =
            with_timeout_and_cancellation(async { 42 }, Duration::from_secs(1), token.clone())
                .await;
        assert_eq!(result.unwrap(), 42);

        // Test timeout
        let token2 = CancellationToken::new();
        let result = with_timeout_and_cancellation(
            async {
                tokio::time::sleep(Duration::from_secs(10)).await;
                42
            },
            Duration::from_millis(50),
            token2,
        )
        .await;
        assert!(result.is_err());
    }
}
