const REGISTRY_KEY = Symbol.for('InterLayerWorld.E5C2.VerifiedMVULoader');
const REQUIRED_ABI = 'mvu.final-message-state/3-atomic-writer';

const isObject = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');
const isBytes = (value) => value instanceof Uint8Array || value instanceof ArrayBuffer;
const toBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);
const identityOf = (manifest) => `${manifest.identity.patch}:${manifest.identity.sha256}:${manifest.manifestVersion}`;

function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'ilw.verified-mvu-loader/1' || manifest.manifestVersion !== 'e5c2.1')
    throw new Error('LOADER_MANIFEST_VERSION_INVALID');
  if (!manifest.identity || manifest.identity.patch !== 'owner-e45.5'
    || manifest.identity.abi !== 'mvu.final-message-state/3-atomic-writer' || manifest.identity.bytes !== 665064
    || manifest.identity.sha256 !== '2D2E87C474C6B71D603E5E7FA603DB7364426F2CFAC8757F841A8628B52843FB')
    throw new Error('LOADER_ROOT_IDENTITY_INVALID');
  if (!Array.isArray(manifest.modules) || manifest.modules.length !== manifest.moduleCount
    || manifest.moduleCount !== 85 || !Array.isArray(manifest.dependencyFirstOrder)
    || manifest.dependencyFirstOrder.length !== manifest.modules.length)
    throw new Error('LOADER_DEPENDENCY_MANIFEST_INCOMPLETE');
  if (!Array.isArray(manifest.identity.imports)) throw new Error('LOADER_ROOT_REWRITE_MANIFEST_MISSING');
  if (manifest.audit?.deploymentReady !== true || manifest.audit?.directImportCount !== 54
    || manifest.audit?.moduleCount !== 85 || manifest.audit?.unresolved?.length !== 0
    || manifest.audit?.reviewedDynamicImports?.length !== 1)
    throw new Error('LOADER_DEPENDENCY_CLOSURE_UNVERIFIED');

  const ids = new Set();
  const paths = new Set();
  for (const module of manifest.modules) {
    if (!module || typeof module.id !== 'string' || typeof module.path !== 'string'
      || !Number.isSafeInteger(module.bytes) || module.bytes <= 0
      || !/^[A-F0-9]{64}$/.test(module.sha256) || !Array.isArray(module.imports))
      throw new Error('LOADER_DEPENDENCY_MANIFEST_INVALID');
    if (ids.has(module.id) || paths.has(module.path)) throw new Error('LOADER_DUPLICATE_DEPENDENCY');
    ids.add(module.id); paths.add(module.path);
  }
  const seen = new Set();
  for (const index of manifest.dependencyFirstOrder) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.modules.length || seen.has(index))
      throw new Error('LOADER_DEPENDENCY_ORDER_INVALID');
    seen.add(index);
  }
  const rank = new Map(manifest.dependencyFirstOrder.map((index, position) => [index, position]));
  let rewriteCount = 0;
  const checkImports = (imports, importerIndex) => {
    let lastEnd = -1;
    for (const entry of imports) {
      if (!entry || !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end)
        || entry.start < 0 || entry.end < entry.start || typeof entry.specifier !== 'string'
        || !Number.isSafeInteger(entry.dependency) || entry.dependency < 0
        || entry.dependency >= manifest.modules.length || entry.start < lastEnd)
        throw new Error('LOADER_REWRITE_MANIFEST_INVALID');
      if (importerIndex !== null && rank.get(entry.dependency) >= rank.get(importerIndex))
        throw new Error('LOADER_DEPENDENCY_ORDER_INVALID');
      lastEnd = entry.end;
      rewriteCount++;
    }
  };
  checkImports(manifest.identity.imports, null);
  for (let i = 0; i < manifest.modules.length; i++) checkImports(manifest.modules[i].imports, i);
  if (manifest.audit?.staticRewriteCount !== rewriteCount
    || manifest.audit?.directImportCount !== manifest.identity.imports.length
    || manifest.audit?.moduleCount !== manifest.modules.length)
    throw new Error('LOADER_REWRITE_COUNT_MISMATCH');
}

