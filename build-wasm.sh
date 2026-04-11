#!/bin/bash
set -e

echo "Building ethanol-rs for WebAssembly..."

# The WASM bindings live in the `ethanol-rs-wasm` workspace member. It
# exists as a separate crate so the main `ethanol-rs` crate can stay
# `crate-type = ["lib", "staticlib"]` without dragging a cdylib build
# into every Rust consumer (which breaks iOS cross-compilation under
# Nix's cc-wrapper).
WASM_CRATE_DIR="crates/ethanol-rs-wasm"

# Default target is web
TARGET=${1:-web}

case $TARGET in
    web)
        echo "Building for web target..."
        devenv shell -- wasm-pack build "$WASM_CRATE_DIR" --target web
        ;;
    node|nodejs)
        echo "Building for Node.js target..."
        devenv shell -- wasm-pack build "$WASM_CRATE_DIR" --target nodejs
        mv "$WASM_CRATE_DIR/pkg" "$WASM_CRATE_DIR/pkg-node"
        ;;
    bundler)
        echo "Building for bundler target..."
        devenv shell -- wasm-pack build "$WASM_CRATE_DIR" --target bundler
        mv "$WASM_CRATE_DIR/pkg" "$WASM_CRATE_DIR/pkg-bundler"
        ;;
    all)
        echo "Building for all targets..."
        devenv shell -- wasm-pack build "$WASM_CRATE_DIR" --target web
        cp -r "$WASM_CRATE_DIR/pkg" "$WASM_CRATE_DIR/pkg-web"

        devenv shell -- wasm-pack build "$WASM_CRATE_DIR" --target nodejs
        mv "$WASM_CRATE_DIR/pkg" "$WASM_CRATE_DIR/pkg-node"

        devenv shell -- wasm-pack build "$WASM_CRATE_DIR" --target bundler
        mv "$WASM_CRATE_DIR/pkg" "$WASM_CRATE_DIR/pkg-bundler"

        mv "$WASM_CRATE_DIR/pkg-web" "$WASM_CRATE_DIR/pkg"
        ;;
    *)
        echo "Usage: ./build-wasm.sh [web|node|bundler|all]"
        exit 1
        ;;
esac

echo "✓ Build complete!"
