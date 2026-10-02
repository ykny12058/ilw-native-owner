/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/perfect-debounce@1.0.0/dist/index.mjs
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
const p={trailing:!0};function g(o,i=25,e={}){if(e={...p,...e},!Number.isFinite(i))throw new TypeError("Expected `wait` to be a finite number");let a,r,c=[],t,l;const s=(n,u)=>(t=y(o,n,u),t.finally(()=>{if(t=null,e.trailing&&l&&!r){const f=s(n,l);return l=null,f}}),t);return function(...n){return t?(e.trailing&&(l=n),t):new Promise(u=>{const f=!r&&e.leading;clearTimeout(r),r=setTimeout(()=>{r=null;const m=e.leading?a:s(this,n);for(const d of c)d(m);c=[]},i),f?(a=s(this,n),u(a)):c.push(u)})}}async function y(o,i,e){return await o.apply(i,e)}export{g as debounce};
//# sourceMappingURL=/sm/14a093e070b6381943edcea7dfd92ed87dc8b3a1bdf8d4bb5d23052956a2759d.map