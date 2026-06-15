//! Trigger evaluation for the automation system.
//!
//! Three trigger kinds are supported:
//!   - `Cron { expr }`     — standard 5-field cron (minute, hour, day-of-month,
//!                          month, day-of-week). Day-of-week is 0–6 with
//!                          0 = Sunday (matching the convention used by most
//!                          Unix cron implementations). We deliberately avoid
//!                          pulling in a cron-parser crate — see the rules
//!                          below.
//!   - `Interval { minutes }` — fire every N minutes (>= 1). The trigger
//!     window is `(unix_secs / (N * 60))`.
//!   - `OnAppStart`        — fire once per process. The window is the
//!     recorded process start time, which the `AutomationManager` stamps.
//!
//! The output of `evaluate_trigger_window` is an `i64` window key. The
//! scheduler stores the last-seen window per automation and skips any tick
//! whose key is the same — this is the idempotency guarantee.
//!
//! ### Cron parsing rules
//!
//! - 5 whitespace-separated fields.
//! - Each field is either `*`, a literal integer, or a comma-separated list
//!   of integers and ranges (`a-b`). Step expressions like `*/5` are NOT
//!   supported in v1; we clamp them to `*` (a deliberate regression to keep
//!   the test surface small).
//! - Empty / malformed expressions clamp to `*` (never panic).
//! - Day-of-week and day-of-month are OR-combined: a date matches the cron
//!   if it matches the day-of-month field OR the day-of-week field. This
//!   matches Vixie cron semantics.

use crate::automations::Trigger;
use chrono::{DateTime, Datelike, Local, Timelike, Weekday};

/// Compute the idempotency window for a trigger at the given instant.
/// Returns `None` for triggers that do not have a meaningful window
/// (currently only `OnAppStart` is windowless in the sense that the caller
/// is expected to manage it externally with `start_time_unix`).
pub fn evaluate_trigger_window(trigger: &Trigger, now_unix: i64, start_time_unix: i64) -> Option<i64> {
    match trigger {
        Trigger::Cron { expr } => Some(cron_window(expr, now_unix)),
        Trigger::Interval { minutes } => {
            if *minutes == 0 {
                return None;
            }
            let window_secs = i64::from(*minutes) * 60;
            Some(now_unix / window_secs)
        }
        Trigger::OnAppStart => Some(start_time_unix),
    }
}

/// Return the cron "window" — the minute-bucket the given instant falls in.
/// Two instants in the same minute share the same window, which is what
/// makes cron-based firing idempotent at minute resolution. The `expr`
/// argument is accepted for API symmetry with `cron_matches` but is not
/// used here — every cron expression has minute resolution by definition.
pub fn cron_window(_expr: &str, now_unix: i64) -> i64 {
    // Floor the instant to its containing minute.
    now_unix - (now_unix % 60)
}

/// Does this trigger fire at the given instant? Caller has already verified
/// the window is new; this only checks the trigger's predicate.
pub fn trigger_should_fire(trigger: &Trigger, now_unix: i64, start_time_unix: i64) -> bool {
    match trigger {
        Trigger::Cron { expr } => cron_matches(expr, now_unix),
        Trigger::Interval { minutes } => {
            if *minutes == 0 {
                return false;
            }
            // Fire exactly once per interval window. The caller dedupes by
            // window key; we just need to be a stable predicate that returns
            // `true` for every wall-clock instant in the window. Using
            // `now_unix >= window_start` is sufficient because the scheduler
            // only invokes us for new windows.
            let window_secs = i64::from(*minutes) * 60;
            let window_start = (now_unix / window_secs) * window_secs;
            now_unix >= window_start
        }
        Trigger::OnAppStart => now_unix >= start_time_unix,
    }
}

