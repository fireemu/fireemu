import { expect, test } from "vitest";
import {
  adminSdkSnippet,
  dotenvSnippet,
  shellSnippet,
  snippetFor,
  splitAddress,
  webSdkSnippet,
  type SnippetTarget,
} from "./sdkSnippets";

const TARGET: SnippetTarget = {
  project: "demo-app",
  firestoreAddr: "127.0.0.1:8080",
  httpAddr: "127.0.0.1:9099",
  storageAddr: "127.0.0.1:9199",
  functionsAddr: "127.0.0.1:5001",
};
const NO_FUNCTIONS: SnippetTarget = { ...TARGET, functionsAddr: null };

test("the .env snippet lists the hosts, the project and the control URL in a fixed order", () => {
  expect(dotenvSnippet(TARGET)).toBe(
    [
      "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080",
      "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099",
      "FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199",
      "STORAGE_EMULATOR_HOST=http://127.0.0.1:9199",
      "FIREEMU_FUNCTIONS_HOST=127.0.0.1:5001",
      "GOOGLE_CLOUD_PROJECT=demo-app",
      "FIREEMU_CONTROL_URL=http://127.0.0.1:9099/v1/",
    ].join("\n"),
  );
});

test("without a Functions listener no snippet mentions Functions", () => {
  expect(dotenvSnippet(NO_FUNCTIONS)).not.toContain("FUNCTIONS");
  expect(dotenvSnippet(NO_FUNCTIONS).split("\n")).toHaveLength(6);
  expect(webSdkSnippet(NO_FUNCTIONS)).not.toMatch(/functions/i);
  expect(webSdkSnippet(TARGET)).toContain(
    'connectFunctionsEmulator(getFunctions(app), "127.0.0.1", 5001);',
  );
  expect(webSdkSnippet(TARGET)).toContain(
    'import { getFunctions, connectFunctionsEmulator } from "firebase/functions";',
  );
});

test("the shell snippet is the .env snippet with export on every line", () => {
  const lines = shellSnippet(TARGET).split("\n");
  expect(lines).toEqual(
    dotenvSnippet(TARGET)
      .split("\n")
      .map((line) => `export ${line}`),
  );
});

test("the Web SDK snippet splits host and port and uses a URL for Auth", () => {
  const text = webSdkSnippet(TARGET);
  expect(text).toContain(
    'initializeApp({ projectId: "demo-app", apiKey: "fake-api-key", storageBucket: "demo-app.appspot.com" })',
  );
  expect(text).toContain('connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);');
  expect(text).toContain('connectAuthEmulator(getAuth(app), "http://127.0.0.1:9099");');
  expect(text).toContain('connectStorageEmulator(getStorage(app), "127.0.0.1", 9199);');
});

test("dotenvSnippet includes FIREEMU_HOSTING_HOST when hostingAddr is set", () => {
  expect(dotenvSnippet({ ...TARGET, hostingAddr: "127.0.0.1:5000" })).toContain(
    "FIREEMU_HOSTING_HOST=127.0.0.1:5000",
  );
  expect(dotenvSnippet(TARGET)).not.toContain("FIREEMU_HOSTING_HOST");
});

test("the Web and Admin snippets are exactly these programs", () => {
  expect(webSdkSnippet(TARGET)).toBe(
    [
      'import { initializeApp } from "firebase/app";',
      'import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";',
      'import { getAuth, connectAuthEmulator } from "firebase/auth";',
      'import { getStorage, connectStorageEmulator } from "firebase/storage";',
      'import { getFunctions, connectFunctionsEmulator } from "firebase/functions";',
      "",
      'const app = initializeApp({ projectId: "demo-app", apiKey: "fake-api-key", storageBucket: "demo-app.appspot.com" });',
      'connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);',
      'connectAuthEmulator(getAuth(app), "http://127.0.0.1:9099");',
      'connectStorageEmulator(getStorage(app), "127.0.0.1", 9199);',
      'connectFunctionsEmulator(getFunctions(app), "127.0.0.1", 5001);',
    ].join("\n"),
  );
  expect(webSdkSnippet(NO_FUNCTIONS).split("\n")).toHaveLength(9);
  expect(adminSdkSnippet(TARGET)).toBe(
    [
      'import { initializeApp } from "firebase-admin/app";',
      'import { getFirestore } from "firebase-admin/firestore";',
      "",
      'process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";',
      'process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";',
      'process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";',
      "",
      'const app = initializeApp({ projectId: "demo-app" });',
      "const db = getFirestore(app);",
    ].join("\n"),
  );
});

test("the Admin SDK snippet sets the three hosts before creating the app", () => {
  const text = adminSdkSnippet(TARGET);
  expect(text).toContain('process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";');
  expect(text).toContain('process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";');
  expect(text).toContain('process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";');
  expect(text).toContain('initializeApp({ projectId: "demo-app" })');
  expect(text.indexOf("process.env.FIRESTORE_EMULATOR_HOST")).toBeLessThan(
    text.indexOf("initializeApp({"),
  );
});

test("a project name cannot close the string literal it is written into", () => {
  const hostile = { ...TARGET, project: 'x" }); alert(1); ({ a: "\n</script>\\' };
  for (const text of [webSdkSnippet(hostile), adminSdkSnippet(hostile)]) {
    const line = text.split("\n").find((l) => l.includes("initializeApp({"))!;
    const start = line.indexOf("projectId: ") + "projectId: ".length;
    // The literal parses back to exactly the project name and the statement goes on after it.
    const end = line.lastIndexOf(line.includes("apiKey") ? ", apiKey" : " });");
    expect(JSON.parse(line.slice(start, end))).toBe(hostile.project);
    expect(text.split("\n").filter((l) => l.includes("alert(1)"))).toHaveLength(1);
  }
});

test("addresses split at the last colon; a malformed one is refused", () => {
  expect(splitAddress("127.0.0.1:8080")).toEqual({ host: "127.0.0.1", port: 8080 });
  expect(splitAddress("[::1]:9099")).toEqual({ host: "[::1]", port: 9099 });
  expect(splitAddress("localhost:1")).toEqual({ host: "localhost", port: 1 });
  expect(splitAddress("localhost:65535")).toEqual({ host: "localhost", port: 65535 });
  for (const bad of [
    "",
    "localhost",
    ":8080",
    "localhost:",
    "localhost:0",
    "h:65536",
    "h:1.5",
    "h:x",
  ]) {
    expect(splitAddress(bad)).toBeNull();
  }
  // An unparsable address is shown as it is rather than dropped.
  expect(webSdkSnippet({ ...TARGET, firestoreAddr: "weird" })).toContain(
    'connectFirestoreEmulator(getFirestore(app), "weird", 0);',
  );
});

test("snippetFor selects by kind", () => {
  expect(snippetFor("dotenv", TARGET)).toBe(dotenvSnippet(TARGET));
  expect(snippetFor("shell", TARGET)).toBe(shellSnippet(TARGET));
  expect(snippetFor("web", TARGET)).toBe(webSdkSnippet(TARGET));
  expect(snippetFor("admin", TARGET)).toBe(adminSdkSnippet(TARGET));
});
