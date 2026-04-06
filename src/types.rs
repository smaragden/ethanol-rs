/// Biological sex for BAC calculation (affects body water distribution).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "mobile", derive(uniffi::Enum))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "lowercase"))]
pub enum BiologicalSex {
    Male,
    Female,
    Other,
}

impl BiologicalSex {
    /// Widmark gender constant (ratio of body water to total weight).
    pub fn gender_constant(self) -> f64 {
        match self {
            Self::Male => 0.68,
            Self::Female => 0.55,
            Self::Other => 0.615,
        }
    }
}

/// Stomach fullness — affects alcohol absorption rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "mobile", derive(uniffi::Enum))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "snake_case"))]
pub enum StomachState {
    Empty,
    SomeFood,
    Full,
}

impl StomachState {
    /// First-order absorption rate constant (h⁻¹).
    pub fn ka(self) -> f64 {
        match self {
            Self::Empty => 4.0,
            Self::SomeFood => 2.5,
            Self::Full => 1.5,
        }
    }
}

/// BAC formula selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "mobile", derive(uniffi::Enum))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "lowercase"))]
pub enum BACFormula {
    #[default]
    Widmark,
    Watson,
}

/// BAC spectrum zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "mobile", derive(uniffi::Enum))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "snake_case"))]
pub enum BACZone {
    Sober,
    BelowSweetSpot,
    SweetSpot,
    Caution,
    Danger,
}

/// BAC trajectory direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "mobile", derive(uniffi::Enum))]
#[cfg_attr(feature = "wasm", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "lowercase"))]
pub enum Trajectory {
    Rising,
    Falling,
    Stable,
}

/// Volume unit for drink measurements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VolumeUnit {
    Ml,
    Cl,
    Oz,
}

impl VolumeUnit {
    pub fn from_ml(self, ml: f64) -> f64 {
        match self {
            Self::Ml => ml,
            Self::Cl => ml / 10.0,
            Self::Oz => ml / 29.5735,
        }
    }

    pub fn to_ml(self, value: f64) -> f64 {
        match self {
            Self::Ml => value,
            Self::Cl => value * 10.0,
            Self::Oz => value * 29.5735,
        }
    }
}

/// Weight unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightUnit {
    Kg,
    Lbs,
}

impl WeightUnit {
    pub fn from_kg(self, kg: f64) -> f64 {
        match self {
            Self::Kg => kg,
            Self::Lbs => kg * 2.20462,
        }
    }

    pub fn to_kg(self, value: f64) -> f64 {
        match self {
            Self::Kg => value,
            Self::Lbs => value / 2.20462,
        }
    }
}

/// Height unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeightUnit {
    Cm,
    FtIn,
}

impl HeightUnit {
    pub fn from_cm(self, cm: f64) -> f64 {
        match self {
            Self::Cm => cm,
            Self::FtIn => cm / 2.54,
        }
    }

    pub fn to_cm(self, value: f64) -> f64 {
        match self {
            Self::Cm => value,
            Self::FtIn => value * 2.54,
        }
    }
}

/// BAC display unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BACUnit {
    /// US/UK style: 0.07
    Decimal,
    /// European style: 0.7‰
    Promille,
}

impl BACUnit {
    pub fn format_value(self, bac: f64) -> String {
        match self {
            Self::Decimal => format!("{bac:.2}"),
            Self::Promille => format!("{:.1}", bac * 10.0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biological_sex_gender_constants() {
        assert_eq!(BiologicalSex::Male.gender_constant(), 0.68);
        assert_eq!(BiologicalSex::Female.gender_constant(), 0.55);
        assert_eq!(BiologicalSex::Other.gender_constant(), 0.615);
    }

    #[test]
    fn stomach_state_absorption_rates() {
        assert_eq!(StomachState::Empty.ka(), 4.0);
        assert_eq!(StomachState::SomeFood.ka(), 2.5);
        assert_eq!(StomachState::Full.ka(), 1.5);
    }

    #[test]
    fn volume_unit_conversions() {
        assert!((VolumeUnit::Cl.from_ml(330.0) - 33.0).abs() < 0.001);
        assert!((VolumeUnit::Cl.to_ml(33.0) - 330.0).abs() < 0.001);
        assert!((VolumeUnit::Oz.from_ml(29.5735) - 1.0).abs() < 0.001);
    }

    #[test]
    fn weight_unit_conversions() {
        assert!((WeightUnit::Lbs.from_kg(1.0) - 2.20462).abs() < 0.001);
        assert!((WeightUnit::Lbs.to_kg(2.20462) - 1.0).abs() < 0.001);
    }

    #[test]
    fn bac_unit_formatting() {
        assert_eq!(BACUnit::Decimal.format_value(0.07), "0.07");
        assert_eq!(BACUnit::Promille.format_value(0.07), "0.7");
    }
}
