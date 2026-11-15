import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function collectTree(root) {
  const canonicalRoot = await realpath(root);
  const manifest = Object.create(null);
  const visit = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        manifest[name] = { type: 'directory' };
        await visit(path, name);
      } else if (entry.isFile()) {
        const info = await lstat(path);
        const contents = await readFile(path);
        manifest[name] = {
          type: 'file',
          size: info.size,
          sha256: createHash('sha256').update(contents).digest('hex'),
        };
      } else {
        throw Error(`copied tree contains an unsupported entry: ${name}`);
      }
    }
  };
  await visit(canonicalRoot);
  return manifest;
}

export async function validateTreeContents(root, expectedManifest, stage) {
  const actual = await collectTree(root);
  const expectedPaths = Object.keys(expectedManifest).sort();
  const actualPaths = Object.keys(actual).sort();
  const expectedSet = new Set(expectedPaths);
  const actualSet = new Set(actualPaths);
  const missing = expectedPaths.filter(path => !actualSet.has(path));
  const extra = actualPaths.filter(path => !expectedSet.has(path));
  if (missing.length || extra.length) {
    throw Error(`${stage} tree path set mismatch: missing=${missing.join(',') || '(none)'}; extra=${extra.join(',') || '(none)'}`);
  }

  let files = 0, directories = 0, bytes = 0;
  const digest = createHash('sha256');
  for (const path of expectedPaths) {
    const expected = expectedManifest[path];
    const observed = actual[path];
    if (observed.type !== expected.type) throw Error(`${stage} tree type mismatch at ${path}`);
    if (expected.type === 'directory') {
      directories++;
    } else {
      files++;
      bytes += observed.size;
      if (observed.size !== expected.size || observed.sha256 !== expected.sha256) {
        throw Error(`${stage} tree content mismatch at ${path}`);
      }
    }
    digest.update(`${path}\0${observed.type}\0${observed.size ?? ''}\0${observed.sha256 ?? ''}\0`);
  }
  return { files, directories, bytes, sha256: digest.digest('hex') };
}

export async function validateConfigOwner(configPath, ownerRoot, stage) {
  const owner = await realpath(ownerRoot);
  const config = await realpath(configPath);
  if (!isWithin(owner, config)) throw Error(`${stage} config path escapes its copy owner`);
  const contents = await readFile(config);
  const parsed = JSON.parse(contents.toString('utf8'));
  const configuredSource = parsed.functions?.source;
  if (typeof configuredSource !== 'string') throw Error(`${stage} config has no Functions source path`);
  const source = await realpath(resolve(dirname(config), configuredSource));
  if (!isWithin(owner, source)) throw Error(`${stage} Functions source escapes its copy owner`);
  return {
    configSha256: createHash('sha256').update(contents).digest('hex'),
    sourcePath: relative(owner, source),
    source,
  };
}
