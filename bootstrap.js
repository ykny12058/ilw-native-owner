// ILW E5C3.1 bootstrap. Integrity-check local assets; the parent host owns teardown.
const HOST_URL = new URL(window.parent.location.href);
if (HOST_URL.protocol !== 'http:' && HOST_URL.protocol !== 'https:') throw new Error('HOST_ORIGIN_UNAVAILABLE');
const ROOT = new URL('/scripts/extensions/third-party/ilw-native-owner/', HOST_URL.origin);
const EXPECTED = Object.freeze({ bridgeBytes: 9352, bridge:'23D3A2BD979D1ED6EF93C68277628A7BFE669BDADFF9BBDD8628183BED1D7E5E', loader:'11617E569D1D988523C67E43D88839D0C88E7394C87D92B67DA8971AA700F411', manifest:'A999FDE17A914F55D5F500A762A3C754E5ACEE104CDF438250DE21ED5F6971D1', stateSync:'D352F8FD601E7F4E99958BFDDA2DBC6A0BD2D35373067A61EF2629AE5E3C893C', abi:'mvu.final-message-state/3-atomic-writer', patch:'owner-e45.5' });
const readBytes = async url => { const response = await fetch(url, { cache:'no-store' }); if (!response.ok) throw new Error('ASSET_FETCH_FAILED'); return new Uint8Array(await response.arrayBuffer()); };
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
const importBytes = async bytes => { const url = URL.createObjectURL(new Blob([bytes], { type:'text/javascript' })); try { return await import(url); } finally { URL.revokeObjectURL(url); } };
const waitForNativeRegistration = (async function waitForNativeRegistration(readRegistration, mvu, {
  timeoutMs = 31000,
  pollIntervalMs = 100,
  now = () => Date.now(),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof readRegistration !== 'function' || !mvu || !Number.isFinite(timeoutMs) || timeoutMs < 0
    || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) return false;
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    if (readRegistration()?.api === mvu) return true;
    await delay(pollIntervalMs);
  }
  return false;
});
const parent = window.parent ?? window;
const STATE_KEY = Symbol.for('InterLayerWorld.E5C2.ReadOnlyDiagnostics');
const state = parent[STATE_KEY] ?? (parent[STATE_KEY] = { events:[], mvu:null, phase:'bootstrap' });
const add = (code, detail='') => { state.events.push({code,detail:String(detail).slice(0,160),at:Date.now()}); if(state.events.length>16) state.events.shift(); };
const safeReceipts = () => { try { const entries=state.mvu?.getFinalMessageStateReceipts?.(); if(!Array.isArray(entries)) return []; return entries.slice(-8).map(x=>({operationId:Number.isFinite(Number(x?.operationId))?Number(x.operationId):null,stage:String(x?.stage??'').slice(0,48)})); } catch { return []; } };
const safeHost = () => { try { const entries=parent.__ILW_V04G_STATE_SYNC__?.diagnostics; if(!Array.isArray(entries)) return []; return entries.slice(-8).map(x=>({code:String(x?.code??'').slice(0,48),timestamp:Number.isFinite(Number(x?.timestamp))?Number(x.timestamp):null})); } catch { return []; } };
const snapshot = () => { const reg=parent[Symbol.for('InterLayerWorld.StateSync.NativeOwner.E5C1')]; let revision=null; try { revision=parent[Symbol.for('InterLayerWorld.ManagedRevisionObserver.E5B')]?.snapshot?.() ?? null; } catch {} return { events:state.events.map(x=>({...x})), phase:state.phase, loader:state.loaderIdentity ?? null, abiPresent:state.mvu?.finalMessageStateTransformerAbi===EXPECTED.abi, nativeTransformerRegistered:reg?.api===state.mvu, ownerKinds:['narrative','replay'], extraEnabled:false, managedRevision:revision?{revision:revision.revision,active:revision.active}:null, oldBridge:state.cleanRealm===true?'excluded-from-candidate-bundle':state.cleanRealm===false?'preexisting-runtime-detected':'unknown', nativeHost:safeHost(), receipts:safeReceipts() }; };
if (!Object.prototype.hasOwnProperty.call(parent,'__ILW_E5C2_DIAGNOSTICS__')) Object.defineProperty(parent,'__ILW_E5C2_DIAGNOSTICS__',{configurable:true,enumerable:false,get:snapshot});
try {
  if (parent.__ILW_V04G_BOOTSTRAP__ || parent.__ILW_V04G_STATE_SYNC__) { state.cleanRealm=false; throw new Error('CLEAN_RELOAD_REQUIRED'); }
  state.cleanRealm=true;
  const [bridgeBytes, loaderBytes, manifestBytes] = await Promise.all([readBytes(new URL('stable-execution-realm.mjs', ROOT)), readBytes(new URL('verified-mvu-loader.mjs', ROOT)), readBytes(new URL('verified-loader-manifest.json', ROOT))]);
  if (bridgeBytes.byteLength !== EXPECTED.bridgeBytes || await digest(bridgeBytes) !== EXPECTED.bridge) throw new Error('STABLE_REALM_BRIDGE_HASH_MISMATCH');
  if (await digest(loaderBytes) !== EXPECTED.loader) throw new Error('LOADER_HASH_MISMATCH');
  if (await digest(manifestBytes) !== EXPECTED.manifest) throw new Error('MANIFEST_HASH_MISMATCH');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const { createVerifiedMvuLoader } = await importBytes(loaderBytes);
  const loader = createVerifiedMvuLoader({ manifest, readAsset: async entry => readBytes(new URL('mvu/' + entry.path, ROOT)), getMvu:() => parent.Mvu, realm:window, waitForAbiMs:31000, pollIntervalMs:100 });
  const lifecycleKey = Symbol.for('InterLayerWorld.E5C3.1.LoaderLifecycle');
  let loaderClosed = false;
  const onHostUnload = () => loaderLifecycle.destroy();
  const loaderLifecycle = { destroy(reason = 'explicit') { if (loaderClosed) return; loaderClosed = true; parent.removeEventListener('pagehide', onHostUnload); try { loader.destroy(); } finally { try { parent[Symbol.for('InterLayerWorld.E5C3.StableExecutionRealm')]?.handle?.destroy(reason); } finally { if (parent[lifecycleKey] === loaderLifecycle) delete parent[lifecycleKey]; } } } };
  parent[lifecycleKey] = loaderLifecycle;
  parent.addEventListener('pagehide', onHostUnload, { once:true });
  const loaded = await loader.load();
  const expectedIdentity = manifest.identity.patch + ':' + manifest.identity.sha256 + ':' + manifest.manifestVersion;
  if (loaded.identity !== expectedIdentity || manifest.identity.abi !== EXPECTED.abi || manifest.identity.patch !== EXPECTED.patch || manifest.identity.sha256 !== '2D2E87C474C6B71D603E5E7FA603DB7364426F2CFAC8757F841A8628B52843FB') throw new Error('PATCHED_MVU_IDENTITY_MISMATCH');
  const mvu = loaded.mvu;
  if (mvu?.finalMessageStateTransformerAbi !== EXPECTED.abi || typeof mvu?.registerFinalMessageStateTransformer !== 'function') throw new Error('PATCHED_MVU_ABI_NOT_READY');
  state.mvu = mvu; state.loaderIdentity = {patch:EXPECTED.patch,sha256:manifest.identity.sha256,abi:EXPECTED.abi,manifestVersion:manifest.manifestVersion,reused:loaded.reused===true};
  if (loaded.reused === true) add('VERIFIED_MVU_REUSED', 'exact verified root identity');
  state.phase = 'mvu-ready'; add('PATCHED_MVU_READY', manifest.identity.sha256);
  const stateSyncBytes = await readBytes(new URL('ilw-v04g-state-sync.js', ROOT));
  if (await digest(stateSyncBytes) !== EXPECTED.stateSync) throw new Error('STATE_SYNC_HASH_MISMATCH');
  await importBytes(stateSyncBytes);
  state.phase = 'state-sync-imported'; add('STATE_SYNC_IMPORTED', EXPECTED.stateSync);
  add('WAITING_FOR_NATIVE_REGISTRATION','bounded by E5C1 startup retry window');
  const registered = await waitForNativeRegistration(() => parent[Symbol.for('InterLayerWorld.StateSync.NativeOwner.E5C1')], mvu, { timeoutMs:31000, pollIntervalMs:100 });
  if (!registered || parent.__ILW_V04G_STATE_SYNC__?.healthy?.() !== true) { state.phase='failed-closed'; add('NATIVE_REGISTRATION_UNAVAILABLE','no healthy native owner; no legacy fallback'); throw new Error('NATIVE_REGISTRATION_UNAVAILABLE'); }
  add('NATIVE_TRANSFORMER_REGISTERED');
  add('STARTUP_REGISTERED');
  state.phase = 'ready-for-read-only-check';
} catch (error) { state.phase = 'failed-closed'; add('PRELIVE_STARTUP_FAILED', error?.message ?? error); console.error('[ILW E5C2] startup halted', error?.message ?? error); }
