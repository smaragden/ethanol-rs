# Feature: Batch BAC Curve Generation

## Problem

ethanol-rs only provides single-point BAC calculation (`calculate_bac` computes BAC at `t = 0`). The web simulator needs to generate a full BAC curve over a time range (~180 points), which requires computing BAC at many different time offsets.

Without a batch function, callers must either:
1. Call `calculate_bac` in a loop from JS, paying serde serialization overhead per point (~180 JS↔WASM boundary crossings per frame), or
2. Create a wrapper crate that reimplements the time-shifting logic

Both are wasteful. The iteration should happen inside ethanol-rs.

## Requirements

### 1. Make `calculate_bac_at_offset` public

`bac.rs` already has the private function:

```rust
fn calculate_bac_at_offset(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    time_offset_secs: f64,
) -> f64
```

This shifts all drink offsets by `time_offset_secs` and calls `calculate_bac`. Change visibility to `pub` so it can be used by `generate_curve` and by downstream crates.

### 2. Add `CurvePoint` struct to `bac.rs`

```rust
#[derive(Debug, Clone)]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
pub struct CurvePoint {
    /// Time offset in seconds from the reference time.
    pub offset_secs: f64,
    /// BAC value at this point.
    pub bac: f64,
    /// Zone classification at this point.
    pub zone: BACZone,
}
```

### 3. Add `generate_curve` function to `bac.rs`

```rust
/// Generate a BAC curve over a time range.
///
/// Computes BAC at regular intervals from `from_offset_secs` to `to_offset_secs`,
/// returning a vector of `CurvePoint` with zone classification at each point.
///
/// All iteration happens internally — callers cross the FFI boundary only once.
///
/// # Parameters
/// - `drinks`: Drinks with `offset_secs` relative to `t = 0`
/// - `profile`: User physical profile
/// - `formula`: Widmark or Watson
/// - `from_offset_secs`: Start of the curve (seconds offset from t=0, typically negative for past)
/// - `to_offset_secs`: End of the curve (seconds offset from t=0, typically positive for future)
/// - `step_secs`: Step size in seconds (e.g., 60.0 for one-minute resolution)
/// - `sweet_spot_min` / `sweet_spot_max`: Zone classification thresholds
pub fn generate_curve(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    from_offset_secs: f64,
    to_offset_secs: f64,
    step_secs: f64,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> Vec<CurvePoint>
```

**Implementation:**
```rust
pub fn generate_curve(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    from_offset_secs: f64,
    to_offset_secs: f64,
    step_secs: f64,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> Vec<CurvePoint> {
    let mut points = Vec::new();
    let mut offset = from_offset_secs;

    while offset <= to_offset_secs {
        let bac = calculate_bac_at_offset(drinks, profile, formula, offset);
        let zone = crate::zone::classify_zone(bac, sweet_spot_min, sweet_spot_max);
        points.push(CurvePoint {
            offset_secs: offset,
            bac,
            zone,
        });
        offset += step_secs;
    }

    points
}
```

### 4. Add WASM binding in `wasm.rs`

```rust
#[wasm_bindgen(js_name = generateCurve)]
pub fn generate_curve(
    drinks: JsValue,
    profile: JsValue,
    formula: JsValue,
    from_offset_secs: f64,
    to_offset_secs: f64,
    step_secs: f64,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> Result<JsValue, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {e}")))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {e}")))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {e}")))?;

    let points = crate::bac::generate_curve(
        &drinks, &profile, formula,
        from_offset_secs, to_offset_secs, step_secs,
        sweet_spot_min, sweet_spot_max,
    );

    serde_wasm_bindgen::to_value(&points)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
}
```

### 5. Add UniFFI export in `bac.rs`

```rust
#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_curve(
    drinks: Vec<Drink>,
    profile: UserProfile,
    formula: BACFormula,
    from_offset_secs: f64,
    to_offset_secs: f64,
    step_secs: f64,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> Vec<CurvePoint> {
    generate_curve(
        &drinks, &profile, formula,
        from_offset_secs, to_offset_secs, step_secs,
        sweet_spot_min, sweet_spot_max,
    )
}
```

### 6. Tests

```rust
#[test]
fn generate_curve_returns_correct_point_count() {
    let drinks = vec![beer(-3600.0)]; // 1 hour ago
    let profile = male_80kg();
    // 60 minutes at 1-minute steps = 61 points (inclusive)
    let curve = generate_curve(&drinks, &profile, BACFormula::Widmark, -3600.0, 0.0, 60.0, 0.06, 0.09);
    assert_eq!(curve.len(), 61);
}

#[test]
fn generate_curve_bac_rises_then_falls() {
    let drinks = vec![beer(-3600.0)]; // 1 hour ago
    let profile = male_80kg();
    let curve = generate_curve(&drinks, &profile, BACFormula::Widmark, -3600.0, 3600.0, 60.0, 0.06, 0.09);

    // First point should be ~0 (drink just logged)
    assert!(curve.first().unwrap().bac < 0.01);
    // Middle point should have some BAC
    let mid = &curve[curve.len() / 2];
    assert!(mid.bac > 0.0);
}

#[test]
fn generate_curve_empty_drinks() {
    let curve = generate_curve(&[], &male_80kg(), BACFormula::Widmark, 0.0, 3600.0, 60.0, 0.06, 0.09);
    assert!(curve.iter().all(|p| p.bac == 0.0));
    assert!(curve.iter().all(|p| p.zone == BACZone::Sober));
}

#[test]
fn generate_curve_zones_classified() {
    // High BAC scenario
    let drinks = vec![
        beer(-1800.0),
        beer(-1800.0),
        beer(-1800.0),
    ];
    let curve = generate_curve(&drinks, &male_80kg(), BACFormula::Widmark, 0.0, 0.0, 60.0, 0.06, 0.09);
    assert_ne!(curve[0].zone, BACZone::Sober);
}
```

## Affected files
- `src/bac.rs` — add `CurvePoint`, `generate_curve`, make `calculate_bac_at_offset` pub, add UniFFI export
- `src/wasm.rs` — add `generateCurve` WASM binding
