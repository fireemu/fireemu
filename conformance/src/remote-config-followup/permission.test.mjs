import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyPermission, observePermission } from "./permission.mjs";

const permission = {
  status: 403,
  json: {
    error: {
      status: "PERMISSION_DENIED",
      details: [
        { reason: "IAM_PERMISSION_DENIED", metadata: { permission: "cloudconfig.configs.get" } },
      ],
    },
  },
};

test("permission denial is distinct from customer project denial and unauthenticated", () => {
  assert.equal(classifyPermission(permission), "remote-config-permission-denied");
  assert.equal(
    classifyPermission({
      status: 403,
      json: {
        error: { status: "PERMISSION_DENIED", details: [{ reason: "USER_PROJECT_DENIED" }] },
      },
    }),
    "quota-project-denied",
  );
  assert.equal(
    classifyPermission({
      status: 403,
      json: {
        error: {
          status: "PERMISSION_DENIED",
          details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
        },
      },
    }),
    "oauth-scope-denied",
  );
  assert.equal(
    classifyPermission({ status: 401, json: { error: { status: "UNAUTHENTICATED" } } }),
    "unauthenticated",
  );
  assert.equal(classifyPermission({ status: 200, json: {} }), "allowed");
});

test("both namespaces receive control, alternate role, and readback in order", async () => {
  const calls = [];
  const result = await observePermission(async (caseId, principal, namespace) => {
    calls.push([caseId, principal, namespace]);
    return principal === "alternate"
      ? permission
      : {
          status: 200,
          etag: "tag-if-valid",
          json: { version: { versionNumber: namespace === "client" ? "4" : "7" } },
        };
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.probes, {
    client: "remote-config-permission-denied",
    server: "remote-config-permission-denied",
  });
  assert.deepEqual(calls, [
    ["a-client", "owner", "client"],
    ["a-server", "owner", "server"],
    ["p-client", "alternate", "client"],
    ["p-server", "alternate", "server"],
    ["g-client", "owner", "client"],
    ["g-server", "owner", "server"],
  ]);
});

test("every generated combination distinguishes authorization outcomes", (t) => {
  if (!process.env.FIREEMU_RC_PERMISSION_TABLE)
    return t.skip("PICT table is supplied by the follow-up verification");
  const rows = readFileSync(process.env.FIREEMU_RC_PERMISSION_TABLE, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1);
  for (const row of rows) {
    const [code, status, reason] = row.split("\t");
    const detail = {
      quota: { reason: "USER_PROJECT_DENIED" },
      scope: { reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" },
      cloudconfig: { metadata: { permission: "cloudconfig.configs.get" } },
      distinct: {},
    }[reason];
    const namedReason = {
      quota: "quota-project-denied",
      scope: "oauth-scope-denied",
      cloudconfig: "remote-config-permission-denied",
      distinct: "generic-permission-denied",
    }[reason];
    const observed = classifyPermission({
      status: Number(code),
      json: { error: { status, details: [detail] } },
    });
    const expected =
      code === "200"
        ? "allowed"
        : code === "401" && status === "UNAUTHENTICATED"
          ? "unauthenticated"
          : code === "403" && status === "PERMISSION_DENIED"
            ? namedReason
            : "unexpected";
    assert.equal(observed, expected, row);
  }
});
