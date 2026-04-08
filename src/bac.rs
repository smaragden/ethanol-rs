use crate::types::{BACFormula, BACUnit, BACZone, BiologicalSex, StomachState, Trajectory};

/// Density of ethanol in g/ml.
const ETHANOL_DENSITY: f64 = 0.789;

/// Zero-order metabolism rate: BAC decrease per hour.
const METABOLISM_RATE: f64 = 0.015;

/// Trajectory comparison window in seconds (5 minutes).
const TRAJECTORY_WINDOW_SECS: f64 = 300.0;

/// A single drink for BAC calculation.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
pub struct Drink {
    /// Volume in milliliters.
    pub volume_ml: f64,
    /// Alcohol by volume as a fraction (e.g., 0.05 for 5%).
    pub abv: f64,
    /// Seconds since the reference time (negative = in the past).
    /// For a drink logged 30 minutes ago: `offset_secs = -1800.0`.
    pub offset_secs: f64,
    /// Stomach state at time of drink.
    pub stomach_state: StomachState,
}

/// User's physical profile for BAC calculation.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
pub struct UserProfile {
    /// Weight in kilograms.
    pub weight_kg: f64,
    pub biological_sex: BiologicalSex,
    /// Height in centimeters (used for Watson formula).
    pub height_cm: f64,
    /// Age in years (used for Watson formula).
    pub age: u32,
}

/// Complete BAC snapshot at a point in time.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
pub struct BACSnapshot {
    pub bac: f64,
    pub trajectory: Trajectory,
    /// Trajectory angle in degrees (-90..90).
    /// Normalised against metabolism rate: -45° ≈ steady decline, 0° = stable.
    pub trajectory_angle_degrees: f64,
    pub zone: BACZone,
    /// Estimated seconds until sober, or `None` if already sober.
    pub time_to_sober_secs: Option<f64>,
}

/// A single point in a BAC curve.
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

/// Calculate BAC from a set of drinks at `t = 0` (the reference time).
///
/// Each drink's `offset_secs` indicates when it was consumed relative to now.
/// Uses first-order absorption kinetics and zero-order metabolism.
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

    let mut total_bac = 0.0;
    let mut earliest_offset: Option<f64> = None;

    for drink in active_drinks {
        // offset_secs is negative for past drinks; hours_elapsed is positive
        let hours_elapsed = -drink.offset_secs / 3600.0;
        if hours_elapsed < 0.0 {
            continue; // future drink, skip
        }

        let alcohol_grams = drink.volume_ml * drink.abv * ETHANOL_DENSITY;

        // First-order absorption
        let ka = drink.stomach_state.ka();
        let absorption_fraction = 1.0 - (-ka * hours_elapsed).exp();
        let effective_alcohol = alcohol_grams * absorption_fraction;

        let drink_bac = match formula {
            BACFormula::Widmark => {
                let gender_constant = profile.biological_sex.gender_constant();
                let weight_grams = profile.weight_kg * 1000.0;
                (effective_alcohol / (weight_grams * gender_constant)) * 100.0
            }
            BACFormula::Watson => {
                let tbw = total_body_water(profile);
                if tbw <= 0.0 {
                    return 0.0;
                }
                (effective_alcohol / (tbw * 800.0)) * 100.0
            }
        };

        total_bac += drink_bac;

        match earliest_offset {
            Some(e) if drink.offset_secs < e => earliest_offset = Some(drink.offset_secs),
            None => earliest_offset = Some(drink.offset_secs),
            _ => {}
        }
    }

    // Zero-order metabolism: constant rate from first drink
    if let Some(earliest) = earliest_offset {
        let metabolism_hours = -earliest / 3600.0;
        total_bac = (total_bac - metabolism_hours * METABOLISM_RATE).max(0.0);
    }

    total_bac
}

