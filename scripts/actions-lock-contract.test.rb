#!/usr/bin/env ruby
# Tests of scripts/actions-lock-contract.rb. The combinations come from actions-lock-contract.pict
# (3-way, with the required rows of actions-lock-contract.seed.tsv).

require "minitest/autorun"
require "yaml"
require_relative "actions-lock-contract"

class ActionsLockContractTest < Minitest::Test
  WORKFLOW = ".github/workflows/fixture.yml"
  SHA = "a" * 40
  LOCKED = "b" * 40
  REFS = { "sha" => SHA, "semver" => "v4.4.0", "major" => "v1", "branch" => "main" }.freeze
  TABLE = File.readlines(File.join(__dir__, "actions-lock-contract.pict.tsv"), chomp: true).map { |line| line.split("\t") }
  ROWS = TABLE.drop(1).map { |row| TABLE.first.zip(row).to_h }

  def uses_of(row)
    name = row["Kind"] == "reusable" ? "Owner/Repo/.github/workflows/check.yml" : "Owner/Action"
    "#{name}@#{REFS.fetch(row['Ref'])}"
  end

  # The lockfile the row describes, as gh actions-lock writes it: lower-case names, `sha1-` commits.
  def lock_of(row, uses)
    return nil if row["Lock"] == "none"
    name, ref = uses.split("@", 2)
    key = "#{name.downcase}@#{ref}"
    commit = row["Ref"] == "sha" ? SHA : LOCKED
    dependencies =
      case row["Entry"]
      when "present", "unlisted" then { key => { "ref" => ref, "commit" => "sha1-#{commit}" } }
      when "bad_commit" then { key => { "ref" => ref, "commit" => ref } }
      else {}
      end
    listed = %w[present bad_commit].include?(row["Entry"]) ? [key] : []
    workflows = row["Onboarded"] == "yes" ? { WORKFLOW => listed } : { ".github/workflows/other.yml" => [key] }
    ActionsLockContract.parse(YAML.dump("version" => "v0.0.3", "workflows" => workflows, "dependencies" => dependencies))
  end

  def accepted?(row)
    return row["Ref"] == "sha" if row["Kind"] == "reusable"
    return row["Entry"] == "present" if row["Onboarded"] == "yes"
    row["Ref"] == "sha"
  end

  def test_the_table_holds_every_factor_and_the_required_rows
    assert_equal %w[Kind Ref Lock Onboarded Entry], TABLE.first
    assert_operator ROWS.length, :>=, 30
    seeds = File.readlines(File.join(__dir__, "actions-lock-contract.seed.tsv"), chomp: true).drop(1)
    seeds.each { |seed| assert_includes TABLE.drop(1).map { |row| row.join("\t") }, seed }
    assert(ROWS.any? { |row| accepted?(row) } && ROWS.any? { |row| !accepted?(row) })
  end

  def test_every_combination_is_accepted_or_refused_as_the_lockfile_decides
    ROWS.each do |row|
      uses = uses_of(row)
      problem = ActionsLockContract.problem(lock_of(row, uses), WORKFLOW, uses, reusable: row["Kind"] == "reusable")
      if accepted?(row)
        assert_nil problem, row.inspect
      else
        refute_nil problem, row.inspect
        assert_includes problem, uses, row.inspect
      end
    end
  end

  def lock(workflows, dependencies)
    ActionsLockContract.parse(YAML.dump("version" => "v0.0.3", "workflows" => workflows, "dependencies" => dependencies))
  end

  def test_the_commit_a_reference_runs
    locked = lock({ WORKFLOW => ["owner/action@v4.4.0"] }, { "owner/action@v4.4.0" => { "commit" => "sha1-#{LOCKED}" } })
    assert_equal LOCKED, ActionsLockContract.commit(locked, WORKFLOW, "Owner/Action@v4.4.0")
    # Another tag of the same action, another workflow and no lockfile have no commit.
    assert_nil ActionsLockContract.commit(locked, WORKFLOW, "Owner/Action@v4.4.1")
    assert_nil ActionsLockContract.commit(locked, ".github/workflows/other.yml", "Owner/Action@v4.4.0")
    assert_nil ActionsLockContract.commit(nil, WORKFLOW, "Owner/Action@v4.4.0")
    # A full SHA in a workflow that is not onboarded runs that commit.
    assert_equal SHA, ActionsLockContract.commit(nil, WORKFLOW, "Owner/Action@#{SHA}")
    assert_equal SHA, ActionsLockContract.commit(locked, ".github/workflows/other.yml", "Owner/Action@#{SHA}")
    # Thirty-nine hex digits are a ref, not a commit.
    assert_nil ActionsLockContract.commit(nil, WORKFLOW, "Owner/Action@#{SHA[0, 39]}")
    # A reference is one word: a lockfile entry cannot give a commit to a `uses` with a space in it.
    spaced = "owner/action@v1 x"
    assert_nil ActionsLockContract.commit(lock({ WORKFLOW => [spaced] }, { spaced => { "commit" => "sha1-#{LOCKED}" } }), WORKFLOW, spaced)
  end

  def test_a_full_sha_in_an_onboarded_workflow_needs_its_own_entry_with_that_commit
    uses = "Owner/Action@#{SHA}"
    key = "owner/action@#{SHA}"
    assert_nil ActionsLockContract.problem(lock({ WORKFLOW => [key] }, { key => { "commit" => "sha1-#{SHA}" } }), WORKFLOW, uses)
    refute_nil ActionsLockContract.problem(lock({ WORKFLOW => [key] }, { key => { "commit" => "sha1-#{LOCKED}" } }), WORKFLOW, uses)
    refute_nil ActionsLockContract.problem(lock({ WORKFLOW => [] }, {}), WORKFLOW, uses)
  end

  def test_only_a_sha1_commit_of_forty_hex_digits_counts
    ["sha1-#{LOCKED[0, 39]}", "sha1-#{LOCKED}0", "sha1-#{LOCKED.upcase}", LOCKED, "sha256-#{LOCKED}", nil, 7].each do |commit|
      locked = lock({ WORKFLOW => ["owner/action@v1"] }, { "owner/action@v1" => { "commit" => commit } })
      assert_nil ActionsLockContract.commit(locked, WORKFLOW, "owner/action@v1"), commit.inspect
    end
  end

  def test_a_malformed_lockfile_is_an_error_not_an_empty_lockfile
    ["", "- a\n", "workflows: []\ndependencies: {}\n", "workflows: {}\n", "workflows: {}\ndependencies: []\n", "workflows: {a: b}\ndependencies: {}\n", "workflows: &same {}\ndependencies: *same\n", ":\n  - ["].each do |source|
      assert_raises(ActionsLockContract::Malformed, source.inspect) { ActionsLockContract.parse(source) }
    end
    assert_nil ActionsLockContract.parse(nil)
  end

  def test_local_actions_and_malformed_references
    assert_nil ActionsLockContract.problem(nil, WORKFLOW, "./.github/actions/setup")
    ["owner/action", "owner/action@", "@v1", "owner/action@v1 x", 7, nil, "docker://alpine:3"].each do |uses|
      refute_nil ActionsLockContract.problem(nil, WORKFLOW, uses), uses.inspect
    end
  end

  def test_the_real_lockfile_covers_every_real_workflow
    root = File.expand_path("..", __dir__)
    locked = ActionsLockContract.read(root)
    workflows = Dir.glob(File.join(root, ".github/workflows/*.{yml,yaml}")).map { |path| path.delete_prefix("#{root}/") }
    assert_equal [], ActionsLockContract.not_onboarded(locked, workflows)
    assert_equal [".github/workflows/new.yml"], ActionsLockContract.not_onboarded(locked, workflows + [".github/workflows/new.yml"])
    assert_equal workflows.sort, ActionsLockContract.not_onboarded(nil, workflows).sort
  end
end
