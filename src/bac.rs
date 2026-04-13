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
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Drink {
    /// Volume in milliliters.
    pub volume_ml: f64,
    /// Alcohol by volume as a fraction (e.g., 0.05 for 5%).
    pub abv: f64,
    /// Seconds since the reference time at which the user *started* drinking
    /// (negative = in the past). For a drink begun 30 minutes ago:
    /// `offset_secs = -1800.0`.
    pub offset_secs: f64,
    /// Duration over which the drink is consumed, in seconds. The drink is
    /// modeled as a constant-rate infusion into the stomach from `offset_secs`
    /// to `offset_secs + duration_secs`. A value of `0.0` collapses the drink
    /// to an instantaneous impulse at `offset_secs` — this is the
    /// backwards-compatible default for callers that don't care about sip
    /// duration.
    #[cfg_attr(feature = "serde", serde(default))]
    pub duration_secs: f64,
    /// Stomach state at time of drink.
    pub stomach_state: StomachState,
}

/// User's physical profile for BAC calculation.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BACSnapshot {
    pub bac: f64,
    pub trajectory: Trajectory,
    pub zone: BACZone,
    /// Estimated seconds until sober, or `None` if already sober.
    pub time_to_sober_secs: Option<f64>,
}

/// A single point in a BAC curve.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "mobile", derive(uniffi::Record))]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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
    calculate_bac_at_offset(drinks, profile, formula, 0.0)
}

/// Calculate BAC at an arbitrary time offset (in seconds) from `t = 0`.
pub fn calculate_bac_at_offset(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    time_offset_secs: f64,
) -> f64 {
    if drinks.is_empty() || profile.weight_kg <= 0.0 {
        return 0.0;
    }

    let mut sorted = drinks.to_vec();
    sorted.sort_by(|a, b| a.offset_secs.partial_cmp(&b.offset_secs).unwrap());

    let session_start = find_session_start(&sorted, profile, formula);
    bac_from_sorted(&sorted[session_start..], profile, formula, time_offset_secs)
}

/// BAC from an already-sorted, session-resolved slice at an arbitrary evaluation time.
///
/// Drinks with `offset_secs > eval_time_secs` are treated as future and skipped.
/// Does NOT perform session detection — the caller is expected to have sliced the
/// input appropriately. Keeping this pure is what lets the hot paths hoist session
/// detection out of inner loops.
fn bac_from_sorted(
    sorted: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
    eval_time_secs: f64,
) -> f64 {
    if sorted.is_empty() || profile.weight_kg <= 0.0 {
        return 0.0;
    }

    let (weight_grams, gender_constant, tbw) = match formula {
        BACFormula::Widmark => (
            profile.weight_kg * 1000.0,
            profile.biological_sex.gender_constant(),
            0.0,
        ),
        BACFormula::Watson => {
            let tbw = total_body_water(profile);
            if tbw <= 0.0 {
                return 0.0;
            }
            (0.0, 0.0, tbw)
        }
    };

    let mut total_bac = 0.0;
    let mut earliest_offset: Option<f64> = None;

    for drink in sorted {
        if eval_time_secs < drink.offset_secs {
            continue; // future drink, skip
        }

        let alcohol_grams = drink.volume_ml * drink.abv * ETHANOL_DENSITY;
        let ka = drink.stomach_state.ka();
        let absorption_fraction = absorbed_fraction(
            drink.offset_secs,
            drink.duration_secs,
            ka,
            eval_time_secs,
        );
        let effective_alcohol = alcohol_grams * absorption_fraction;

        let drink_bac = match formula {
            BACFormula::Widmark => {
                (effective_alcohol / (weight_grams * gender_constant)) * 100.0
            }
            BACFormula::Watson => (effective_alcohol / (tbw * 800.0)) * 100.0,
        };

        total_bac += drink_bac;

        match earliest_offset {
            Some(e) if drink.offset_secs < e => earliest_offset = Some(drink.offset_secs),
            None => earliest_offset = Some(drink.offset_secs),
            _ => {}
        }
    }

    if let Some(earliest) = earliest_offset {
        let metabolism_hours = (eval_time_secs - earliest) / 3600.0;
        total_bac = (total_bac - metabolism_hours * METABOLISM_RATE).max(0.0);
    }

    total_bac
}

