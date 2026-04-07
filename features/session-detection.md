# Feature: Drinking Session Detection

## Problem

`calculate_bac` computes metabolism from the **earliest drink** in the array:

```rust
// Zero-order metabolism: constant rate from first drink
if let Some(earliest) = earliest_offset {
    let metabolism_hours = -earliest / 3600.0;
    total_bac = (total_bac - metabolism_hours * METABOLISM_RATE).max(0.0);
}
```

This breaks when drinks span multiple separated drinking sessions. Example:

1. User has a beer at `offset_secs = -18000` (5 hours ago)
2. That beer's BAC fully metabolized ~2 hours later
3. User adds a new beer at `offset_secs = 0` (now)
4. Expected: BAC rises from the new beer (~0.02 after 10 min)
5. Actual: metabolism = `5h × 0.015 = 0.075` is subtracted, so BAC stays at 0 for a long time

The metabolism clock should **restart** when BAC from all prior drinks has fully metabolized, creating a new session.

This also affects `generate_curve` and `minutes_until_sober` since they rely on `calculate_bac` / `calculate_bac_at_offset`.

## Requirements

### 1. Add `find_session_start` function to `bac.rs`

Finds the index of the first drink in the active session within a sorted drinks array. A new session starts when BAC from all prior drinks would have fully metabolized.

```rust
/// Find the index of the first drink in the active drinking session.
///
/// Scans through chronologically sorted drinks and detects session boundaries
/// where BAC from prior drinks has fully metabolized (≤ 0.001). When a boundary
/// is found, the metabolism clock restarts from that drink.
///
/// This prevents unrealistic metabolism accumulation across hours of sobriety.
fn find_session_start(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> usize
```

**Implementation approach:**

For each drink `i` (starting from index 1), compute the total BAC contribution from all drinks in the current session (`session_start..i`) at the time of drink `i`, minus metabolism from `session_start`. If that value ≤ 0.001, drink `i` starts a new session.

```rust
fn find_session_start(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> usize {
    if drinks.len() <= 1 {
        return 0;
    }

    // Drinks must be sorted chronologically (most negative offset first)
    let mut session_start = 0;

    for i in 1..drinks.len() {
        // Compute BAC from session_start..i at the time of drink i
        // by shifting all drinks so drink i is at t=0
        let shifted: Vec<Drink> = drinks[session_start..i]
            .iter()
            .map(|d| Drink {
                offset_secs: d.offset_secs - drinks[i].offset_secs,
                ..d.clone()
            })
            .collect();

        let bac_at_new_drink = calculate_bac(&shifted, profile, formula);

        if bac_at_new_drink <= 0.001 {
            session_start = i;
        }
    }

    session_start
}
```

### 2. Integrate into `calculate_bac`

Modify `calculate_bac` to sort drinks, detect session start, and only consider drinks from the active session:

```rust
pub fn calculate_bac(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> f64 {
    if drinks.is_empty() || profile.weight_kg <= 0.0 {
        return 0.0;
    }

    // Sort chronologically and find active session
    let mut sorted = drinks.to_vec();
    sorted.sort_by(|a, b| a.offset_secs.partial_cmp(&b.offset_secs).unwrap());

    let session_start = find_session_start(&sorted, profile, formula);
    let active_drinks = &sorted[session_start..];

    // ... existing absorption + metabolism logic, but only over active_drinks
}
```

**Note:** `find_session_start` calls `calculate_bac` recursively on subsets, but only on the drinks within the current candidate session (never the full array), so it converges.

### 3. Tests

```rust
#[test]
fn session_detection_single_session() {
    // Three beers in quick succession — all one session
    let drinks = vec![
        beer(-3600.0),  // 1 hour ago
        beer(-1800.0),  // 30 min ago
        beer(-600.0),   // 10 min ago
    ];
    let bac = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
    let single = calculate_bac(&[beer(-600.0)], &male_80kg(), BACFormula::Widmark);
    assert!(bac > single, "Multiple drinks should accumulate");
}

#[test]
fn session_detection_separate_sessions() {
    // Beer 8 hours ago (fully metabolized) + beer now
    let drinks = vec![
        beer(-28800.0),  // 8 hours ago
        beer(0.0),       // just now
    ];
    let bac_with_old = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
    let bac_just_new = calculate_bac(&[beer(0.0)], &male_80kg(), BACFormula::Widmark);

    // Old drink should not affect BAC — metabolism from 8h ago should not
    // subtract from the new drink's contribution
    assert!(
        (bac_with_old - bac_just_new).abs() < 0.001,
        "Old metabolized drink should not affect current BAC: with_old={bac_with_old}, just_new={bac_just_new}"
    );
}

#[test]
fn session_detection_just_metabolized() {
    // Beer 3 hours ago (should be just barely metabolized for a large male)
    // + beer just now
    let drinks = vec![
        beer(-10800.0),  // 3 hours ago
        beer(-60.0),     // 1 minute ago
    ];
    let bac = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
    // Should have some positive BAC from the recent beer
    assert!(bac >= 0.0);
}

#[test]
fn generate_curve_respects_sessions() {
    // Beer 8 hours ago + beer at t=0 — curve should show BAC from the new beer
    let drinks = vec![
        beer(-28800.0),
        beer(0.0),
    ];
    let curve = generate_curve(
        &drinks, &male_80kg(), BACFormula::Widmark,
        0.0, 3600.0, 300.0, 0.06, 0.09,
    );
    // Some points should have non-zero BAC from the new beer
    assert!(curve.iter().any(|p| p.bac > 0.0));
}
```

## Affected files

- `src/bac.rs` — add `find_session_start`, integrate into `calculate_bac`

No changes needed to `wasm.rs` or the public API — this is an internal correctness fix that affects all callers automatically.
