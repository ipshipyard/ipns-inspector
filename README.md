# IPNS Inspector

Inspect and create IPNS records from the browser.

## How it works

- IPNS names are resolved using [`@helia/http`](https://github.com/ipfs/helia/tree/main/packages/http), which resolves IPNS records over HTTP using delegated routing, by default using the `https://delegated-ipfs.dev/` endpoint.
- IPNS records are created locally using [`@helia/ipns`](https://github.com/ipfs/helia/tree/main/packages/ipns) and published over HTTP using a delegated routing endpoint, by default using the `https://delegated-ipfs.dev/` endpoint.
- All data is in memory, so it will be lost when the page is refreshed.

## Tech Stack

- Next.js with static export and pages router
- [Helia](https://github.com/ipfs/helia) library to interact with the IPFS network.
- [Multiformats](https://github.com/multiformats/js-multiformats) library to work with CIDs and IPNS names.
- Tailwind CSS.
- shadcn/ui components
- [xstate](https://github.com/statelyai/xstate) to manage the UI logic for the IPNS inspector

## How to run local

```bash
npm run dev
```

## How to build and export

```bash
npm run build
```
