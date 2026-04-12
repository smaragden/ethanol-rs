//! # ethanol-rs
//!
//! Cross-platform ethanol pharmacokinetics modeling (Widmark, Watson,
//! first-order absorption, zero-order elimination, session detection,
//! duration-aware sipping).
//!
//! # Not clinically validated
//!
//! The core BAC formulas (Widmark, Watson) and zero-order elimination are
//! peer-reviewed and widely used in forensic toxicology. However, some
//! features — notably **duration-aware sipping** (`duration_secs`) — are
//! simplified heuristics without published validation. Even the established
//! models carry ±20–30% inter-individual variation, and this implementation
//! has **not** been clinically or forensically validated against measured BAC.
//!
//! **Do not rely on this library to decide whether it is safe to drive, to
//! operate machinery, to take medication, or for any medical, legal, or
//! safety-critical purpose.** It is intended for research, education, and
//! rough personal awareness only. Use at your own risk.

#[cfg(feature = "mobile")]
uniffi::setup_scaffolding!();

pub mod bac;
pub mod types;
pub mod zone;

// WASM bindings live in the separate `ethanol-rs-wasm` crate under
// crates/ethanol-rs-wasm. They need `crate-type = ["cdylib"]` which cannot
// coexist with this crate's `staticlib` on iOS under Nix-wrapped cc
// (libiconv.dylib links for macOS, not iOS sim). Keeping wasm in a
// separate workspace member lets both targets build cleanly.
