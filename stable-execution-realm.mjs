const REALM_KEY = Symbol.for('InterLayerWorld.E5C3.StableExecutionRealm');
const LOADER_KEY = Symbol.for('InterLayerWorld.E5C2.VerifiedMVULoader');
const FRAME_PREFIX = 'TH-script--InterLayerWorld--';
const REQUIRED_ROOT_SHA256 = '2D2E87C474C6B71D603E5E7FA603DB7364426F2CFAC8757F841A8628B52843FB';

function rawParentOf(callerWindow) {
  try {
    const visibleParent = callerWindow?.parent;
    const rawParent = visibleParent?.document?.defaultView;
    const document = rawParent?.document;
    if (!rawParent || !document || document.defaultView !== rawParent
      || typeof document.createElement !== 'function' || typeof document.documentElement?.appendChild !== 'function'
      || typeof rawParent.addEventListener !== 'function' || typeof rawParent.removeEventListener !== 'function')
      throw new Error('AUTHORITATIVE_PARENT_UNAVAILABLE');
    const protocol = new URL(rawParent.location.href).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error('HOST_ORIGIN_UNAVAILABLE');
    return rawParent;
  } catch (error) {
    if (error?.message === 'AUTHORITATIVE_PARENT_UNAVAILABLE' || error?.message === 'HOST_ORIGIN_UNAVAILABLE') throw error;
    throw new Error('AUTHORITATIVE_PARENT_UNAVAILABLE');
  }
}

function bindResidentGlobals(parent, resident) {
  const helpers = parent.TavernHelper;
  if (!helpers || typeof helpers !== 'object' || !helpers._bind || typeof helpers._bind !== 'object')
    throw new Error('TAVERN_HELPER_BIND_UNAVAILABLE');
  if (typeof parent._ !== 'function' || typeof parent.$ !== 'function')
    throw new Error('PARENT_SCRIPT_GLOBALS_UNAVAILABLE');

  if (!parent.Vue || typeof parent.Vue !== 'object' || typeof parent.Vue.createApp !== 'function')
    throw new Error('PARENT_VUE_UNAVAILABLE');

  resident.Vue = parent.Vue;
  resident._ = parent._;
  resident.$ = resident.jQuery = parent.$;
  for (const name of ['EjsTemplate', 'YAML', 'showdown', 'toastr', 'z']) {
    if (name in parent) resident[name] = parent[name];
  }
  resident.__VUE_PROD_DEVTOOLS__ = true;
  resident.__VUE_OPTIONS_API__ = true;
  resident.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false;

  const localHelper = { ...helpers };
  delete localHelper._bind;
  for (const [key, value] of Object.entries(helpers._bind)) {
    if (typeof value !== 'function' || !key.startsWith('_')) continue;
    localHelper[key.slice(1)] = value.bind(resident);
  }
  resident.TavernHelper = localHelper;

  const writeExtensionField = helpers._th_impl?.writeExtensionField;
  if (typeof writeExtensionField === 'function') {
    resident._th_impl = { ...helpers._th_impl, writeExtensionField };
  }

  Object.defineProperty(resident, 'SillyTavern', {
    configurable: true,
    enumerable: true,
    get() {
      const api = parent.SillyTavern;
      if (!api || typeof api.getContext !== 'function') throw new Error('SILLYTAVERN_CONTEXT_UNAVAILABLE');
      return {
        ...api.getContext(),
        getContext() {
          return { ...api.getContext(), ...(typeof writeExtensionField === 'function' ? { writeExtensionField } : {}) };
        },
      };
    },
  });
  Object.defineProperty(resident, 'Mvu', {
    configurable: true,
    enumerable: true,
    get: () => parent.Mvu,
    set: () => {},
  });

  const events = parent.tavern_events;
  if (events && typeof events === 'object') resident.tavern_events = events;
  for (const [key, value] of Object.entries(localHelper)) {
    if (key.startsWith('_') || key in resident || key === 'constructor') continue;
    try { resident[key] = value; } catch { /* host globals may be non-writable */ }
  }
}

