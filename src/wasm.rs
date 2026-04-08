use wasm_bindgen::prelude::*;
use crate::bac::{Drink, UserProfile};
use crate::types::{BACFormula, BiologicalSex, StomachState};

/// Calculate BAC from a set of drinks.
///
/// # Parameters
/// - `drinks`: JSON array of drink objects
/// - `profile`: JSON object with user profile
/// - `formula`: "widmark" or "watson"
///
/// # Returns
/// BAC as a number (e.g., 0.08 for 0.08%)
#[wasm_bindgen(js_name = calculateBAC)]
pub fn calculate_bac(
    drinks: JsValue,
    profile: JsValue,
    formula: JsValue,
) -> Result<f64, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {}", e)))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {}", e)))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {}", e)))?;

    Ok(crate::bac::calculate_bac(&drinks, &profile, formula))
}

/// Calculate BAC trajectory (rising, falling, or stable) with angle.
///
/// # Parameters
/// - `drinks`: JSON array of drink objects
/// - `profile`: JSON object with user profile
/// - `formula`: "widmark" or "watson"
///
/// # Returns
/// Object with `direction` ("rising", "falling", or "stable") and
/// `angle_degrees` (-90..90, where -45 ≈ steady decline, 0 = stable).
#[wasm_bindgen(js_name = calculateTrajectory)]
pub fn calculate_trajectory(
    drinks: JsValue,
    profile: JsValue,
    formula: JsValue,
) -> Result<JsValue, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {}", e)))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {}", e)))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {}", e)))?;

    let (direction, angle_degrees) = crate::bac::trajectory(&drinks, &profile, formula);

    #[derive(serde::Serialize)]
    struct TrajectoryResult {
        direction: crate::types::Trajectory,
        angle_degrees: f64,
    }

    let result = TrajectoryResult { direction, angle_degrees };
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Calculate complete BAC snapshot.
///
/// # Parameters
/// - `drinks`: JSON array of drink objects
/// - `profile`: JSON object with user profile
/// - `formula`: "widmark" or "watson"
/// - `sweetSpotMin`: Minimum BAC for sweet spot (e.g., 0.06)
/// - `sweetSpotMax`: Maximum BAC for sweet spot (e.g., 0.09)
///
/// # Returns
/// Snapshot object with bac, trajectory, zone, and time_to_sober_secs
#[wasm_bindgen(js_name = calculateSnapshot)]
pub fn calculate_snapshot(
    drinks: JsValue,
    profile: JsValue,
    formula: JsValue,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> Result<JsValue, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {}", e)))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {}", e)))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {}", e)))?;

    let snapshot = crate::bac::snapshot(&drinks, &profile, formula, sweet_spot_min, sweet_spot_max);
    serde_wasm_bindgen::to_value(&snapshot)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Estimate time to sober (in seconds).
///
/// # Parameters
/// - `currentBac`: Current BAC level (e.g., 0.08)
///
/// # Returns
/// Seconds until sober, or null if already sober
#[wasm_bindgen(js_name = estimateTimeToSober)]
pub fn estimate_time_to_sober(current_bac: f64) -> Option<f64> {
    crate::bac::estimate_time_to_sober(current_bac)
}

/// Count drinks still being absorbed.
///
/// # Parameters
/// - `drinks`: JSON array of drink objects
///
/// # Returns
/// Number of drinks still absorbing
#[wasm_bindgen(js_name = countAbsorbingDrinks)]
pub fn count_absorbing_drinks(drinks: JsValue) -> Result<u32, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {}", e)))?;

    Ok(crate::bac::absorbing_drink_count(&drinks) as u32)
}

