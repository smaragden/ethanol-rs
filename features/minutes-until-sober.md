# Feature: Improved Time-to-Sober Estimation

## Problem

The current `estimate_time_to_sober` function is too simplistic:

```rust
pub fn estimate_time_to_sober(current_bac: f64) -> Option<f64> {
    if current_bac <= 0.001 { return None; }
    let hours = current_bac / METABOLISM_RATE;
    Some(hours * 3600.0)
}
```

It takes only the current BAC and divides by the metabolism rate. This ignores **ongoing absorption** — if a drink was consumed recently, alcohol is still being absorbed and BAC may continue rising before it starts falling. The simple division underestimates the actual time to sober by potentially 30-60 minutes.

## Requirements

### 1. Add `minutes_until_sober` function to `bac.rs`

A new function that takes the full drink/profile context and uses a two-phase scan to find the actual minute BAC drops to zero:

```rust
/// Estimate minutes until BAC reaches zero, accounting for ongoing absorption.
///
/// Uses a coarse scan (5-minute steps) to find the approximate zero crossing,
/// then a fine scan (1-minute steps) for precision. This correctly handles
/// drinks still being absorbed where BAC may rise before falling.
///
/// Returns 0.0 if already sober. Caps at 24 hours.
pub fn minutes_until_sober(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> f64
```

**Implementation:**
```rust
pub fn minutes_until_sober(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> f64 {
    let current_bac = calculate_bac(drinks, profile, formula);
    if current_bac <= 0.001 {
        return 0.0;
    }

    let max_minutes: f64 = 24.0 * 60.0;
    let coarse_step: f64 = 5.0;

    // Coarse scan: 5-minute steps forward
    let mut coarse_minute = coarse_step;
    let mut found_minute = max_minutes;
    while coarse_minute <= max_minutes {
        let offset_secs = coarse_minute * 60.0;
        let bac = calculate_bac_at_offset(drinks, profile, formula, offset_secs);
        if bac <= 0.001 {
            found_minute = coarse_minute;
            break;
        }
        coarse_minute += coarse_step;
    }

    // Fine scan: 1-minute steps from one coarse step before the hit
    let fine_start = (found_minute - coarse_step).max(0.0);
    let mut fine_minute = fine_start;
    while fine_minute <= found_minute {
        let offset_secs = fine_minute * 60.0;
        let bac = calculate_bac_at_offset(drinks, profile, formula, offset_secs);
        if bac <= 0.001 {
            return fine_minute;
        }
        fine_minute += 1.0;
    }

    found_minute
}
```

**Note:** This depends on `calculate_bac_at_offset` being `pub` (or at least `pub(crate)`), as described in the `generate-curve.md` feature spec.

### 2. Keep `estimate_time_to_sober` as-is

The existing simple function is still useful for quick estimates when you only have a BAC value (no drink history). Don't remove it — just add the new function alongside it.

### 3. Add WASM binding in `wasm.rs`

```rust
#[wasm_bindgen(js_name = minutesUntilSober)]
pub fn minutes_until_sober(
    drinks: JsValue,
    profile: JsValue,
    formula: JsValue,
) -> Result<f64, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {e}")))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {e}")))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {e}")))?;

    Ok(crate::bac::minutes_until_sober(&drinks, &profile, formula))
}
```

### 4. Add UniFFI export in `bac.rs`

```rust
#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_minutes_until_sober(
    drinks: Vec<Drink>,
    profile: UserProfile,
    formula: BACFormula,
) -> f64 {
    minutes_until_sober(&drinks, &profile, formula)
}
```

### 5. Tests

```rust
#[test]
fn minutes_until_sober_when_already_sober() {
    let result = minutes_until_sober(&[], &male_80kg(), BACFormula::Widmark);
    assert_eq!(result, 0.0);
}

#[test]
fn minutes_until_sober_basic() {
    // 1 beer 1 hour ago — should be sober in a few hours
    let drinks = vec![beer(-3600.0)];
    let minutes = minutes_until_sober(&drinks, &male_80kg(), BACFormula::Widmark);
    assert!(minutes > 0.0, "Should need some time to sober up");
    assert!(minutes < 300.0, "Should be sober within 5 hours: {minutes}");
}

#[test]
fn minutes_until_sober_accounts_for_absorption() {
    // Drink just now — still absorbing, should be longer than simple estimate
    let drinks = vec![beer(0.0)];
    let profile = male_80kg();

    let current_bac = calculate_bac(&drinks, &profile, BACFormula::Widmark);
    let simple_minutes = if current_bac > 0.001 {
        (current_bac / METABOLISM_RATE) * 60.0
    } else {
        0.0
    };

    let accurate_minutes = minutes_until_sober(&drinks, &profile, BACFormula::Widmark);

    // The accurate version should be >= the simple version because it
    // accounts for BAC still rising from ongoing absorption
    assert!(
        accurate_minutes >= simple_minutes,
        "Accurate ({accurate_minutes}) should be >= simple ({simple_minutes})"
    );
}

#[test]
fn minutes_until_sober_multiple_drinks() {
    let drinks = vec![
        beer(-3600.0),  // 1 hour ago
        beer(-1800.0),  // 30 min ago
        beer(-600.0),   // 10 min ago
    ];
    let minutes = minutes_until_sober(&drinks, &male_80kg(), BACFormula::Widmark);
    assert!(minutes > 60.0, "3 beers should take > 1 hour: {minutes}");
}
```

## Affected files
- `src/bac.rs` — add `minutes_until_sober`, add UniFFI export
- `src/wasm.rs` — add `minutesUntilSober` WASM binding