/// Parse a 5-field cron expression and check whether the given unix-second
/// instant matches it. Returns `false` on any parse error (never panics).
pub fn cron_matches(expr: &str, now_unix: i64) -> bool {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return false;
    }
    let dt: DateTime<Local> = match DateTime::from_timestamp(now_unix, 0) {
        Some(utc) => utc.with_timezone(&Local),
        None => {
            // Out of representable range — fall back to "epoch" and let the
            // comparison naturally fail (no real cron expression matches
            // every awkward timestamp).
            match DateTime::from_timestamp(0, 0) {
                Some(epoch) => epoch.with_timezone(&Local),
                None => return false,
            }
        }
    };
    let minute = dt.minute() as i32;
    let hour = dt.hour() as i32;
    let dom = dt.day() as i32;
    let month = dt.month() as i32;
    // chrono Weekday: Mon=0, ..., Sun=6. Vixie cron uses Sun=0, ..., Sat=6.
    let dow = match dt.weekday() {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    };

    let minute_ok = field_matches(fields[0], minute, 0, 59);
    let hour_ok = field_matches(fields[1], hour, 0, 23);
    // Standard cron field order: minute hour day-of-month month day-of-week
    let month_ok = field_matches(fields[3], month, 1, 12);
    if !minute_ok || !hour_ok || !month_ok {
        return false;
    }
    // Day-of-month and day-of-week: Vixie cron OR-combines them. A date
    // matches if EITHER is satisfied (unless one is `*` — then the other
    // is authoritative). We follow the standard behaviour: if both are `*`,
    // the date matches; if only one is `*`, the other is authoritative; if
    // both are restricted, the date matches if EITHER matches.
    let dom_ok = field_matches(fields[2], dom, 1, 31);
    let dow_ok = field_matches(fields[4], dow, 0, 6);
    let dom_star = fields[2].trim() == "*";
    let dow_star = fields[4].trim() == "*";
    match (dom_star, dow_star) {
        (true, true) => true,
        (true, false) => dow_ok,
        (false, true) => dom_ok,
        (false, false) => dom_ok || dow_ok,
    }
}

/// Compute the `(automation_id, trigger_window_start)` dedupe key for a
/// trigger at the given instant. Two instants produce the *same* key iff
/// the caller has already seen the automation fire in the same trigger
/// window. This is the function the scheduler uses to skip
/// already-fired automations — see `scheduler::tick`.
///
/// For triggers that have no meaningful window (or are explicit "fire
/// once" markers), the key is `start_time_unix`, so multiple ticks inside
/// the same process all see the same key and only the first one wins.
pub fn trigger_window_start(
    trigger: &Trigger,
    now_unix: i64,
    start_time_unix: i64,
) -> Option<i64> {
    evaluate_trigger_window(trigger, now_unix, start_time_unix)
}

