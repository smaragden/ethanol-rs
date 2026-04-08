#!/bin/bash
set -e

echo "Building ethanol-rs for WebAssembly..."

# Default target is web
TARGET=${1:-web}

case $TARGET in
    web)
        echo "Building for web target..."
        devenv shell -- wasm-pack build --target web --features wasm
        ;;
    node|nodejs)
        echo "Building for Node.js target..."
        devenv shell -- wasm-pack build --target nodejs --features wasm
        mv pkg pkg-node
        ;;
    bundler)
        echo "Building for bundler target..."
        devenv shell -- wasm-pack build --target bundler --features wasm
        mv pkg pkg-bundler
        ;;
    all)
        echo "Building for all targets..."
        devenv shell -- wasm-pack build --target web --features wasm
        cp -r pkg pkg-web

        devenv shell -- wasm-pack build --target nodejs --features wasm
        mv pkg pkg-node

        devenv shell -- wasm-pack build --target bundler --features wasm
        mv pkg pkg-bundler

        mv pkg-web pkg
        ;;
    *)
        echo "Usage: ./build-wasm.sh [web|node|bundler|all]"
        exit 1
        ;;
esac

echo "✓ Build complete!"
