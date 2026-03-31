# Shared Client

This directory contains the shared React client used by:

- the browser app served by the self-hosted instance
- the Tauri desktop shell in [`../desktop`](../desktop)

## Development

```bash
yarn install
yarn start
```

## Production Build

```bash
yarn build
```

The web client no longer needs a build-time backend URL. It resolves `/api` and assets at runtime from the connected instance.

