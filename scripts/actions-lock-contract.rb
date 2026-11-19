#!/usr/bin/env ruby
# The commit an action reference runs, read from the workflow lockfile `gh actions-lock` writes
# (.github/workflows/actions.lock, https://gh.io/actions-lockfile).
#
# Workflows name actions by tag (`actions/checkout@v4.4.0`); the lockfile records the commit each
# reference runs, for the workflow's own steps and for the actions those actions use. The other
# workflow contracts ask this module which commit a reference runs, so the commits they allow stay
# written in this repository and are checked without the network. `gh actions-lock --verify` in the
# ci.yml lint job checks the same lockfile against upstream.
#
# A reference is accepted when:
# - it is a local action (`./...`);
# - it is a step of a workflow the lockfile lists, and the lockfile lists that reference for that
#   workflow with a commit (a full SHA must be locked to itself);
# - or it is a full commit SHA in a workflow the lockfile does not list.
# The lockfile never covers a reusable workflow call (a job's `uses`), which therefore needs a full SHA.
require "yaml"

module ActionsLockContract
  LOCK_PATH = ".github/workflows/actions.lock"
  SHA = /\A[0-9a-f]{40}\z/.freeze
  COMMIT = /\Asha1-([0-9a-f]{40})\z/.freeze
  # owner/repo, an optional path inside the repository, and a ref. A container image (`docker://...`) is not one.
  REFERENCE = %r{\A([\w.-]+/[\w.-]+)((?:/[^\s@/]+)*)@([^\s@]+)\z}.freeze

  class Malformed < StandardError; end

  module_function

  # The parsed lockfile, or nil when there is none.
  def parse(source)
    return nil if source.nil?
    documents = Psych.parse_stream(source).children
    raise Malformed, "the lockfile must be one YAML document" unless documents.length == 1
    unambiguous!(documents.first.root)
    lock = YAML.safe_load(source, aliases: false)
    workflows = lock.is_a?(Hash) ? lock["workflows"] : nil
    dependencies = lock.is_a?(Hash) ? lock["dependencies"] : nil
    raise Malformed, "the lockfile needs a workflows mapping and a dependencies mapping" unless workflows.is_a?(Hash) && dependencies.is_a?(Hash)
    raise Malformed, "every workflow in the lockfile lists its references" unless workflows.values.all? { |listed| listed.is_a?(Array) }
    lock
  rescue Psych::Exception => error
    raise Malformed, "the lockfile is not plain YAML: #{error.message}"
  end

  # A repeated key, a merge key, an alias or a tag would let two readers of the same file see different commits.
  def unambiguous!(node)
    # gh actions-lock writes no tags, and a tag can change what a scalar decodes to (`!!binary`).
    raise Malformed, "the lockfile must not use YAML tags" if node.respond_to?(:tag) && node.tag
    case node
    when Psych::Nodes::Mapping
      keys = node.children.each_slice(2).map(&:first)
      raise Malformed, "lockfile keys must be plain strings" unless keys.all? { |key| key.is_a?(Psych::Nodes::Scalar) && key.tag.nil? }
      names = keys.map(&:value)
      raise Malformed, "the lockfile repeats a key" unless names.uniq.length == names.length
      raise Malformed, "the lockfile must not use YAML merge keys" if names.include?("<<")
      node.children.each_slice(2) { |_, value| unambiguous!(value) }
    when Psych::Nodes::Sequence
      node.children.each { |child| unambiguous!(child) }
    when Psych::Nodes::Alias
      raise Malformed, "the lockfile must not use YAML aliases"
    end
  end

  def read(root)
    path = File.join(root, LOCK_PATH)
    File.exist?(path) ? parse(File.read(path)) : nil
  end

  # gh actions-lock writes the owner and repository in lower case; a path inside the repository and
  # the ref are case-sensitive and stay as written.
  def key(uses)
    match = REFERENCE.match(uses.to_s)
    match && "#{match[1].downcase}#{match[2]}@#{match[3]}"
  end

  # The action a reference names, without its ref: lower-case owner/repo and the path as written.
  def action(uses)
    name = key(uses)
    name && name.split("@", 2).first
  end

  def onboarded?(lock, workflow)
    !lock.nil? && lock["workflows"].key?(workflow)
  end

  def not_onboarded(lock, workflows)
    workflows.reject { |workflow| onboarded?(lock, workflow) }
  end

  # The commit `uses` runs in `workflow`, or nil when nothing fixes it.
  def commit(lock, workflow, uses)
    name = key(uses)
    return nil unless name
    ref = name.split("@", 2).last
    return (ref.match?(SHA) ? ref : nil) unless onboarded?(lock, workflow)
    return nil unless lock["workflows"][workflow].include?(name)
    entry = lock["dependencies"][name]
    locked = entry.is_a?(Hash) && entry["commit"].is_a?(String) ? entry["commit"][COMMIT, 1] : nil
    return nil if ref.match?(SHA) && locked != ref
    locked
  end

  # nil when the reference is acceptable, otherwise the reason it is not.
  def problem(lock, workflow, uses, reusable: false)
    return nil if uses.is_a?(String) && uses.start_with?("./")
    name = key(uses)
    return "external uses must be owner/repo@ref: #{uses.inspect}" unless name
    if reusable
      return nil if name.split("@", 2).last.match?(SHA)
      return "a reusable workflow call must pin a full commit SHA (the lockfile does not cover it): #{uses}"
    end
    return nil if commit(lock, workflow, uses)
    return "external uses must have a commit in #{LOCK_PATH} for this workflow (run gh actions-lock): #{uses}" if onboarded?(lock, workflow)
    "external uses must pin a full commit SHA, or the workflow must be in #{LOCK_PATH}: #{uses}"
  end
end