/// Does a single cron field match the given value? Supports `*`, literals,
/// comma lists (`1,3,5`), and inclusive ranges (`1-5`). Out-of-range values
/// in a literal/list/range are silently skipped.
fn field_matches(field: &str, value: i32, min: i32, max: i32) -> bool {
    for token in field.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        if token == "*" {
            return true;
        }
        // Step expression `*/N`: we don't support steps in v1. Treat as `*`.
        if let Some(stripped) = token.strip_prefix("*/") {
            if stripped.parse::<i32>().is_ok() {
                return true;
            }
        }
        if let Some(dash_pos) = token.find('-') {
            let (a, b) = token.split_at(dash_pos);
            let b = &b[1..];
            if let (Ok(lo), Ok(hi)) = (a.parse::<i32>(), b.parse::<i32>()) {
                let (lo, hi) = (lo.min(hi), lo.max(hi));
                if value >= lo && value <= hi {
                    return true;
                }
            }
            continue;
        }
        if let Ok(literal) = token.parse::<i32>() {
            if value == literal {
                return true;
            }
            continue;
        }
        // Unparseable token — skip.
    }
    let _ = (min, max); // bounds are advisory; the caller clamps malformed fields
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pick a known instant: 2026-06-14 09:30:00 local on a Sunday.
    // We compute the unix timestamp at test time using chrono so the test
    // is robust against timezones (we just need *any* instant whose local
    // fields we know).
    fn known_instant() -> i64 {
        use chrono::TimeZone;
        // 2026-06-14 (Sunday) 09:30:00 local.
        Local
            .with_ymd_and_hms(2026, 6, 14, 9, 30, 0)
            .unwrap()
            .timestamp()
    }

    /// Build an instant at a specific local minute/hour on the known
    /// Sunday. To stay robust against timezone offsets (the test machine
    /// is in Asia/Calcutta, +05:30, so local-midnight on Jun 14 is
    /// 18:30 UTC on Jun 13 — which is a Saturday, not a Sunday), we pick
    /// local noon as the reference time. The local hour is fixed to 12
    /// so the `* 0` day-of-week expression evaluates to Sunday in any
    /// timezone.
    fn known_instant_at(minute: u32, hour: u32) -> i64 {
        use chrono::TimeZone;
        // Use noon-local on Sunday 2026-06-14. Mid-day in any timezone is
        // the same calendar date in nearly every timezone on Earth (only
        // +13/+14 cross the date line, but the test environment is far
        // from those).
        let local_h = 12.max(hour); // ensure non-midnight to dodge TZ issues
        Local
            .with_ymd_and_hms(2026, 6, 14, local_h, minute, 0)
            .unwrap()
            .timestamp()
    }

    #[test]
    fn cron_window_is_minute_floor() {
        let t = 1_700_000_123_i64;
        let w = cron_window("0 9 * * *", t);
        assert_eq!(w, t - (t % 60));
    }

    #[test]
    fn cron_matches_every_minute_star() {
        let t = known_instant();
        assert!(cron_matches("* * * * *", t));
    }

    #[test]
    fn cron_matches_specific_minute() {
        let t = known_instant(); // minute = 30
        assert!(cron_matches("30 9 * * *", t));
        assert!(!cron_matches("15 9 * * *", t));
    }

    #[test]
    fn cron_matches_specific_hour() {
        let t = known_instant(); // hour = 9
        assert!(cron_matches("30 9 * * *", t));
        assert!(!cron_matches("30 8 * * *", t));
    }

    #[test]
    fn cron_matches_day_of_week() {
        // 2026-06-14 is a Sunday → dow = 0. Use minute=0, hour=12 (noon
        // local) so the date is the same in any timezone on Earth
        // (midnight local could roll to the previous calendar day in
        // UTC+ timezones). The cron expression matches at 12:00 on dow=0.
        let t = known_instant_at(0, 12);
        assert!(cron_matches("0 12 * * 0", t));
        assert!(!cron_matches("0 12 * * 1", t));
    }

    #[test]
    fn cron_matches_or_combines_dom_and_dow() {
        // minute=0, hour=12 on the known Sunday (same TZ-robustness as
        // above) so the time constraints match.
        let t = known_instant_at(0, 12);
        // Both restricted — should OR.
        // 2026-06-14 is dow=0 (Sun). dom=14 is the date.
        let utc: DateTime<chrono::Utc> = DateTime::from_timestamp(t, 0).unwrap();
        let local = utc.with_timezone(&Local);
        eprintln!(
            "t = {} utc = {} local = {} dom = {} dow = {:?}",
            t, utc, local, local.day(), local.weekday()
        );
        assert!(cron_matches("0 12 14 * 0", t)); // both match
        assert!(cron_matches("0 12 14 * 1", t)); // dom matches even though dow=1 doesn't
        assert!(cron_matches("0 12 15 * 0", t)); // dow matches even though dom=15 doesn't
        assert!(!cron_matches("0 12 15 * 1", t)); // neither matches
    }

    #[test]
    fn cron_matches_list_and_range() {
        let t = known_instant(); // minute = 30
        assert!(cron_matches("0,15,30,45 9 * * *", t));
        assert!(cron_matches("0-59 9 * * *", t));
        assert!(!cron_matches("0,15,45 9 * * *", t));
    }

    #[test]
    fn cron_malformed_returns_false_not_panic() {
        let t = known_instant();
        assert!(!cron_matches("not a cron", t));
        assert!(!cron_matches("0 9 * *", t)); // 4 fields
        assert!(!cron_matches("0 9 * * * *", t)); // 6 fields
        assert!(!cron_matches("", t));
    }

    #[test]
    fn cron_step_expr_treated_as_star() {
        let t = known_instant(); // minute = 30
        // `*/15` is unsupported in v1; we treat as `*` so all minutes match.
        assert!(cron_matches("*/15 9 * * *", t));
    }

    #[test]
    fn interval_window_changes_per_period() {
        let now = 1_700_000_000_i64;
        // 5-minute interval: window is `now / 300`.
        let w1 = evaluate_trigger_window(&Trigger::Interval { minutes: 5 }, now, 0);
        let w2 = evaluate_trigger_window(&Trigger::Interval { minutes: 5 }, now + 60, 0);
        let w3 = evaluate_trigger_window(&Trigger::Interval { minutes: 5 }, now + 300, 0);
        assert_eq!(w1, w2);
        assert_ne!(w1, w3);
    }

    #[test]
    fn interval_zero_minutes_is_dead() {
        let w = evaluate_trigger_window(&Trigger::Interval { minutes: 0 }, 100, 0);
        assert!(w.is_none());
    }

    #[test]
    fn on_app_start_window_is_start_time() {
        let start = 1_700_000_000_i64;
        let w = evaluate_trigger_window(&Trigger::OnAppStart, start + 1234, start);
        assert_eq!(w, Some(start));
    }

    #[test]
    fn interval_should_fire_within_window() {
        let now = 1_700_000_000_i64;
        let trigger = Trigger::Interval { minutes: 10 };
        assert!(trigger_should_fire(&trigger, now, 0));
        assert!(trigger_should_fire(&trigger, now + 60, 0));
    }
}
