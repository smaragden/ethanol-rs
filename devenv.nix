{ pkgs, lib, config, inputs, ... }:

{
  packages = [
    pkgs.git
    pkgs.wasm-pack
  ];

  languages.rust = {
    enable = true;
    channel = "stable";
    targets = [ "wasm32-unknown-unknown" ];
  };
}