function currentScriptId(callerWindow) {
  try {
    const value = typeof callerWindow.getScriptId === 'function' ? callerWindow.getScriptId() : '';
    if (typeof value === 'string' && value.trim() && !/[<>"'`]/.test(value)) return value.trim().slice(0, 96);
  } catch { /* caller may not expose the TavernHelper script id */ }
  const cached = callerWindow?.__TH_IFRAME_ID ?? callerWindow?.name;
  if (typeof cached === 'string') {
    const match = cached.match(/^TH-script--.+--(.+)$/);
    if (match?.[1]) return match[1].slice(0, 96);
  }
  throw new Error('TAVERN_HELPER_SCRIPT_ID_UNAVAILABLE');
}

function validExisting(parent, entry) {
  try {
    const api = parent.Mvu;
    const registration = parent[Symbol.for('InterLayerWorld.StateSync.NativeOwner.E5C1')];
    const resident = entry?.frame?.contentWindow;
    const loader = resident?.[LOADER_KEY];
    const bootstrap = parent.__ILW_V04G_BOOTSTRAP__;
    const stateSync = parent.__ILW_V04G_STATE_SYNC__;
    const runtimeHealthy = api?.finalMessageStateTransformerAbi === 'mvu.final-message-state/3-atomic-writer'
      && loader?.status === 'loaded' && loader?.identity?.startsWith(`owner-e45.5:${REQUIRED_ROOT_SHA256}:`)
      && loader?.value?.mvu === api && registration?.api === api
      && bootstrap?.healthy?.() === true && stateSync?.healthy?.() === true;
    return runtimeHealthy && entry?.parent === parent && entry.status === 'ready'
      && entry.frame?.isConnected === true && entry.frame.contentWindow?.parent === parent;
  } catch { return false; }
}

/**
 * Return the stable parent-owned execution window used for MVU and State Sync modules.
 * The frame is intentionally independent from the transient caller's pagehide lifecycle.
 */
export async function createStableExecutionRealm({
  callerWindow = globalThis.window,
  timeoutMs = 10000,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('STABLE_REALM_TIMEOUT_INVALID');
  const parent = rawParentOf(callerWindow);
  const existing = parent[REALM_KEY];
  if (validExisting(parent, existing)) return existing.handle;
  if (existing?.status === 'creating' && existing.promise) return existing.promise;
  if (existing) throw new Error('STABLE_REALM_REGISTRY_UNHEALTHY');

  const document = parent.document;
  const frame = document.createElement('iframe');
  const id = `${FRAME_PREFIX}${currentScriptId(callerWindow)}`;
  frame.id = id;
  frame.name = id;
  frame.title = 'InterLayerWorld native runtime';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.cssText = 'display:none!important;width:0;height:0;border:0;visibility:hidden;';
  const entry = { parent, frame, id, status: 'creating', promise: null, handle: null, disposed: false };
  parent[REALM_KEY] = entry;

  entry.promise = Promise.resolve().then(() => {
    // Appending an unsandboxed about:blank frame gives it the parent's same-origin realm.
    // The raw document path intentionally bypasses the transient TH cleanup proxy.
    document.documentElement.appendChild(frame);
    const resident = frame.contentWindow;
    if (!resident || resident.parent !== parent || resident.document.defaultView !== resident) throw new Error('STABLE_REALM_IDENTITY_MISMATCH');
    resident.__TH_IFRAME_ID = id;
    if (!resident.name) resident.name = id;
    bindResidentGlobals(parent, resident);
    const onParentHide = () => handle.destroy();
    const handle = Object.freeze({
      id,
      parent,
      frame,
      window: resident,
      document: resident.document,
      destroy() {
        if (entry.disposed) return;
        entry.disposed = true;
        entry.status = 'destroyed';
        parent.removeEventListener('pagehide', onParentHide);
        try {
          resident.eventClearAll?.();
          resident.dispatchEvent(new resident.Event('pagehide'));
        } catch { /* teardown still removes the frame if host hooks are unavailable */ }
        try { frame.remove(); } catch { /* best effort frame removal */ }
        if (parent[REALM_KEY] === entry) delete parent[REALM_KEY];
      },
    });
    entry.handle = handle;
    entry.status = 'ready';
    parent.addEventListener('pagehide', onParentHide, { once: true });
    return handle;
  }).catch((error) => {
    entry.status = 'failed';
    if (parent[REALM_KEY] === entry) delete parent[REALM_KEY];
    try { frame.remove(); } catch { /* best effort frame removal */ }
    throw error;
  });
  return entry.promise;
}

/** Load a verified module's bytes in the resident frame without interpolating source into HTML. */
export function importModuleBytesInStableRealm(handle, bytes) {
  const resident = handle?.window;
  if (!resident || handle.parent?.[REALM_KEY]?.handle !== handle || !(bytes instanceof Uint8Array))
    return Promise.reject(new Error('STABLE_REALM_MODULE_TARGET_INVALID'));
  return new Promise((resolve, reject) => {
    let url;
    const script = resident.document.createElement('script');
    script.type = 'module';
    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
      try { script.remove(); } catch { /* best effort script cleanup */ }
      if (url) {
        try { resident.URL.revokeObjectURL(url); } catch { /* best effort URL cleanup */ }
      }
    };
    script.onload = () => { cleanup(); resolve(); };
    script.onerror = () => { cleanup(); reject(new Error('STABLE_REALM_MODULE_IMPORT_FAILED')); };
    try {
      url = resident.URL.createObjectURL(new resident.Blob([bytes], { type: 'text/javascript' }));
      script.src = url;
      resident.document.head.appendChild(script);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export { REALM_KEY as STABLE_EXECUTION_REALM_KEY };
