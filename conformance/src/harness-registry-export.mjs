// The child process of gitExportReader (harness-registry.mjs): imports the module at the URL it is
// given, which lies in an unpacked revision of conformance/src, and prints one export as JSON.
const [url, name] = process.argv.slice(2);
const value = (await import(url))[name];
if (value === undefined) throw new Error(`the module has no export ${name}`);
process.stdout.write(JSON.stringify(value));
