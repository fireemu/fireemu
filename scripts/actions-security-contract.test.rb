#!/usr/bin/env ruby
require "minitest/autorun"
require "fileutils"
require "tmpdir"
require "yaml"
require_relative "actions-security-contract"

class ActionsSecurityContractTest < Minitest::Test
  PIN = "a" * 40
  BASE = <<~YAML
    name: fixture
    on: push
    permissions:
      contents: read
    jobs:
      latest-sdk-under-exec:
        cache-mode: read
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@#{PIN}
            with:
              persist-credentials: false
          - uses: Swatinem/rust-cache@#{PIN}
            with:
              save-if: "false"
          - run: |
              npm view firebase-admin version
              npm view firebase version
              npm install --ignore-scripts
              fireemu exec node storage.mjs
              fireemu exec node client.mjs
  YAML

  def errors(source, name = "sdk-latest.yml")
    ActionsSecurityContract.violations(source, name: name)
  end

  CI = File.read(File.expand_path("../.github/workflows/ci.yml", __dir__))

  # ci.yml names its actions by tag, so it is judged with the repository's lockfile.
  def ci_errors(source)
    ActionsSecurityContract.violations(source, name: "ci.yml", lock: ActionsLockContract.read(File.expand_path("..", __dir__)))
  end

  def functions_python_job
    CI[/^  functions-python:.*?(?=^  # tools\/sdk-smoke-go)/m]
  end

  def test_the_python_functions_job_runs_third_party_code_read_only_and_without_credentials
    job = functions_python_job
    assert job, "the functions-python job is in ci.yml"
    assert_empty ci_errors(CI)
    refute_empty ci_errors(CI.sub(job, job.sub("cache-mode: read", "cache-mode: write")))
    refute_empty ci_errors(CI.sub(job, job.sub("persist-credentials: false", "persist-credentials: true")))
    refute_empty ci_errors(CI.sub(job, job.sub('save-if: "false"', 'save-if: "true"')))
  end

  def test_real_workflows
    ActionsSecurityContract.check!(File.expand_path("..", __dir__))
  end

  def test_noop_baseline
    assert_empty errors(BASE)
    assert_empty errors(BASE + "# unrelated comment\n")
  end

  def test_external_action_and_reusable_workflow_must_be_commit_pinned
    assert errors(BASE.sub(PIN, "v4")).any? { |e| e.include?("full commit SHA") }
    assert errors("jobs:\n  call:\n    uses: owner/repo/.github/workflows/check.yml@main\n", "other.yml").any? { |e| e.include?("full commit SHA") }
  end

  def test_a_tag_is_accepted_only_with_its_commit_in_the_lockfile
    tagged = BASE.sub("actions/checkout@#{PIN}", "actions/checkout@v4.4.0").sub("Swatinem/rust-cache@#{PIN}", "Swatinem/rust-cache@v2.9.3")
    keys = %w[actions/checkout@v4.4.0 swatinem/rust-cache@v2.9.3]
    dependencies = keys.map { |key| [key, { "commit" => "sha1-#{PIN}" }] }.to_h
    lock = ->(workflows, deps = dependencies) { ActionsLockContract.parse(YAML.dump("workflows" => workflows, "dependencies" => deps)) }
    path = ".github/workflows/sdk-latest.yml"
    assert_empty ActionsSecurityContract.violations(tagged, name: "sdk-latest.yml", lock: lock.call(path => keys))
    # No lockfile, another workflow's lockfile entry, a reference the workflow does not list, an entry without a commit.
    refute_empty errors(tagged)
    refute_empty ActionsSecurityContract.violations(tagged, name: "sdk-latest.yml", lock: lock.call(".github/workflows/ci.yml" => keys))
    refute_empty ActionsSecurityContract.violations(tagged, name: "sdk-latest.yml", lock: lock.call(path => keys.first(1)))
    refute_empty ActionsSecurityContract.violations(tagged, name: "sdk-latest.yml", lock: lock.call({ path => keys }, dependencies.merge(keys.last => { "ref" => "v2.9.3" })))
    # The lockfile never covers a reusable workflow call.
    call = "jobs:\n  call:\n    uses: owner/repo/.github/workflows/check.yml@v1\n"
    key = "owner/repo/.github/workflows/check.yml@v1"
    covered = lock.call({ ".github/workflows/other.yml" => [key] }, { key => { "commit" => "sha1-#{PIN}" } })
    assert ActionsSecurityContract.violations(call, name: "other.yml", lock: covered).any? { |e| e.include?("reusable workflow") }
    assert_empty ActionsSecurityContract.violations(call.sub("@v1", "@#{PIN}"), name: "other.yml", lock: covered)
  end

  def test_every_real_workflow_must_be_in_the_lockfile
    Dir.mktmpdir do |root|
      FileUtils.mkdir_p(File.join(root, ".github/workflows"))
      File.write(File.join(root, ".github/workflows/a.yml"), "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@#{PIN}\n")
      error = assert_raises(RuntimeError) { ActionsSecurityContract.check!(root) }
      assert_includes error.message, "a.yml: not in .github/workflows/actions.lock"
      key = "actions/checkout@#{PIN}"
      File.write(File.join(root, ".github/workflows/actions.lock"), YAML.dump("workflows" => { ".github/workflows/a.yml" => [key] }, "dependencies" => { key => { "commit" => "sha1-#{PIN}" } }))
      ActionsSecurityContract.check!(root)
      File.write(File.join(root, ".github/workflows/b.yaml"), "jobs:\n  b:\n    steps:\n      - run: true\n")
      assert_includes assert_raises(RuntimeError) { ActionsSecurityContract.check!(root) }.message, "b.yaml: not in"
    end
  end

  def test_effective_cache_capability_and_overrides
    ["write", "write-only", "false", "[read]", "${{ inputs.mode }}"].each do |mode|
      refute_empty errors(BASE.sub("cache-mode: read", "cache-mode: #{mode}")), mode
    end
    refute_empty errors(BASE.sub("    cache-mode: read\n", ""))
    inherited = "cache-mode: read\n" + BASE.sub("    cache-mode: read\n", "")
    assert_empty errors(inherited)
    refute_empty errors("cache-mode: read\n" + BASE.sub("cache-mode: read", "cache-mode: write"))
    assert_empty errors(BASE.sub("cache-mode: read", "cache-mode: none"))
  end

  def test_duplicate_keys_and_wrong_locations_are_rejected
    refute_empty errors(BASE.sub("cache-mode: read", "cache-mode: read\n    cache-mode: write"))
    refute_empty errors(BASE.sub("contents: read", "contents: read\n  contents: write"))
    assert errors(BASE.sub("- run: |", "- cache-mode: read\n        run: |")).any? { |error| error.include?("invalid location") }
    refute_empty errors(BASE.sub("cache-mode: read", "cache-mode: &mode read").sub("save-if: \"false\"", "save-if: *mode"))
  end

  def test_latest_sdk_and_checkout_guards_are_preserved
    ["npm view firebase version", "npm install --ignore-scripts", "client.mjs"].each do |command|
      refute_empty errors(BASE.sub(command, "removed")), command
    end
    refute_empty errors(BASE.sub("persist-credentials: false", "persist-credentials: true"))
    refute_empty errors(BASE.sub('save-if: "false"', 'save-if: "true"'))
  end

  def test_release_cache_isolation
    source = "jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@#{PIN}\n        with:\n          cache: npm\n"
    assert errors(source, "release.yml").any? { |e| e.include?("must not consume") }
  end
end
