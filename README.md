# ethanol-rs

Cross-platform Rust library for ethanol pharmacokinetics modeling. Implements peer-reviewed BAC estimation models (Widmark, Watson) with first-order absorption kinetics and zero-order elimination. Compiles to native (iOS/Android via UniFFI) and WebAssembly.

**Powers the [Keel](https://keelapp.dev) harm reduction app for iOS.**

---

## Features

- **Widmark Formula** — Weight-based BAC estimation with sex-specific distribution constants
- **Watson Formula** — Total body water method for improved accuracy across demographics
- **First-Order Absorption Kinetics** — Realistic ethanol uptake modeling with gastric emptying effects
- **Zero-Order Metabolism** — Constant elimination rate (0.015% BAC/hour)
- **Session Detection** — Automatic segmentation of temporally-separated drinking episodes
- **Trajectory Analysis** — Rising, falling, or stable BAC trend detection
- **Time-to-Sober Estimation** — Accounts for ongoing absorption (not just current BAC)
- **Batch Curve Generation** — Compute BAC over time ranges with single FFI boundary crossing
- **Cross-Platform** — Native (iOS/Android via UniFFI), WebAssembly, and pure Rust
- **Zero Dependencies** — Core library has no required dependencies (optional: UniFFI, wasm-bindgen, serde)

---

## Quick Start

```toml
[dependencies]
ethanol-rs = "0.1"
```

### Basic Example

```rust
use ethanol_rs::*;

fn main() {
    let profile = UserProfile {
        weight_kg: 70.0,
        biological_sex: BiologicalSex::Female,
        height_cm: 165.0,
        age: 28,
    };

    let drinks = vec![
        Drink {
            volume_ml: 150.0,      // Standard wine glass
            abv: 0.12,             // 12% alcohol
            offset_secs: -1800.0,  // 30 minutes ago
            stomach_state: StomachState::SomeFood,
        },
    ];

    // Calculate current BAC
    let bac = calculate_bac(&drinks, &profile, BACFormula::Watson);
    println!("Current BAC: {:.3}%", bac);

    // Estimate time to reach zero
    let minutes = minutes_until_sober(&drinks, &profile, BACFormula::Watson);
    println!("Minutes until sober: {:.0}", minutes);

    // Check trajectory
    let trend = trajectory(&drinks, &profile, BACFormula::Watson);
    println!("BAC is {:?}", trend); // Rising, Falling, or Stable
}
```

---

## Pharmacokinetic Models

### Widmark Formula

Classic weight-based estimation:

```
BAC = (A / (r × W)) - (β × t)
```

Where:
- `A` = grams of pure ethanol consumed
- `r` = Widmark distribution constant (L/kg)
  - Male: 0.68
  - Female: 0.55
  - Other: 0.615 (average)
- `W` = body weight (kg)
- `β` = elimination rate (0.015% BAC/hour)
- `t` = time since consumption (hours)

**Source:** Widmark, E.M.P. (1932). *Die theoretischen Grundlagen und die praktische Verwendbarkeit der gerichtlich-medizinischen Alkoholbestimmung.*

### Watson Formula

Total body water (TBW) method for improved accuracy:

```
BAC = (A / (TBW × 0.8)) - (β × t)
```

**TBW calculation (liters):**

*Males:*
```
TBW = 2.447 - (0.09516 × age) + (0.1074 × height_cm) + (0.3362 × weight_kg)
```

*Females:*
```
TBW = -2.097 + (0.1069 × height_cm) + (0.2466 × weight_kg)
```

**Source:** Watson, P.E., Watson, I.D., & Batt, R.D. (1980). Total body water volumes for adult males and females estimated from simple anthropometric measurements. *American Journal of Clinical Nutrition, 33*(1), 27-39.

### Absorption Model

First-order kinetics with gastric emptying effects:

```
F(t) = 1 - e^(-ka × t)
```

Where:
- `F(t)` = fraction absorbed at time `t`
- `ka` = absorption rate constant (h⁻¹)

**Absorption rate constants:**
- Empty stomach: ka = 4.0 h⁻¹
- Some food: ka = 2.5 h⁻¹
- Full meal: ka = 1.5 h⁻¹

Food delays gastric emptying and reduces peak BAC by 40-50%.

### Metabolism

Zero-order elimination (constant rate regardless of concentration):

```
dBAC/dt = -β = -0.015% per hour
```

Population average: 0.015% BAC/hour (range: 0.010-0.020% individual variation).

### Session Detection

Automatically detects drinking session boundaries. When BAC from prior drinks has fully metabolized (≤ 0.001%), the elimination clock resets. This prevents unrealistic metabolism accumulation across temporally-separated episodes (e.g., drinks 8 hours apart).

---

## Accuracy & Limitations

### Expected Accuracy

- **Inter-individual variation**: ±20-30% due to genetics, liver health, enzyme activity
- **Gastric emptying**: Food composition affects absorption beyond the simplified three-state model
- **Metabolism range**: 0.010-0.020% BAC/hour (this library uses population average 0.015%)
- **Watson formula**: More accurate than Widmark for diverse body compositions (validated R² > 0.90)

### Known Limitations

1. **Population averages** — Individual metabolism varies significantly
2. **Simplified food model** — Real gastric emptying depends on meal macronutrient composition
3. **No congener effects** — Different alcohols (beer vs. whiskey) may have different absorption profiles
4. **No tolerance modeling** — Chronic users may exhibit altered pharmacokinetics
5. **Healthy adults only** — Not validated for liver disease, pregnancy, or pediatric cases

### Scientific Validation

The core models (Widmark, Watson) are peer-reviewed and widely used in:
- Forensic toxicology
- Clinical pharmacology
- Alcohol research

**This is an estimation tool.** Results should not be used for safety-critical decisions (driving, medical diagnosis, legal defense) without laboratory confirmation.

---

## Platform Support

### Native (iOS/Android)

Uses [UniFFI](https://mozilla.github.io/uniffi-rs/) for language bindings.

**Build:**
```bash
cargo build --features mobile
```

**Generate Swift bindings:**
```bash
cargo run --bin uniffi-bindgen generate \
  --library target/debug/libethanol_rs.dylib \
  --language swift \
  --out-dir bindings/swift
```

**Generate Kotlin bindings:**
```bash
cargo run --bin uniffi-bindgen generate \
  --library target/debug/libethanol_rs.so \
  --language kotlin \
  --out-dir bindings/kotlin
```

### WebAssembly

See [README-WASM.md](README-WASM.md) for detailed usage.

**Quick build:**
```bash
wasm-pack build --target web --features wasm
```

**Live demo:** [demo.ethanol-rs.dev](https://demo.ethanol-rs.dev) (or open `example.html` locally)

---

## API Reference

### Core Functions

```rust
/// Calculate BAC at reference time (t=0)
pub fn calculate_bac(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> f64

/// Calculate BAC at arbitrary time offset
pub fn calculate_bac_at_offset(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    time_offset_secs: f64,
) -> f64

/// Determine if BAC is rising, falling, or stable
pub fn trajectory(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> Trajectory

/// Estimate minutes until BAC ≤ 0.001% (accounts for ongoing absorption)
pub fn minutes_until_sober(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> f64

/// Generate BAC curve over time range
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

/// Count drinks still actively absorbing (< 95% absorbed)
pub fn absorbing_drink_count(drinks: &[Drink]) -> usize
```

### Types

```rust
pub struct UserProfile {
    pub weight_kg: f64,
    pub biological_sex: BiologicalSex,  // Male, Female, Other
    pub height_cm: f64,
    pub age: u32,
}

pub struct Drink {
    pub volume_ml: f64,
    pub abv: f64,              // Fraction (0.05 = 5%)
    pub offset_secs: f64,      // Negative for past drinks
    pub stomach_state: StomachState,  // Empty, SomeFood, Full
}

pub enum BACFormula {
    Widmark,
    Watson,
}

pub enum Trajectory {
    Rising,    // BAC increasing
    Falling,   // BAC decreasing
    Stable,    // No significant change
}
```

### Optional Zone Classification

For application-specific BAC categorization:

```rust
pub fn classify_zone(
    bac: f64,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> BACZone

pub enum BACZone {
    Sober,           // BAC ≤ 0.001%
    BelowSweetSpot,  // BAC < min
    SweetSpot,       // min ≤ BAC ≤ max
    Caution,         // max < BAC ≤ max+0.01
    Danger,          // BAC > max+0.01
}
```

*Note: "Sweet spot" is an application-level concept, not a pharmacological term. Threshold values should be determined by the integrating application based on local laws and harm reduction goals.*

---

## Use Cases

### Harm Reduction Organizations

Provide evidence-based BAC estimation tools for:
- Educational materials on alcohol absorption/metabolism
- Interactive web calculators
- Mobile harm reduction apps

### Researchers & Academics

- Scrutinizable, open-source implementation of standard models
- Teaching tool for pharmacokinetics courses
- Baseline for comparing novel BAC estimation methods

### App Developers

- Drop-in BAC calculation without reimplementing complex math
- Cross-platform (share logic between iOS, Android, Web)
- Battle-tested absorption and metabolism models

---

## Building & Testing

```bash
# Run tests
cargo test

# Build for native
cargo build --release

# Build for WASM
wasm-pack build --target web --features wasm

# Build for mobile
cargo build --features mobile --release
```

---

## Contributing

We welcome contributions that improve scientific accuracy:

1. **Report Inaccuracies** — Open an issue with references to peer-reviewed sources
2. **Propose Enhancements** — Suggest improvements with pharmacological justification
3. **Submit Pull Requests** — Include tests and update documentation
4. **Improve Documentation** — Clarify assumptions, add references, explain limitations

Before contributing, please read our [Code of Conduct](CODE_OF_CONDUCT.md) (coming soon).

---

## License

Dual-licensed under your choice of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT License ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

This maximizes adoptability for commercial and non-commercial use.

---

## Disclaimer

**FOR EDUCATIONAL AND RESEARCH PURPOSES ONLY.**

This library provides *estimates* based on population-average pharmacokinetic models. Individual responses to alcohol vary significantly due to:

- Genetic polymorphisms in alcohol dehydrogenase (ADH) and aldehyde dehydrogenase (ALDH)
- Liver health and enzyme activity
- Chronic tolerance
- Medication interactions
- Hydration status and electrolyte balance

**DO NOT USE** to determine fitness to drive, operate machinery, or make safety-critical decisions. BAC estimates are not a substitute for:
- Breathalyzer or blood testing
- Clinical judgment
- Following local laws regarding alcohol consumption
- Exercising caution and common sense

**When in doubt, don't drive.** Arrange alternative transportation.

---

## Citation

If you use this library in academic research, please cite:

```
ethanol-rs: Cross-platform ethanol pharmacokinetics library
https://github.com/smaragden/ethanol-rs
Version 0.1.0 (2026)
```

And cite the underlying models:

- Widmark, E.M.P. (1932). Die theoretischen Grundlagen und die praktische Verwendbarkeit der gerichtlich-medizinischen Alkoholbestimmung.
- Watson, P.E., Watson, I.D., & Batt, R.D. (1980). Total body water volumes for adult males and females estimated from simple anthropometric measurements. *Am J Clin Nutr, 33*(1), 27-39.

---

## Acknowledgments

Built with [UniFFI](https://mozilla.github.io/uniffi-rs/) for cross-platform bindings and [wasm-bindgen](https://rustwasm.github.io/wasm-bindgen/) for WebAssembly support.