/// Classify a BAC value into a zone.
///
/// # Parameters
/// - `bac`: BAC level (e.g., 0.08)
/// - `sweetSpotMin`: Minimum BAC for sweet spot
/// - `sweetSpotMax`: Maximum BAC for sweet spot
///
/// # Returns
/// Zone: "sober", "below_sweet_spot", "sweet_spot", "caution", or "danger"
#[wasm_bindgen(js_name = classifyZone)]
pub fn classify_zone(
    bac: f64,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> Result<JsValue, JsValue> {
    let zone = crate::zone::classify_zone(bac, sweet_spot_min, sweet_spot_max);
    serde_wasm_bindgen::to_value(&zone)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

// Type exports for TypeScript definitions

/// Create a Drink object.
///
/// # Parameters
/// - `volumeMl`: Volume in milliliters
/// - `abv`: Alcohol by volume (0.05 for 5%)
/// - `offsetSecs`: Seconds since now (negative for past drinks)
/// - `stomachState`: "empty", "some_food", or "full"
#[wasm_bindgen(js_name = createDrink)]
pub fn create_drink(
    volume_ml: f64,
    abv: f64,
    offset_secs: f64,
    stomach_state: JsValue,
) -> Result<JsValue, JsValue> {
    let stomach_state: StomachState = serde_wasm_bindgen::from_value(stomach_state)
        .map_err(|e| JsValue::from_str(&format!("Invalid stomach state: {}", e)))?;

    let drink = Drink {
        volume_ml,
        abv,
        offset_secs,
        stomach_state,
    };

    serde_wasm_bindgen::to_value(&drink)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Create a UserProfile object.
///
/// # Parameters
/// - `weightKg`: Weight in kilograms
/// - `biologicalSex`: "male", "female", or "other"
/// - `heightCm`: Height in centimeters
/// - `age`: Age in years
#[wasm_bindgen(js_name = createUserProfile)]
pub fn create_user_profile(
    weight_kg: f64,
    biological_sex: JsValue,
    height_cm: f64,
    age: u32,
) -> Result<JsValue, JsValue> {
    let biological_sex: BiologicalSex = serde_wasm_bindgen::from_value(biological_sex)
        .map_err(|e| JsValue::from_str(&format!("Invalid biological sex: {}", e)))?;

    let profile = UserProfile {
        weight_kg,
        biological_sex,
        height_cm,
        age,
    };

    serde_wasm_bindgen::to_value(&profile)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Generate a BAC curve over a time range.
///
/// # Parameters
/// - `drinks`: JSON array of drink objects
/// - `profile`: JSON object with user profile
/// - `formula`: "widmark" or "watson"
/// - `fromOffsetSecs`: Start of the curve (seconds offset from t=0)
/// - `toOffsetSecs`: End of the curve (seconds offset from t=0)
/// - `stepSecs`: Step size in seconds
/// - `sweetSpotMin`: Minimum BAC for sweet spot
/// - `sweetSpotMax`: Maximum BAC for sweet spot
///
/// # Returns
/// Array of CurvePoint objects with offset_secs, bac, and zone
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
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {}", e)))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {}", e)))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {}", e)))?;

    let points = crate::bac::generate_curve(
        &drinks,
        &profile,
        formula,
        from_offset_secs,
        to_offset_secs,
        step_secs,
        sweet_spot_min,
        sweet_spot_max,
    );

    serde_wasm_bindgen::to_value(&points)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Estimate minutes until BAC reaches zero, accounting for ongoing absorption.
///
/// # Parameters
/// - `drinks`: JSON array of drink objects
/// - `profile`: JSON object with user profile
/// - `formula`: "widmark" or "watson"
///
/// # Returns
/// Minutes until sober (0.0 if already sober)
#[wasm_bindgen(js_name = minutesUntilSober)]
pub fn minutes_until_sober(
    drinks: JsValue,
    profile: JsValue,
    formula: JsValue,
) -> Result<f64, JsValue> {
    let drinks: Vec<Drink> = serde_wasm_bindgen::from_value(drinks)
        .map_err(|e| JsValue::from_str(&format!("Invalid drinks: {}", e)))?;
    let profile: UserProfile = serde_wasm_bindgen::from_value(profile)
        .map_err(|e| JsValue::from_str(&format!("Invalid profile: {}", e)))?;
    let formula: BACFormula = serde_wasm_bindgen::from_value(formula)
        .map_err(|e| JsValue::from_str(&format!("Invalid formula: {}", e)))?;

    Ok(crate::bac::minutes_until_sober(&drinks, &profile, formula))
}
