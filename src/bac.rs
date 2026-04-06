use crate::types::{BACFormula, BACUnit, BACZone, BiologicalSex, StomachState, Trajectory};

/// Density of ethanol in g/ml.
const ETHANOL_DENSITY: f64 = 0.789;

/// Zero-order metabolism rate: BAC decrease per hour.
const METABOLISM_RATE: f64 = 0.015;

/// Trajectory comparison window in seconds (5 minutes).
const TRAJECTORY_WINDOW_SECS: f64 = 300.0;

/// A single drink for BAC calculation.
#[derive(Debug, Clone, uniffi::Record)]
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
#[derive(Debug, Clone, uniffi::Record)]
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
#[derive(Debug, Clone, uniffi::Record)]
pub struct BACSnapshot {
    pub bac: f64,
    pub trajectory: Trajectory,
    pub zone: BACZone,
    /// Estimated seconds until sober, or `None` if already sober.
    pub time_to_sober_secs: Option<f64>,
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
    if profile.weight_kg <= 0.0 {
        return 0.0;
    }

    let mut total_bac = 0.0;
    let mut earliest_offset: Option<f64> = None;

    for drink in drinks {
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
fn calculate_bac_at_offset(
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

/// Determine BAC trajectory by comparing current BAC to 5 minutes ago.
pub fn trajectory(
    drinks: &[Drink],
    profile: &UserProfile,
    formula: BACFormula,
) -> Trajectory {
    let current = calculate_bac(drinks, profile, formula);
    let past = calculate_bac_at_offset(drinks, profile, formula, -TRAJECTORY_WINDOW_SECS);

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
#[uniffi::export]
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
    let traj = trajectory(drinks, profile, formula);
    let zone = crate::zone::classify_zone(bac, sweet_spot_min, sweet_spot_max);
    let time_to_sober_secs = estimate_time_to_sober(bac);

    BACSnapshot {
        bac,
        trajectory: traj,
        zone,
        time_to_sober_secs,
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

// MARK: - UniFFI exports

#[uniffi::export]
pub fn calc_bac(drinks: Vec<Drink>, profile: UserProfile, formula: BACFormula) -> f64 {
    calculate_bac(&drinks, &profile, formula)
}

#[uniffi::export]
pub fn calc_trajectory(drinks: Vec<Drink>, profile: UserProfile, formula: BACFormula) -> Trajectory {
    trajectory(&drinks, &profile, formula)
}

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

#[uniffi::export]
pub fn calc_absorbing_drink_count(drinks: Vec<Drink>) -> u32 {
    absorbing_drink_count(&drinks) as u32
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
}
