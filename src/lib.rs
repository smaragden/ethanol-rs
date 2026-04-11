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
