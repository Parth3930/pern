/// Structured logging setup using tracing
/// Provides consistent logging across the application with JSON output support

use std::path::PathBuf;
use tracing::info;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize the tracing subscriber with console and file output
/// Returns a guard that must be kept alive for the duration of the application
pub fn init_tracing(app_handle: &tauri::AppHandle) -> Result<WorkerGuard, Box<dyn std::error::Error + Send + Sync>> {
    let log_dir = get_log_dir(app_handle)?;
    std::fs::create_dir_all(&log_dir)?;

    let file_appender = tracing_appender::rolling::daily(&log_dir, "pern.log");
    let (non_blocking_file, guard) = tracing_appender::non_blocking(file_appender);

    // Console layer with pretty formatting for development
    let console_layer = fmt::layer()
        .with_target(false)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_level(true)
        .with_ansi(cfg!(debug_assertions));

    // File layer with JSON formatting for production/log aggregation
    let file_layer = fmt::layer()
        .with_target(false)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_level(true)
        .with_ansi(false)
        .json()
        .with_writer(non_blocking_file);

    // Environment filter - can be overridden with RUST_LOG
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,pern=debug,tauri=warn"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    info!("Tracing initialized. Log directory: {:?}", log_dir);
    Ok(guard)
}

/// Get the log directory for the application
fn get_log_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let app_dir = app_handle.path().app_log_dir()?;
    Ok(app_dir)
}

/// Helper to create a span for an operation with structured fields
pub fn operation_span(name: &str) -> tracing::Span {
    tracing::info_span!("operation", name = %name)
}

/// Helper to log the start and end of an operation with timing
pub fn log_operation<F, T>(name: &str, f: F) -> T
where
    F: FnOnce() -> T,
{
    let span = operation_span(name);
    let _enter = span.enter();
    let start = std::time::Instant::now();

    info!(name = %name, "Starting operation");

    let result = f();

    let elapsed = start.elapsed();
    info!(name = %name, elapsed_ms = elapsed.as_millis(), "Completed operation");

    result
}

/// Async version of log_operation
pub async fn log_operation_async<F, Fut, T>(name: &str, f: F) -> T
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let span = operation_span(name);
    let _enter = span.enter();
    let start = std::time::Instant::now();

    info!(name = %name, "Starting operation");

    let result = f().await;

    let elapsed = start.elapsed();
    info!(name = %name, elapsed_ms = elapsed.as_millis(), "Completed operation");

    result
}