# Three.js (vendored)

- **Version:** 0.187.0 (pinned)
- **Source:** <https://www.npmjs.com/package/three/v/0.187.0>
- **License:** MIT — see [`LICENSE`](./LICENSE)

Files are the unmodified official npm build files, except for the two addon
files, whose bare `three` import specifier was changed to the local relative
path so the browser can resolve it without an import map:

| File | Origin |
| --- | --- |
| `three.module.js` | `build/three.module.js` |
| `three.core.js` | `build/three.core.js` |
| `OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` (`from 'three'` → `from './three.module.js'`) |
| `RoundedBoxGeometry.js` | `examples/jsm/geometries/RoundedBoxGeometry.js` (`from 'three'` → `from './three.module.js'`) |

`three.module.js` imports `./three.core.js`, so both files must be kept
together. The addons are loaded lazily by `activity.js` at the same time as the
core module.
