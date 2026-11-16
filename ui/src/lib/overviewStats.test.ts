import { expect, test } from "vitest";
import { overviewStats } from "./overviewStats";
import type { Gauge, ResourceReport, ServiceResources } from "./resources";

const g = (id: string, current: number): Gauge => ({
  id,
  measure: "logical",
  unit: "count",
  current,
  limit: null,
  reclaimable: 0,
});
const service = (
  name: string,
  gauges: Gauge[],
  roots: ServiceResources["roots"] = { total: 0, truncated: false, items: [] },
): ServiceResources => ({ service: name, gauges, refusals: [], roots });
const report = (services: ServiceResources[]): ResourceReport => ({
  schemaVersion: 1,
  session: "default",
  project: "demo-app",
  complete: true,
  rootBudget: 100,
  services,
  errors: [],
});
const root = (kind: string, id: string) => ({ kind, id, count: 1, bytes: 1, outstanding: false });

test("each figure reads its own gauge of its own service", () => {
  const stats = overviewStats(
    report([
      service("firestore", [g("history.live_document_bytes", 876), g("users.count", 99)], {
        total: 3,
        truncated: false,
        items: [root("database", "p/(default)"), root("database", "p/other"), root("read", "x")],
      }),
      service("auth", [g("users.count", 4), g("objects.count", 98)]),
      service("storage", [g("objects.count", 7), g("objects.bytes", 2048), g("topics", 97)]),
      service("pubsub", [g("topics", 2)]),
      service("functions", [g("invocations.running", 1)]),
    ]),
  );
  expect(stats).toEqual({
    firestoreDatabases: 2,
    firestoreLiveBytes: 876,
    authUsers: 4,
    storageObjects: 7,
    storageBytes: 2048,
    pubsubTopics: 2,
    functionsRunning: 1,
  });
});

test("a missing service or gauge is unknown, and a real zero stays zero", () => {
  expect(overviewStats(report([]))).toEqual({
    firestoreDatabases: null,
    firestoreLiveBytes: null,
    authUsers: null,
    storageObjects: null,
    storageBytes: null,
    pubsubTopics: null,
    functionsRunning: null,
  });
  const zero = overviewStats(
    report([service("auth", [g("users.count", 0)]), service("firestore", [])]),
  );
  expect(zero.authUsers).toBe(0);
  expect(zero.firestoreDatabases).toBe(0);
  expect(zero.firestoreLiveBytes).toBeNull();
});

test("a truncated root list is not presented as a database count", () => {
  const stats = overviewStats(
    report([
      service("firestore", [], {
        total: 500,
        truncated: true,
        items: [root("database", "p/(default)")],
      }),
    ]),
  );
  expect(stats.firestoreDatabases).toBeNull();
});
