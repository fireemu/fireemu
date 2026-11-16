// The at-a-glance figures of the Overview, read from the session resource report. A figure
// the report does not carry is `null` ("unknown"), never zero.
import type { ResourceReport } from "./resources";

export type OverviewStats = {
  firestoreDatabases: number | null;
  firestoreLiveBytes: number | null;
  authUsers: number | null;
  storageObjects: number | null;
  storageBytes: number | null;
  pubsubTopics: number | null;
  functionsRunning: number | null;
};

const gauge = (report: ResourceReport, service: string, id: string): number | null =>
  report.services.find((s) => s.service === service)?.gauges.find((g) => g.id === id)?.current ??
  null;

export const overviewStats = (report: ResourceReport): OverviewStats => {
  const firestore = report.services.find((s) => s.service === "firestore");
  return {
    // The root list may be cut at the report's budget; a truncated list is not a count.
    firestoreDatabases:
      firestore && !firestore.roots.truncated
        ? firestore.roots.items.filter((root) => root.kind === "database").length
        : null,
    firestoreLiveBytes: gauge(report, "firestore", "history.live_document_bytes"),
    authUsers: gauge(report, "auth", "users.count"),
    storageObjects: gauge(report, "storage", "objects.count"),
    storageBytes: gauge(report, "storage", "objects.bytes"),
    pubsubTopics: gauge(report, "pubsub", "topics"),
    functionsRunning: gauge(report, "functions", "invocations.running"),
  };
};
