# InterLayerWorld Runtime

Runtime extension for **InterLayerWorld** on SillyTavern.

Current stable release: **v0.4.0**

## Installation

1. Open SillyTavern.
2. Go to **Extensions**.
3. Choose **Install Extension**.
4. Enter:

   https://github.com/ykny12058/ilw-native-owner

5. Wait until **InterLayerWorld Runtime** appears in the installed extensions list.
6. Import the InterLayerWorld character card PNG.

The runtime only needs to be installed once. Future InterLayerWorld card updates normally only require importing the newer card PNG.

## Requirements

- SillyTavern
- InterLayerWorld character card
- InterLayerWorld Runtime enabled

## Important

Do not rename the installed repository/folder.

InterLayerWorld currently loads runtime resources from:

`/scripts/extensions/third-party/ilw-native-owner/`

## v0.4.0

The v0.4.0 runtime has passed a clean-install release smoke test covering:

- installation directly from GitHub
- runtime HTTP loading
- runtime SHA-256 integrity verification
- fresh character-card import
- automatic Opening initialization
- authoritative GameState write
- HUD state rendering
- dynamic Worldbook activation
- runtime health checks

Runtime tag:

`v0.4.0`

Accepted runtime commit:

`3817c39c9d9854cda76108d75c81fac88206e3ec`

## License

Licensing information for the runtime and bundled/upstream components is still being reviewed.

Do not assume that the entire repository is released under a single permissive license until that review is complete.