# buzz-core

A high-performance Blood Alcohol Content (BAC) calculator library written in Rust, available for both mobile (iOS/Android) and web platforms.

## Features

- **Accurate BAC Calculation**: Implements both Widmark and Watson formulas
- **First-Order Absorption Kinetics**: Models realistic alcohol absorption based on stomach state
- **Zero-Order Metabolism**: Constant elimination rate modeling
- **Trajectory Tracking**: Detects rising, falling, or stable BAC trends
- **Zone Classification**: Categorizes BAC into sober, sweet spot, caution, and danger zones
- **Cross-Platform**: Works on iOS, Android, and Web (WASM)

## Platform Support

### 🌐 Web (WebAssembly)

For web usage, see [README-WASM.md](./README-WASM.md)

Quick start:
```bash
./build-wasm.sh web
```

### 📱 Mobile (iOS/Android)

Uses [UniFFI](https://mozilla.github.io/uniffi-rs/) for mobile bindings.

Build for mobile:
```bash
cargo build --features mobile
```

Generate Swift bindings:
```bash
cargo run --bin uniffi-bindgen generate src/buzz_core.udl --language swift
```

## Development

### Building

**For web:**
```bash
cargo build --features wasm
```

**For mobile:**
```bash
cargo build --features mobile
```

**Without features (library only):**
```bash
cargo build
```

### Testing

```bash
cargo test
```

## How It Works

### BAC Calculation

The library uses pharmacokinetic models to estimate BAC:

1. **Widmark Formula**: Simple weight-based calculation
   - BAC = (alcohol grams / (body weight × gender constant)) × 100

2. **Watson Formula**: More accurate, uses total body water
   - Accounts for height, weight, age, and biological sex

### Absorption Model

- **Empty stomach**: Fast absorption (ka = 4.0 h⁻¹)
- **Some food**: Moderate absorption (ka = 2.5 h⁻¹)
- **Full stomach**: Slow absorption (ka = 1.5 h⁻¹)

### Metabolism

- Constant elimination rate: 0.015% BAC per hour
- Begins from the time of first drink

## API Overview

### Core Functions

- `calculate_bac()`: Get current BAC level
- `trajectory()`: Determine if BAC is rising, falling, or stable
- `snapshot()`: Get complete BAC analysis with zone and time to sober
- `estimate_time_to_sober()`: Predict when BAC will reach zero
- `classify_zone()`: Categorize BAC level

### Data Types

- `Drink`: Volume, ABV, timing, and stomach state
- `UserProfile`: Weight, height, age, biological sex
- `BACSnapshot`: Complete analysis result
- `BACFormula`: Widmark or Watson
- `Trajectory`: Rising, Falling, or Stable
- `BACZone`: Sober, BelowSweetSpot, SweetSpot, Caution, or Danger

## License

Licensed under either of:

- Apache License, Version 2.0
- MIT License

at your option.

## Disclaimer

This library is for educational and informational purposes only. BAC calculations are estimates and should not be used to determine fitness to drive or operate machinery. Always follow local laws and regulations regarding alcohol consumption.