async function sha256(bytes, cryptoObject) {
  if (!cryptoObject?.subtle?.digest) throw new Error('LOADER_CRYPTO_UNAVAILABLE');
  const digest = await cryptoObject.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function resolveMvu(getMvu, realm) {
  try { return getMvu ? getMvu() : realm.Mvu; } catch { return undefined; }
}

function assertCompatible(mvu, code) {
  if (!isObject(mvu) || mvu.finalMessageStateTransformerAbi !== REQUIRED_ABI
    || typeof mvu.registerFinalMessageStateTransformer !== 'function') throw new Error(code);
  if (mvu.patchId !== undefined && mvu.patchId !== 'owner-e45.5') throw new Error('PREEXISTING_MVU_PATCH_MISMATCH');
}

/**
 * Verified, dependency-closed MVU loader. `readAsset(entry)` must return local/embedded bytes.
 * No URL from dependency metadata is fetched at runtime.
 */
export function createVerifiedMvuLoader({
  manifest,
  readAsset,
  getMvu,
  realm = globalThis,
  cryptoObject = globalThis.crypto,
  BlobCtor = globalThis.Blob,
  URLApi = globalThis.URL,
  importModule = (url) => import(url),
  waitForAbiMs = 31000,
  pollIntervalMs = 100,
  now = () => Date.now(),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  validateManifest(manifest);
  if (typeof readAsset !== 'function') throw new Error('LOADER_LOCAL_ASSET_READER_REQUIRED');
  if (typeof importModule !== 'function' || typeof BlobCtor !== 'function'
    || typeof URLApi?.createObjectURL !== 'function' || typeof URLApi?.revokeObjectURL !== 'function')
    throw new Error('LOADER_BLOB_MODULES_UNAVAILABLE');
  if (!Number.isFinite(waitForAbiMs) || waitForAbiMs < 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1)
    throw new Error('LOADER_WAIT_BOUNDS_INVALID');

  const identity = identityOf(manifest);
  let destroyed = false;
  let localPromise = null;
  let phase = 'idle';
  let lastError = null;
  let reused = false;
  const createdUrls = new Set();
  const revokeAll = () => {
    for (const objectUrl of createdUrls) {
      try { URLApi.revokeObjectURL(objectUrl); } catch { /* best-effort resource release */ }
    }
    createdUrls.clear();
  };

  const load = () => {
    if (destroyed) return Promise.reject(new Error('LOADER_DESTROYED'));
    const existing = resolveMvu(getMvu, realm);
    let registry = realm[REGISTRY_KEY];
    if (registry?.status === 'poisoned') return Promise.reject(new Error('SAME_REALM_CLEAN_RELOAD_REQUIRED'));
    if (existing !== undefined && existing !== null) {
      if (registry?.identity === identity && registry.status === 'loaded' && registry.value?.mvu === existing) {
        reused = true;
        phase = 'loaded';
        return Promise.resolve(Object.freeze({ ...registry.value, reused: true }));
      }
    if (registry?.identity === identity && registry.status === 'loading' && registry.promise)
      return registry.promise;
      try {
        assertCompatible(existing, 'PREEXISTING_MVU_INCOMPATIBLE');
      } catch (error) {
        phase = 'failed'; lastError = error?.message ?? 'PREEXISTING_MVU_INCOMPATIBLE';
        return Promise.reject(error);
      }
      // ABI alone cannot attest the verified root bytes; only this loader's identity record permits reuse.
      phase = 'failed'; lastError = 'PREEXISTING_MVU_IDENTITY_UNVERIFIED';
      return Promise.reject(new Error('PREEXISTING_MVU_IDENTITY_UNVERIFIED'));
    }

    if (registry?.identity === identity && registry.promise) return registry.promise;
    if (registry?.status === 'loading') return Promise.reject(new Error('DUPLICATE_MVU_INITIALIZATION_BLOCKED'));
    if (registry?.status === 'poisoned') return Promise.reject(new Error('SAME_REALM_CLEAN_RELOAD_REQUIRED'));
    registry = { identity, status: 'loading', promise: null };
    realm[REGISTRY_KEY] = registry;
    phase = 'verifying'; lastError = null;

    let evaluationStarted = false;
    localPromise = (async () => {
      try {
        const assets = [{
          id: 'root', path: manifest.identity.path, bytes: manifest.identity.bytes,
          sha256: manifest.identity.sha256, imports: manifest.identity.imports,
        }, ...manifest.modules];
        const verified = new Map();
        // Fetch every byte first. Nothing can execute unless the complete local closure verifies.
        await Promise.all(assets.map(async (asset) => {
          const raw = await readAsset(asset);
          if (!isBytes(raw)) throw new Error(`LOADER_ASSET_MISSING:${asset.id}`);
          const bytes = toBytes(raw);
          if (bytes.byteLength !== asset.bytes) throw new Error(`LOADER_BYTE_COUNT_MISMATCH:${asset.id}`);
          const digest = await sha256(bytes, cryptoObject);
          if (digest !== asset.sha256) throw new Error(`LOADER_HASH_MISMATCH:${asset.id}`);
          let source;
          try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch { throw new Error(`LOADER_UTF8_INVALID:${asset.id}`); }
          verified.set(asset.id, { asset, source });
        }));
        phase = 'verified';

        const objectUrls = new Map();
        const buildUrl = (asset, index) => {
          const { source } = verified.get(asset.id);
          const imports = asset.imports;
          let actual = source;
          for (const entry of imports) {
            if (entry.end > source.length || source.slice(entry.start, entry.end) !== entry.specifier)
              throw new Error(`LOADER_REWRITE_COUNT_MISMATCH:${asset.id}`);
            const dependency = manifest.modules[entry.dependency];
            const dependencyUrl = objectUrls.get(dependency.id);
            if (!dependencyUrl) throw new Error(`LOADER_DEPENDENCY_NOT_BUILT:${asset.id}:${dependency.id}`);
          }
          // Replacing from right to left preserves the compiler-derived UTF-16 source offsets.
          for (const entry of [...imports].reverse()) {
            const dependency = manifest.modules[entry.dependency];
            const dependencyUrl = objectUrls.get(dependency.id);
            actual = actual.slice(0, entry.start) + dependencyUrl + actual.slice(entry.end);
          }
          const url = URLApi.createObjectURL(new BlobCtor([actual], { type: 'text/javascript' }));
          createdUrls.add(url);
          if (index !== null) objectUrls.set(asset.id, url);
          return url;
        };

        for (const index of manifest.dependencyFirstOrder) buildUrl(manifest.modules[index], index);
        const rootUrl = buildUrl(verified.get('root').asset, null);
        if (destroyed) throw new Error('LOADER_DESTROYED_DURING_STARTUP');
        phase = 'evaluating';
        evaluationStarted = true;
        const result = await importModule(rootUrl);

        phase = 'waiting-for-abi';
        const deadline = now() + waitForAbiMs;
        let mvu;
        while (!destroyed && now() <= deadline) {
          mvu = resolveMvu(getMvu, realm);
          if (mvu !== undefined && mvu !== null) {
            if (mvu.finalMessageStateTransformerAbi !== undefined
              && mvu.finalMessageStateTransformerAbi !== REQUIRED_ABI)
              throw new Error('LOADED_MVU_ABI_MISMATCH');
            if (mvu.finalMessageStateTransformerAbi === REQUIRED_ABI
              && typeof mvu.registerFinalMessageStateTransformer !== 'function')
              throw new Error('LOADED_MVU_CAPABILITY_MISSING');
            if (mvu.finalMessageStateTransformerAbi !== REQUIRED_ABI) {
              await delay(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
              continue;
            }
            assertCompatible(mvu, 'LOADED_MVU_ABI_MISMATCH');
            const loaded = Object.freeze({ mvu, identity, reused: false, module: result });
            registry.status = 'loaded';
            registry.value = loaded;
            phase = 'loaded';
            // Successful module imports remain in the realm module map. URLs can be released after evaluation.
            revokeAll();
            return loaded;
          }
          await delay(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
        }
        if (destroyed) throw new Error('LOADER_DESTROYED_DURING_STARTUP');
        throw new Error('LOADED_MVU_ABI_TIMEOUT');
      } catch (error) {
        revokeAll();
        phase = 'failed';
        lastError = typeof error?.message === 'string' ? error.message.slice(0, 96) : 'LOADER_FAILURE';
        if (realm[REGISTRY_KEY] === registry) {
          if (evaluationStarted) {
            registry.status = 'poisoned';
            registry.promise = null;
          } else delete realm[REGISTRY_KEY];
        }
        throw error;
      }
    })();
    registry.promise = localPromise;
    return localPromise;
  };

  return Object.freeze({
    identity,
    load,
    status() {
      return Object.freeze({
        phase,
        rootSha256: manifest.identity.sha256,
        patch: manifest.identity.patch,
        abi: manifest.identity.abi,
        dependencyModules: manifest.modules.length,
        staticRewriteCount: manifest.audit.staticRewriteCount,
        reused,
        lastError,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revokeAll();
      if (localPromise) {
        const registry = realm[REGISTRY_KEY];
        // Preserve successful module identity; an MVU cannot be safely unloaded in-place.
        if (registry?.identity === identity && registry.status !== 'loaded') {
          if (phase === 'evaluating' || phase === 'waiting-for-abi') {
            registry.status = 'poisoned';
            registry.promise = null;
          } else delete realm[REGISTRY_KEY];
        }
      }
    },
  });
}

export { REQUIRED_ABI };
