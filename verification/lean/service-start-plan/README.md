# Product services in a CLI plan

The Lean reference characterizes listeners considered by `ServiceStarts::resolve` from the service selection and configured inputs. It models Functions and its Eventarc and Tasks support, the explicit Hosting refusal, and the default versus explicit behavior for Pub/Sub and Realtime Database. The corpus includes the option-resolution refusal for a support-only selection without explicit support-emulator configuration.

The Rust test uses the real `up --plan --json` command with a cleared environment and local synthetic config. A configured Functions runner value prevents interpreter probing. The replay compares all nine product service start flags and the two refusal categories. Runtime binding, App Check's shared route, auxiliary services and runner launch are outside this model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu/tests/fixtures/lean-service-start-plan.corpus
```
