use crate::types::BACZone;

/// Classify a BAC value into a spectrum zone.
///
/// Zone boundaries:
/// - Sober: BAC <= 0.001
/// - Below sweet spot: BAC < sweet_spot_min
/// - Sweet spot: BAC <= sweet_spot_max
/// - Caution: BAC <= sweet_spot_max + 0.01
/// - Danger: everything above
#[uniffi::export]
pub fn classify_zone(bac: f64, sweet_spot_min: f64, sweet_spot_max: f64) -> BACZone {
    if bac <= 0.001 {
        BACZone::Sober
    } else if bac < sweet_spot_min {
        BACZone::BelowSweetSpot
    } else if bac <= sweet_spot_max {
        BACZone::SweetSpot
    } else if bac <= sweet_spot_max + 0.01 {
        BACZone::Caution
    } else {
        BACZone::Danger
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: f64 = 0.06;
    const MAX: f64 = 0.09;

    #[test]
    fn sober() {
        assert_eq!(classify_zone(0.0, MIN, MAX), BACZone::Sober);
        assert_eq!(classify_zone(0.001, MIN, MAX), BACZone::Sober);
    }

    #[test]
    fn below_sweet_spot() {
        assert_eq!(classify_zone(0.03, MIN, MAX), BACZone::BelowSweetSpot);
    }

    #[test]
    fn sweet_spot() {
        assert_eq!(classify_zone(0.06, MIN, MAX), BACZone::SweetSpot);
        assert_eq!(classify_zone(0.07, MIN, MAX), BACZone::SweetSpot);
        assert_eq!(classify_zone(0.09, MIN, MAX), BACZone::SweetSpot);
    }

    #[test]
    fn caution() {
        assert_eq!(classify_zone(0.095, MIN, MAX), BACZone::Caution);
        assert_eq!(classify_zone(0.099, MIN, MAX), BACZone::Caution);
    }

    #[test]
    fn danger() {
        assert_eq!(classify_zone(0.12, MIN, MAX), BACZone::Danger);
    }

    #[test]
    fn boundary_sweet_spot_min() {
        // Exactly at min should be sweet spot
        assert_eq!(classify_zone(0.06, MIN, MAX), BACZone::SweetSpot);
        // Just below should be below sweet spot
        assert_eq!(classify_zone(0.0599, MIN, MAX), BACZone::BelowSweetSpot);
    }
}