/// Find the index of the first drink in the active drinking session.
///
/// Scans chronologically-sorted drinks and detects session boundaries where BAC
/// from prior drinks has fully metabolized (≤ 0.001) at the time of the next drink.
/// When a boundary is found the metabolism clock restarts from that drink.
///
/// Session boundaries are a structural property of the drink timings alone, so the
/// result is independent of query time — which lets curve generation hoist this
/// call out of its inner loop.
fn find_session_start(
    sorted: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> usize {
    if sorted.len() <= 1 {
        return 0;
    }

    let mut session_start = 0;
    for i in 1..sorted.len() {
        // If any prior drink in this session is still being sipped at the time
        // of drink i, absorption has barely started — skip the boundary check
        // to avoid falsely splitting simultaneous/overlapping drinks.
        let any_still_sipping = sorted[session_start..i].iter().any(|d| {
            d.duration_secs > 0.0
                && sorted[i].offset_secs < d.offset_secs + d.duration_secs
        });
        if any_still_sipping {
            continue;
        }

        let bac_at_new_drink = bac_from_sorted(
            &sorted[session_start..i],
            profile,
            formula,
            sorted[i].offset_secs,
        );
        if bac_at_new_drink <= 0.001 {
            session_start = i;
        }
    }
    session_start
}

/// Sort drinks chronologically and resolve the active session boundary.
///
/// Returns the sorted `Vec` and the index of the first drink in the active
/// session. Callers should slice `sorted[session_start..]` to get the active
/// drinks, then hand that slice to `bac_from_sorted` one or more times.
fn sort_and_resolve_session(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> (Vec<Drink>, usize) {
    let mut sorted = drinks.to_vec();
    sorted.sort_by(|a, b| a.offset_secs.partial_cmp(&b.offset_secs).unwrap());
    let session_start = find_session_start(&sorted, profile, formula);
    (sorted, session_start)
}

/// Determine BAC trajectory by comparing current BAC to 5 minutes ago.
pub fn trajectory(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> Trajectory {
    if drinks.is_empty() || profile.weight_kg <= 0.0 {
        return Trajectory::Stable;
    }
    let (sorted, session_start) = sort_and_resolve_session(drinks, profile, formula);
    let active = &sorted[session_start..];
    let current = bac_from_sorted(active, profile, formula, 0.0);
    let past = bac_from_sorted(active, profile, formula, -TRAJECTORY_WINDOW_SECS);

    let diff = current - past;
    if diff > 0.001 {
        Trajectory::Rising
    } else if diff < -0.001 {
        Trajectory::Falling
    } else {
        Trajectory::Stable
    }
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
    if drinks.is_empty() || profile.weight_kg <= 0.0 {
        return BACSnapshot {
            bac: 0.0,
            trajectory: Trajectory::Stable,
            zone: crate::zone::classify_zone(0.0, sweet_spot_min, sweet_spot_max),
            time_to_sober_secs: None,
        };
    }

    // Sort + session-detect once, reuse for current, past, and zone.
    let (sorted, session_start) = sort_and_resolve_session(drinks, profile, formula);
    let active = &sorted[session_start..];

    let bac = bac_from_sorted(active, profile, formula, 0.0);
    let past = bac_from_sorted(active, profile, formula, -TRAJECTORY_WINDOW_SECS);

    let diff = bac - past;
    let traj = if diff > 0.001 {
        Trajectory::Rising
    } else if diff < -0.001 {
        Trajectory::Falling
    } else {
        Trajectory::Stable
    };

    let zone = crate::zone::classify_zone(bac, sweet_spot_min, sweet_spot_max);
    let time_to_sober_secs = estimate_time_to_sober(bac);

    BACSnapshot {
        bac,
        trajectory: traj,
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
    // Sort and resolve the session boundary a single time for the whole curve.
    // Session detection is a structural property of the drink set, so it's the
    // same at every sample point.
    let (sorted, session_start) = sort_and_resolve_session(drinks, profile, formula);
    let active = &sorted[session_start..];

    let capacity = if step_secs > 0.0 {
        (((to_offset_secs - from_offset_secs) / step_secs).floor() as usize).saturating_add(1)
    } else {
        0
    };
    let mut points = Vec::with_capacity(capacity);
    let mut offset = from_offset_secs;

    while offset <= to_offset_secs {
        let bac = bac_from_sorted(active, profile, formula, offset);
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

/// Fraction of a drink's dose absorbed into the bloodstream at `eval_time_secs`,
/// given a drink consumed as a constant-rate infusion from `offset_secs` to
/// `offset_secs + duration_secs`, followed by first-order absorption with rate
/// constant `ka` (per hour).
///
/// Returns `0.0` if the drink hasn't started yet. Reduces exactly to the
/// classic impulse solution `1 - exp(-ka * tau)` when `duration_secs <= 0`.
///
/// Derivation: let `G(t)` be the amount of ethanol in the gut compartment.
/// With a constant input rate `D/T` over `[0, T]` and first-order output
/// `ka * G`, the closed form of the absorbed fraction `F(tau)` is:
///
/// ```text
/// during sip (0 <= tau <= T):
///     F(tau) = (1/T) * (tau - (1 - exp(-ka * tau)) / ka)
///
/// after sip (tau > T):
///     F(tau) = 1 - (1 - exp(-ka * T)) / (T * ka) * exp(-ka * (tau - T))
/// ```
///
/// Both branches are continuous at `tau = T` and agree with the impulse form
/// in the limit `T -> 0`.
fn absorbed_fraction(
    offset_secs: f64,
    duration_secs: f64,
    ka: f64,
    eval_time_secs: f64,
) -> f64 {
    let elapsed_secs = eval_time_secs - offset_secs;
    if elapsed_secs <= 0.0 {
        return 0.0;
    }
    let tau = elapsed_secs / 3600.0;

    if duration_secs <= 0.0 {
        return 1.0 - (-ka * tau).exp();
    }

    let big_t = duration_secs / 3600.0;
    if tau <= big_t {
        // During-sip branch.
        (tau - (1.0 - (-ka * tau).exp()) / ka) / big_t
    } else {
        // Post-sip branch.
        1.0 - (1.0 - (-ka * big_t).exp()) / (big_t * ka) * (-ka * (tau - big_t)).exp()
    }
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

/// Count drinks still being actively absorbed (< 95% absorbed) at `t = 0`.
pub fn absorbing_drink_count(drinks: &[Drink]) -> usize {
    drinks
        .iter()
        .filter(|d| {
            if d.offset_secs > 0.0 {
                return false; // hasn't started yet
            }
            let fraction = absorbed_fraction(
                d.offset_secs,
                d.duration_secs,
                d.stomach_state.ka(),
                0.0,
            );
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
    if drinks.is_empty() || profile.weight_kg <= 0.0 {
        return 0.0;
    }

    // Sort + session detect ONCE; all scan samples reuse the active slice.
    let (sorted, session_start) = sort_and_resolve_session(drinks, profile, formula);
    let active = &sorted[session_start..];

    let current_bac = bac_from_sorted(active, profile, formula, 0.0);
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
        let bac = bac_from_sorted(active, profile, formula, offset_secs);
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
        let bac = bac_from_sorted(active, profile, formula, offset_secs);
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
    trajectory(&drinks, &profile, formula)
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
            duration_secs: 0.0,
            stomach_state: StomachState::Empty,
        }
    }

    fn sipped_beer(offset_secs: f64, duration_secs: f64) -> Drink {
        Drink {
            volume_ml: 330.0,
            abv: 0.05,
            offset_secs,
            duration_secs,
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
        let traj = trajectory(&drinks, &male_80kg(), BACFormula::Widmark);
        assert_eq!(traj, Trajectory::Rising);
    }

    #[test]
    fn trajectory_falling_hours_later() {
        // Drink logged 1.5 hours ago — past peak, still metabolizing
        let drinks = [beer(-5400.0)];
        let traj = trajectory(&drinks, &male_80kg(), BACFormula::Widmark);
        assert_eq!(traj, Trajectory::Falling);
    }

    #[test]
    fn trajectory_stable_no_drinks() {
        let traj = trajectory(&[], &male_80kg(), BACFormula::Widmark);
        assert_eq!(traj, Trajectory::Stable);
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
    fn session_detection_simultaneous_sipped_drinks() {
        // Regression: 3 sipped beers logged within 1–2 seconds of each other
        // must stay in the same session. Before the fix, the sip-duration model
        // returned near-zero absorbed_fraction at t≈1s, causing find_session_start
        // to drop all but the last drink.
        let drinks = vec![
            sipped_beer(-1800.0, 840.0),  // 30 min ago, 14-min sip
            sipped_beer(-1799.0, 840.0),  // ~1 s later
            sipped_beer(-1798.0, 840.0),  // ~2 s later
        ];
        let bac_all = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
        let bac_one = calculate_bac(&[sipped_beer(-1798.0, 840.0)], &male_80kg(), BACFormula::Widmark);
        assert!(
            bac_all > bac_one * 2.0,
            "3 simultaneous sipped beers should produce much more BAC than 1: all={bac_all}, one={bac_one}"
        );
    }

    #[test]
    fn session_detection_sipped_then_gap_still_splits() {
        // A sipped beer 8 hours ago (fully metabolized) should still be detected
        // as a separate session from a beer now.
        let drinks = vec![
            sipped_beer(-28800.0, 840.0),  // 8 hours ago
            sipped_beer(0.0, 840.0),        // just now
        ];
        let bac_with_old = calculate_bac(&drinks, &male_80kg(), BACFormula::Widmark);
        let bac_just_new = calculate_bac(&[sipped_beer(0.0, 840.0)], &male_80kg(), BACFormula::Widmark);
        assert!(
            (bac_with_old - bac_just_new).abs() < 0.001,
            "Old sipped drink should not affect current BAC: with_old={bac_with_old}, just_new={bac_just_new}"
        );
    }

    #[test]
    fn absorbed_fraction_zero_duration_matches_impulse() {
        // Regression guard: the infusion formula must collapse exactly to the
        // impulse formula when duration_secs == 0.
        for tau_hours in [0.1f64, 0.5, 1.0, 2.0, 4.0] {
            for ka in [1.5f64, 2.5, 4.0] {
                let elapsed_secs = tau_hours * 3600.0;
                let impulse = absorbed_fraction(0.0, 0.0, ka, elapsed_secs);
                let expected = 1.0 - (-ka * tau_hours).exp();
                assert!(
                    (impulse - expected).abs() < 1e-12,
                    "impulse formula drift at ka={ka}, tau={tau_hours}"
                );
            }
        }
    }

    #[test]
    fn absorbed_fraction_is_continuous_at_sip_end() {
        // The during-sip and after-sip branches must agree at tau == T.
        let ka = 4.0;
        let duration = 1800.0; // 30 min
        // Evaluate just inside and at the boundary.
        let during = absorbed_fraction(0.0, duration, ka, duration);
        let after = absorbed_fraction(0.0, duration, ka, duration + 1.0e-6);
        assert!(
            (during - after).abs() < 1e-9,
            "sip boundary discontinuous: during={during}, after={after}"
        );
    }

    #[test]
    fn absorbed_fraction_monotonic_over_sip() {
        // Absorbed fraction should be strictly increasing while the drink is
        // being consumed and while it continues absorbing afterwards.
        let ka = 2.5;
        let duration = 1500.0; // 25 min
        let mut prev = 0.0;
        for step in 1..120 {
            let t = step as f64 * 60.0;
            let f = absorbed_fraction(0.0, duration, ka, t);
            assert!(
                f > prev - 1e-12,
                "non-monotonic at t={t}: prev={prev}, f={f}"
            );
            prev = f;
        }
    }

    #[test]
    fn duration_zero_drink_equals_legacy_bac() {
        // Same inputs, both paths: duration==0 must match what the old code
        // would have computed (which is what `beer(-1800.0)` exercises today).
        let legacy = calculate_bac(&[beer(-1800.0)], &male_80kg(), BACFormula::Widmark);
        let explicit_zero = calculate_bac(
            &[sipped_beer(-1800.0, 0.0)],
            &male_80kg(),
            BACFormula::Widmark,
        );
        assert!(
            (legacy - explicit_zero).abs() < 1e-12,
            "legacy={legacy}, explicit_zero={explicit_zero}"
        );
    }

    #[test]
    fn sipped_drink_lower_bac_than_impulse_at_same_end_time() {
        // Drink started 30 min ago. One finished instantly (impulse),
        // the other sipped over the full 30 min, finishing right now.
        // At t=0, the impulse has had 30 min to cross into blood while the
        // sipped drink averaged only ~15 min of absorption time — so the
        // impulse BAC must be strictly higher.
        let impulse = calculate_bac(&[beer(-1800.0)], &male_80kg(), BACFormula::Widmark);
        let sipped = calculate_bac(
            &[sipped_beer(-1800.0, 1800.0)],
            &male_80kg(),
            BACFormula::Widmark,
        );
        assert!(
            impulse > sipped,
            "impulse ({impulse}) should exceed sipped ({sipped})"
        );
        assert!(sipped > 0.0, "sipped BAC should still be positive");
    }

    #[test]
    fn absorbed_fraction_in_progress_positive_and_below_impulse() {
        // At t=0 a drink started 10 min ago with a 30-min duration is halfway
        // through being sipped. Some fraction must be absorbed (>0), and it
        // must be strictly less than the impulse equivalent where the entire
        // dose has been in the gut for the full 10 minutes.
        let ka = 4.0;
        let in_progress = absorbed_fraction(-600.0, 1800.0, ka, 0.0);
        let impulse = absorbed_fraction(-600.0, 0.0, ka, 0.0);
        assert!(in_progress > 0.0, "in-progress fraction should be > 0");
        assert!(
            in_progress < impulse,
            "in-progress ({in_progress}) should be below impulse ({impulse})"
        );
    }

    #[test]
    fn future_sipped_drink_ignored() {
        // Starts 10 min from now, duration 20 min — entirely in the future.
        let bac = calculate_bac(
            &[sipped_beer(600.0, 1200.0)],
            &male_80kg(),
            BACFormula::Widmark,
        );
        assert_eq!(bac, 0.0);
    }

    #[test]
    fn sipped_drink_peak_arrives_later_than_impulse() {
        // Sample BAC over the hour after a drink starts. The sipped version
        // peaks strictly later than the impulse version.
        let profile = male_80kg();
        let impulse_curve =
            generate_curve(&[beer(0.0)], &profile, BACFormula::Widmark, 0.0, 7200.0, 60.0, 0.06, 0.09);
        let sipped_curve = generate_curve(
            &[sipped_beer(0.0, 1800.0)],
            &profile,
            BACFormula::Widmark,
            0.0,
            7200.0,
            60.0,
            0.06,
            0.09,
        );
        let peak = |c: &Vec<CurvePoint>| {
            c.iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.bac.partial_cmp(&b.bac).unwrap())
                .map(|(i, p)| (i, p.bac))
                .unwrap()
        };
        let (impulse_idx, impulse_peak) = peak(&impulse_curve);
        let (sipped_idx, sipped_peak) = peak(&sipped_curve);
        assert!(
            sipped_idx > impulse_idx,
            "sipped peak idx {sipped_idx} should be later than impulse peak idx {impulse_idx}"
        );
        assert!(
            sipped_peak < impulse_peak,
            "sipped peak BAC {sipped_peak} should be lower than impulse peak {impulse_peak}"
        );
    }

    #[test]
    fn absorbing_drink_count_includes_in_progress_sipped_drink() {
        // In-progress drink (not yet finished) must count as absorbing.
        let drinks = vec![sipped_beer(-300.0, 1500.0)]; // 5 min in, 20 min to go
        assert_eq!(absorbing_drink_count(&drinks), 1);
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