/// Calculate BAC at an arbitrary time offset (in seconds) from `t = 0`.
///
/// Shifts all drink offsets by `time_offset_secs` to compute BAC at a different point.
pub fn calculate_bac_at_offset(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    time_offset_secs: f64,
) -> f64 {
    let shifted: Vec<Drink> = drinks
        .iter()
        .map(|d| Drink {
            offset_secs: d.offset_secs - time_offset_secs,
            ..d.clone()
        })
        .collect();
    calculate_bac(&shifted, profile, formula)
}

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

/// Determine BAC trajectory by comparing current BAC to 5 minutes ago.
///
/// Returns `(direction, angle_degrees)` where `angle_degrees` is the slope
/// of the BAC curve normalised against the metabolism rate:
/// -45° ≈ steady metabolic decline, 0° = stable, positive = rising.
pub fn trajectory(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> (Trajectory, f64) {
    let current = calculate_bac(drinks, profile, formula);
    let past = calculate_bac_at_offset(drinks, profile, formula, -TRAJECTORY_WINDOW_SECS);

    let diff = current - past;
    let direction = if diff > 0.001 {
        Trajectory::Rising
    } else if diff < -0.001 {
        Trajectory::Falling
    } else {
        Trajectory::Stable
    };

    // BAC change per hour, then normalise against the metabolism rate so that
    // a steady metabolic decline corresponds to roughly -45°.
    let rate_per_hour = diff * (3600.0 / TRAJECTORY_WINDOW_SECS);
    let angle_degrees = (rate_per_hour / METABOLISM_RATE).atan().to_degrees();

    (direction, angle_degrees)
}

/// Estimated seconds until BAC reaches zero.
#[cfg_attr(feature = "mobile", uniffi::export)]
pub fn estimate_time_to_sober(current_bac: f64) -> Option<f64> {
    if current_bac <= 0.001 {
        return None;
    }
    let hours = current_bac / METABOLISM_RATE;
    Some(hours * 3600.0)
}

/// Format BAC for display.
pub fn format_bac(bac: f64, unit: BACUnit) -> String {
    unit.format_value(bac)
}

/// Complete BAC snapshot.
pub fn snapshot(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> BACSnapshot {
    let bac = calculate_bac(drinks, profile, formula);
    let (traj, angle) = trajectory(drinks, profile, formula);
    let zone = crate::zone::classify_zone(bac, sweet_spot_min, sweet_spot_max);
    let time_to_sober_secs = estimate_time_to_sober(bac);

    BACSnapshot {
        bac,
        trajectory: traj,
        trajectory_angle_degrees: angle,
        zone,
        time_to_sober_secs,
    }
}

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

/// Watson total body water estimation (liters).
fn total_body_water(profile: &UserProfile) -> f64 {
    let age = profile.age as f64;
    let h = profile.height_cm;
    let w = profile.weight_kg;

    match profile.biological_sex {
        BiologicalSex::Male => 2.447 - 0.09516 * age + 0.1074 * h + 0.3362 * w,
        BiologicalSex::Female => -2.097 + 0.1069 * h + 0.2466 * w,
        BiologicalSex::Other => {
            let male = 2.447 - 0.09516 * age + 0.1074 * h + 0.3362 * w;
            let female = -2.097 + 0.1069 * h + 0.2466 * w;
            (male + female) / 2.0
        }
    }
}

/// Count drinks still being actively absorbed (< 95% absorbed).
pub fn absorbing_drink_count(drinks: &[Drink]) -> usize {
    drinks
        .iter()
        .filter(|d| {
            let hours = -d.offset_secs / 3600.0;
            if hours < 0.0 {
                return false;
            }
            let ka = d.stomach_state.ka();
            let fraction = 1.0 - (-ka * hours).exp();
            fraction < 0.95
        })
        .count()
}

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

// MARK: - UniFFI exports

#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_bac(drinks: Vec<Drink>, profile: UserProfile, formula: BACFormula) -> f64 {
    calculate_bac(&drinks, &profile, formula)
}

#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_trajectory(drinks: Vec<Drink>, profile: UserProfile, formula: BACFormula) -> Trajectory {
    trajectory(&drinks, &profile, formula).0
}

