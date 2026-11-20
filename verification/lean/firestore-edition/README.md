# Firestore edition and API capabilities in Lean 4

The specification models the immutable capability matrix exposed by `DatabaseCapabilities::try_new`. It takes the catalog text from an already validated `LimitCatalogId`, keeps edition, API family and catalog prefix separate and gives the invalid Standard/MongoDB combination precedence over the catalog check.

The theorems characterize Core and Pipeline capability for every admitted configuration and show that text and geospatial previews agree in this matrix. The generator exhausts the edition, API and catalog case product. The capability levels describe the repository contract, which can change independently of the upstream product.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-firestore-edition.corpus
cargo test -p fireemu-core-types --test firestore_edition_lean_corpus
```
