# buzz-core WASM Package

This is the WebAssembly build of buzz-core, a Blood Alcohol Content (BAC) calculator library.

## Building for WASM

### Prerequisites

Install wasm-pack:
```bash
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

### Build Commands

**For npm/web:**
```bash
wasm-pack build --target web --features wasm --out-dir pkg
```

**For Node.js:**
```bash
wasm-pack build --target nodejs --features wasm --out-dir pkg-node
```

**For bundlers (webpack, rollup, etc.):**
```bash
wasm-pack build --target bundler --features wasm --out-dir pkg-bundler
```

## Usage in JavaScript/TypeScript

### Installation

After building, you can publish to npm or use locally:
```bash
npm link ./pkg
```

### Basic Example

```javascript
import * as buzzCore from 'buzz-core';

// Create a user profile
const profile = buzzCore.createUserProfile(
    80.0,        // weight in kg
    "male",      // biological sex
    180.0,       // height in cm
    30           // age
);

// Create a drink (beer consumed 30 minutes ago)
const drink = buzzCore.createDrink(
    330.0,       // volume in ml
    0.05,        // ABV (5%)
    -1800.0,     // offset in seconds (negative = past)
    "empty"      // stomach state
);

// Calculate BAC
const bac = buzzCore.calculateBAC([drink], profile, "widmark");
console.log(`Current BAC: ${bac.toFixed(3)}`);

// Get complete snapshot
const snapshot = buzzCore.calculateSnapshot(
    [drink],
    profile,
    "widmark",
    0.06,  // sweet spot min
    0.09   // sweet spot max
);

console.log('Snapshot:', snapshot);
// {
//   bac: 0.023,
//   trajectory: "rising",
//   zone: "below_sweet_spot",
//   time_to_sober_secs: 5520.0
// }
```

### TypeScript Example

```typescript
import * as buzzCore from 'buzz-core';

interface UserProfile {
    weight_kg: number;
    biological_sex: "male" | "female" | "other";
    height_cm: number;
    age: number;
}

interface Drink {
    volume_ml: number;
    abv: number;
    offset_secs: number;
    stomach_state: "empty" | "some_food" | "full";
}

const profile: UserProfile = {
    weight_kg: 70,
    biological_sex: "female",
    height_cm: 165,
    age: 28
};

const drinks: Drink[] = [
    {
        volume_ml: 150,
        abv: 0.12,
        offset_secs: -3600,
        stomach_state: "some_food"
    }
];

const bac = buzzCore.calculateBAC(drinks, profile, "watson");
```

## API Reference

### Functions

#### `calculateBAC(drinks, profile, formula)`
Calculate current BAC.
- **drinks**: Array of drink objects
- **profile**: User profile object
- **formula**: `"widmark"` or `"watson"`
- **Returns**: BAC as number (e.g., 0.08)

#### `calculateSnapshot(drinks, profile, formula, sweetSpotMin, sweetSpotMax)`
Get complete BAC snapshot with trajectory and zone.
- **Returns**: Object with `bac`, `trajectory`, `zone`, `time_to_sober_secs`

#### `calculateTrajectory(drinks, profile, formula)`
Get BAC trajectory direction.
- **Returns**: `"rising"`, `"falling"`, or `"stable"`

#### `estimateTimeToSober(currentBac)`
Estimate seconds until sober.
- **Returns**: Number of seconds, or `null` if already sober

#### `classifyZone(bac, sweetSpotMin, sweetSpotMax)`
Classify BAC into a zone.
- **Returns**: `"sober"`, `"below_sweet_spot"`, `"sweet_spot"`, `"caution"`, or `"danger"`

#### `countAbsorbingDrinks(drinks)`
Count drinks still being absorbed.
- **Returns**: Number of drinks

### Helper Functions

#### `createDrink(volumeMl, abv, offsetSecs, stomachState)`
Create a drink object.

#### `createUserProfile(weightKg, biologicalSex, heightCm, age)`
Create a user profile object.

## Building for Mobile

For iOS/Android builds using UniFFI:
```bash
cargo build --features mobile
```

## License

See LICENSE file in the repository.
