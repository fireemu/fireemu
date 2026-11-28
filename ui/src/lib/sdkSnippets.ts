// The connection snippets the Overview offers: environment variables for the server SDKs
// and code for the Web SDK. Pure text from the runtime configuration.

export type SnippetTarget = {
  project: string;
  firestoreAddr: string;
  httpAddr: string;
  storageAddr: string;
  functionsAddr: string | null;
  hostingAddr?: string | null;
};

export type SnippetKind = "dotenv" | "shell" | "web" | "admin";

/** `KEY=value` lines for a `.env` file. */
export const dotenvSnippet = (target: SnippetTarget): string =>
  [
    `FIRESTORE_EMULATOR_HOST=${target.firestoreAddr}`,
    `FIREBASE_AUTH_EMULATOR_HOST=${target.httpAddr}`,
    `FIREBASE_STORAGE_EMULATOR_HOST=${target.storageAddr}`,
    `STORAGE_EMULATOR_HOST=http://${target.storageAddr}`,
    ...(target.functionsAddr ? [`FIREEMU_FUNCTIONS_HOST=${target.functionsAddr}`] : []),
    ...(target.hostingAddr ? [`FIREEMU_HOSTING_HOST=${target.hostingAddr}`] : []),
    `GOOGLE_CLOUD_PROJECT=${target.project}`,
    `FIREEMU_CONTROL_URL=http://${target.httpAddr}/v1/`,
  ].join("\n");

/** The same variables as `export` lines for a shell. */
export const shellSnippet = (target: SnippetTarget): string =>
  dotenvSnippet(target)
    .split("\n")
    .map((line) => `export ${line}`)
    .join("\n");

/** `host` and `port` of a `host:port` address (an IPv6 host keeps its brackets). */
export const splitAddress = (addr: string): { host: string; port: number } | null => {
  const at = addr.lastIndexOf(":");
  if (at <= 0) return null;
  const port = Number(addr.slice(at + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: addr.slice(0, at), port };
};

// A JSON string literal is a valid JavaScript string literal, so a project or host name
// can never close the quote it is written into.
const literal = (text: string): string => JSON.stringify(text);

const hostPort = (addr: string): string => {
  const parts = splitAddress(addr);
  return parts ? `${literal(parts.host)}, ${parts.port}` : `${literal(addr)}, 0`;
};

/** Web SDK (modular API) code that points every product at this emulator. */
export const webSdkSnippet = (target: SnippetTarget): string =>
  [
    `import { initializeApp } from "firebase/app";`,
    `import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";`,
    `import { getAuth, connectAuthEmulator } from "firebase/auth";`,
    `import { getStorage, connectStorageEmulator } from "firebase/storage";`,
    ...(target.functionsAddr
      ? [`import { getFunctions, connectFunctionsEmulator } from "firebase/functions";`]
      : []),
    ``,
    `const app = initializeApp({ projectId: ${literal(target.project)}, apiKey: "fake-api-key", storageBucket: ${literal(`${target.project}.appspot.com`)} });`,
    `connectFirestoreEmulator(getFirestore(app), ${hostPort(target.firestoreAddr)});`,
    `connectAuthEmulator(getAuth(app), ${literal(`http://${target.httpAddr}`)});`,
    `connectStorageEmulator(getStorage(app), ${hostPort(target.storageAddr)});`,
    ...(target.functionsAddr
      ? [`connectFunctionsEmulator(getFunctions(app), ${hostPort(target.functionsAddr)});`]
      : []),
  ].join("\n");

/** Admin SDK (Node.js) code: the environment set in-process before the app is used. */
export const adminSdkSnippet = (target: SnippetTarget): string =>
  [
    `import { initializeApp } from "firebase-admin/app";`,
    `import { getFirestore } from "firebase-admin/firestore";`,
    ``,
    `process.env.FIRESTORE_EMULATOR_HOST = ${literal(target.firestoreAddr)};`,
    `process.env.FIREBASE_AUTH_EMULATOR_HOST = ${literal(target.httpAddr)};`,
    `process.env.FIREBASE_STORAGE_EMULATOR_HOST = ${literal(target.storageAddr)};`,
    ``,
    `const app = initializeApp({ projectId: ${literal(target.project)} });`,
    `const db = getFirestore(app);`,
  ].join("\n");

export const snippetFor = (kind: SnippetKind, target: SnippetTarget): string => {
  switch (kind) {
    case "dotenv":
      return dotenvSnippet(target);
    case "shell":
      return shellSnippet(target);
    case "web":
      return webSdkSnippet(target);
    default:
      return adminSdkSnippet(target);
  }
};
