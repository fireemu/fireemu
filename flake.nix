{
  description = "Fireemu - a single-binary local Firebase emulator targeting production Firebase behavior";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              overlays = [ (import rust-overlay) ];
            }
          )
        );
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          rustPlatform = pkgs.makeRustPlatform {
            cargo = rustToolchain;
            rustc = rustToolchain;
          };

          uiSrc = pkgs.lib.cleanSourceWith {
            src = ./ui;
            filter =
              path: type:
              let
                base = baseNameOf (toString path);
              in
              !(builtins.elem base [
                "node_modules"
                "dist"
                "playwright-report"
                "test-results"
                ".runs"
              ]);
          };

          fireemu-ui = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "fireemu-ui";
            version = "0.70.0";
            src = uiSrc;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              pnpm = pkgs.pnpm_10;
              fetcherVersion = 5;
              hash = "sha256-PYgHfO2MllnT8kDAX8WgXRedB9oegmSSzZgSeW/jRh4=";
            };

            nativeBuildInputs = [
              pkgs.nodejs_24
              pkgs.pnpm_10
              pkgs.pnpmConfigHook
            ];

            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r dist/. $out/
              runHook postInstall
            '';
          });

          fireemu = rustPlatform.buildRustPackage {
            pname = "fireemu";
            version = "0.70.0";
            src = pkgs.lib.cleanSourceWith {
              src = self;
              filter =
                path: type:
                let
                  base = baseNameOf (toString path);
                in
                !(builtins.elem base [
                  "target"
                  "node_modules"
                  ".git"
                  ".worktree"
                  ".worktrees"
                  "docs.local"
                  ".coverage-ledger"
                  ".pnpm-store"
                  "mutants.out"
                  "mutants.out.old"
                  "states"
                ]);
            };

            cargoLock = {
              lockFile = ./Cargo.lock;
            };

            cargoBuildFlags = [
              "-p"
              "fireemu"
            ];

            doCheck = false;

            nativeBuildInputs = [
              pkgs.pkg-config
            ];

            preBuild = ''
              mkdir -p ui/dist
              cp -r ${fireemu-ui}/. ui/dist/
            '';

            postInstall = ''
              mkdir -p $out/runner-node $out/runner-python
              find tools/runner-node -maxdepth 1 -type f -name '*.mjs' ! -name '*.test.mjs' -exec cp {} $out/runner-node/ \;
              cp tools/runner-python/runner.py $out/runner-python/
              cp -r tools/runner-python/fireemu_runner $out/runner-python/
            '';

            meta = with pkgs.lib; {
              description = "Single-binary local Firebase emulator targeting production Firebase behavior";
              homepage = "https://fireemu.github.io/fireemu/";
              license = licenses.asl20;
              mainProgram = "fireemu";
              platforms = systems;
            };
          };
        in
        {
          inherit fireemu fireemu-ui;
          default = fireemu;
        }
      );

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/fireemu";
        };
      });

      devShells = forAllSystems (
        pkgs:
        let
          rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
        in
        {
          default = pkgs.mkShell {
            packages = [
              rustToolchain
              pkgs.nodejs_24
              pkgs.pnpm_10
              pkgs.pkg-config
            ];
          };
        }
      );
    };
}