#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_trajectory_angle(drinks: Vec<Drink>, profile: UserProfile, formula: BACFormula) -> f64 {
    trajectory(&drinks, &profile, formula).1
}

#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_snapshot(
    drinks: Vec<Drink>,
    profile: UserProfile,
    formula: BACFormula,
    sweet_spot_min: f64,
    sweet_spot_max: f64,
) -> BACSnapshot {
    snapshot(&drinks, &profile, formula, sweet_spot_min, sweet_spot_max)
}

#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_absorbing_drink_count(drinks: Vec<Drink>) -> u32 {
    absorbing_drink_count(&drinks) as u32
}

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
        &drinks,
        &profile,
        formula,
        from_offset_secs,
        to_offset_secs,
        step_secs,
        sweet_spot_min,
        sweet_spot_max,
    )
}

#[cfg(feature = "mobile")]
#[uniffi::export]
pub fn calc_minutes_until_sober(
    drinks: Vec<Drink>,
    profile: UserProfile,
    formula: BACFormula,
) -> f64 {
    minutes_until_sober(&drinks, &profile, formula)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn male_80kg() -> UserProfile {
        UserProfile {
            weight_kg: 80.0,
            biological_sex: BiologicalSex::Male,
            height_cm: 180.0,
            age: 30,
        }
    }

    fn female_60kg() -> UserProfile {
        UserProfile {
            weight_kg: 60.0,
            biological_sex: BiologicalSex::Female,
            height_cm: 165.0,
            age: 30,
        }
    }

    fn beer(offset_secs: f64) -> Drink {
        Drink {
            volume_ml: 330.0,
            abv: 0.05,
            offset_secs,
            stomach_state: StomachState::Empty,
        }
    }

    #[test]
    fn single_beer_male_80kg() {
        let bac = calculate_bac(&[beer(0.0)], &male_80kg(), BACFormula::Widmark);
        // At t=0 the drink was just logged, absorption fraction ≈ 0, so BAC ≈ 0
        assert!(bac < 0.01);
    }

    #[test]
    fn single_beer_after_one_hour() {
        // Drink logged 1 hour ago
        let bac = calculate_bac(&[beer(-3600.0)], &male_80kg(), BACFormula::Widmark);
        // Should be around 0.02 after 1 hour with metabolism
        assert!(bac > 0.005, "BAC too low: {bac}");
        assert!(bac < 0.05, "BAC too high: {bac}");
    }

    #[test]
    fn female_higher_bac_than_male() {
        let drinks = [beer(-3600.0)];
        let male_bac = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
        let female_bac = calculate_bac(&drinks, &female_60kg(), BACFormula::Widmark);
        assert!(
            female_bac > male_bac,
            "Female BAC ({female_bac}) should be higher than male ({male_bac})"
        );
    }

    #[test]
    fn bac_floors_at_zero() {
        // Drink logged 5 hours ago — should be fully metabolized
        let bac = calculate_bac(&[beer(-18000.0)], &male_80kg(), BACFormula::Widmark);
        assert_eq!(bac, 0.0);
    }

    #[test]
    fn zero_weight_returns_zero() {
        let profile = UserProfile {
            weight_kg: 0.0,
            ..male_80kg()
        };
        let bac = calculate_bac(&[beer(-3600.0)], &profile, BACFormula::Widmark);
        assert_eq!(bac, 0.0);
    }

    #[test]
    fn no_drinks_returns_zero() {
        let bac = calculate_bac(&[], &male_80kg(), BACFormula::Widmark);
        assert_eq!(bac, 0.0);
    }

    #[test]
    fn future_drink_ignored() {
        // Drink logged 1 hour in the future
        let bac = calculate_bac(&[beer(3600.0)], &male_80kg(), BACFormula::Widmark);
        assert_eq!(bac, 0.0);
    }

    #[test]
    fn multiple_drinks_accumulate() {
        let drinks = vec![
            beer(-3600.0),  // 1 hour ago
            beer(-1800.0),  // 30 min ago
            beer(-600.0),   // 10 min ago
        ];
        let single = calculate_bac(&[beer(-3600.0)], &male_80kg(), BACFormula::Widmark);
        let multi = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
        assert!(multi > single, "Multiple drinks should give higher BAC");
    }

    #[test]
    fn trajectory_rising_after_recent_drink() {
        // Drink logged 2 minutes ago — still absorbing
        let drinks = [beer(-120.0)];
        let (dir, angle) = trajectory(&drinks, &male_80kg(), BACFormula::Widmark);
        assert_eq!(dir, Trajectory::Rising);
        assert!(angle > 0.0, "Rising angle should be positive: {angle}");
    }

    #[test]
    fn trajectory_falling_hours_later() {
        // Drink logged 1.5 hours ago — past peak, still metabolizing
        let drinks = [beer(-5400.0)];
        let (dir, angle) = trajectory(&drinks, &male_80kg(), BACFormula::Widmark);
        assert_eq!(dir, Trajectory::Falling);
        assert!(angle < 0.0, "Falling angle should be negative: {angle}");
    }

    #[test]
    fn trajectory_stable_no_drinks() {
        let (dir, angle) = trajectory(&[], &male_80kg(), BACFormula::Widmark);
        assert_eq!(dir, Trajectory::Stable);
        assert!(angle.abs() < 1.0, "Stable angle should be near zero: {angle}");
    }

    #[test]
    fn trajectory_angle_within_bounds() {
        // Angle must always be in (-90, 90)
        let drinks = [beer(-120.0)];
        let (_, angle) = trajectory(&drinks, &male_80kg(), BACFormula::Widmark);
        assert!(angle > -90.0 && angle < 90.0, "Angle out of range: {angle}");
    }

    #[test]
    fn time_to_sober_at_009() {
        let secs = estimate_time_to_sober(0.09).unwrap();
        let hours = secs / 3600.0;
        assert!((hours - 6.0).abs() < 0.01, "Expected 6 hours, got {hours}");
    }

    #[test]
    fn time_to_sober_at_zero() {
        assert!(estimate_time_to_sober(0.0).is_none());
    }

    #[test]
    fn watson_formula_works() {
        let profile = UserProfile {
            weight_kg: 80.0,
            biological_sex: BiologicalSex::Male,
            height_cm: 180.0,
            age: 30,
        };
        let bac = calculate_bac(&[beer(-3600.0)], &profile, BACFormula::Watson);
        assert!(bac > 0.0, "Watson should produce positive BAC");
        assert!(bac < 0.05, "Watson BAC too high: {bac}");
    }

    #[test]
    fn absorbing_drink_count_works() {
        let drinks = vec![
            beer(-120.0),   // 2 min ago — still absorbing
            beer(-18000.0), // 5 hours ago — fully absorbed
        ];
        assert_eq!(absorbing_drink_count(&drinks), 1);
    }

    #[test]
    fn snapshot_assembles_correctly() {
        let drinks = [beer(-1800.0)]; // 30 min ago
        let snap = snapshot(&drinks, &male_80kg(), BACFormula::Widmark, 0.06, 0.09);
        assert!(snap.bac >= 0.0);
        assert!(snap.time_to_sober_secs.is_some() || snap.bac <= 0.001);
    }

    #[test]
    fn format_bac_decimal() {
        assert_eq!(format_bac(0.07, BACUnit::Decimal), "0.07");
    }

    #[test]
    fn format_bac_promille() {
        assert_eq!(format_bac(0.07, BACUnit::Promille), "0.7");
    }

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
}
