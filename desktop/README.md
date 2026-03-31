# Singra Vox Desktop

Dieses Verzeichnis enthält nur die Tauri-Hülle. Die eigentliche App-Oberfläche bleibt im gemeinsamen React-Client unter `../frontend`.

## Entwicklung

```bash
cd desktop
yarn install
./run-tauri-dev.sh
```

## Build

```bash
cd desktop
yarn install
yarn tauri:build
```

