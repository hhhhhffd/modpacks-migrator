# Modpack Migrator

Move a ZIP of Minecraft mods to another Minecraft version and loader. Review every match, choose alternatives, and download verified JARs with a JSON report.

**Two independent ways to use the same Rust engine:**

- **Browser:** a static React interface and a WebAssembly library. ZIP processing happens in a dedicated worker on your device. Requests go directly to Modrinth and CurseForge; there is no application server or proxy.
- **Linux HTTP API:** a standalone executable that processes archives on its host. The browser application does not depend on this server.

Licensed under **AGPL-3.0-only**. See [LICENSE](LICENSE).

## Run the website at localhost:3000

Prerequisites: Rust 1.88+, the `wasm32-unknown-unknown` target, Node.js 22+, npm, and `wasm-bindgen-cli` **0.2.126**.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.126 --locked
cp .env.example .env
# Set your own CURSEFORGE_API_KEY in .env. Do not overwrite an existing .env.
npm --prefix web ci
npm --prefix web run build:wasm
npm --prefix web run dev
```

Open **http://localhost:3000**. Select a ZIP, enter a target Minecraft version, choose a loader, and analyze. Search/filter the matches, choose versions or replace projects, then click **Build modpack**. **Remove** excludes an entry; **Undo** restores its previous version choice. A project still required by another mod can appear as a separate **Required dependency** row. Remove that dependency row to also block its mandatory dependents. Edits stay in the current review instead of restarting the archive scan.

Browser analysis uses a bounded 32 MiB in-memory provider snapshot, including provider errors, so selection edits can recalculate dependencies without repeating the same API calls. It is discarded on a new analysis or worker shutdown. Run **Analyze pack** again to refresh provider data or retry an unavailable provider; entries evicted by the size bound may require another request. JAR downloads are not cached by this snapshot. The independent Linux API is unchanged.

The interface links to [hhhhhffd/modpacks-migrator](https://github.com/hhhhhffd/modpacks-migrator) and its author [hhhhhffd](https://github.com/hhhhhffd). Bricolage Grotesque, Manrope, and IBM Plex Mono are self-hosted; their SIL Open Font License notices are included in `web/public/fonts/`.

To build without CurseForge, use `npm --prefix web run build:wasm:no-default` instead. Modrinth remains available. Do not run this command over a generated CF-enabled package unless you intend to disable that provider.

The browser needs WebAssembly, dedicated workers, Fetch, FileReaderSync, and the Origin Private File System (OPFS) for temporary artifacts. Use a current browser on localhost or HTTPS. Unsupported or exhausted browser storage produces an explicit error. No uploaded source archive is sent to an application server. Hashes/fingerprints and network requests are sent to the selected providers.

### Browser network limitations

A build-time key does not override CORS. If a provider API or CDN does not permit a readable cross-origin response, that operation cannot work in the standalone browser library. Errors are displayed; no proxy or CORS bypass is used. A generic browser network error does not by itself establish whether CORS, connectivity, TLS, or a provider restriction caused it.

Requests do not follow redirects automatically, so credentials cannot leak to redirect destinations. An unsupported redirect is reported as a failed operation. Linux downloads use a separately validated redirect flow.

## Build the static website

```sh
npm --prefix web run build:wasm
npm --prefix web run build
```

Serve `web/dist/` at the root of a static HTTP(S) origin. It contains the application and generated WASM bindings. No backend is required. Development uses port 3000 with strict port checking.

The manual GitHub artifact workflow builds Linux x86_64/aarch64 executables and browser archives **without CurseForge or embedded credentials**. Use the local build commands for CF-enabled artifacts; publishing an extractable key requires a separate, deliberate distribution decision. The workflows are provided as automation, not evidence that those builds have already run on GitHub.

## Build and run the independent Linux API

```sh
cargo build --release -p modpacks-migrator-server
./target/release/modpacks-migrator-server
```

For a build without a key/provider:

```sh
cargo build --release -p modpacks-migrator-server --no-default-features
```

The default bind is `127.0.0.1:8080`. Runtime configuration:

| Variable | Default | Meaning |
|---|---|---|
| `MODPACKS_MIGRATOR_BIND` | `127.0.0.1:8080` | Listen address |
| `MODPACKS_MIGRATOR_MAX_UPLOAD_MIB` | `256` | Maximum uploaded ZIP size |

The API has **no authentication, accounts, or database**. An external bind exposes it to that network; deploy it only in an environment appropriate for an unauthenticated processing API. Jobs are process-local, expire after 30 idle minutes, and disappear on restart. At most four jobs are retained and two operations execute concurrently. Busy/expired/invalid requests return explicit errors. Use polling for progress.

### HTTP workflow

```sh
curl http://localhost:8080/health

curl -F 'archive=@mods.zip' http://localhost:8080/api/v1/analyze
# Returns 202 {"jobId":"..."}; poll the job until state is "analyzed".

curl http://localhost:8080/api/v1/jobs/JOB_ID

curl -H 'Content-Type: application/json' \
  -d '{"jobId":"JOB_ID","target":{"minecraftVersion":"1.21.5","loader":"fabric"},"includeDependencies":true}' \
  http://localhost:8080/api/v1/resolve

curl http://localhost:8080/api/v1/jobs/JOB_ID/preview

curl -H 'Content-Type: application/json' -d '{"revision":1}' \
  http://localhost:8080/api/v1/jobs/JOB_ID/convert

curl http://localhost:8080/api/v1/jobs/JOB_ID/report
curl -o migrated-modpack.zip http://localhost:8080/api/v1/jobs/JOB_ID/download
curl -X POST http://localhost:8080/api/v1/jobs/JOB_ID/cancel
```

For an unattended conversion, `POST /api/v1/convert` accepts multipart `archive` and an `options` JSON field containing the resolve request, returning a job ID. Poll until `completed`, `partial`, `empty`, `failed`, or `cancelled`; downloads are available after packaging.

Resolve options include `providers`, `includeDependencies`, `allowedChannels` (default: release, beta, alpha), and `selections`. A selection contains `inputId` and either `exclude: true` or explicit `provider`, `projectId`, and optional `versionId`. Each successful resolve advances the preview revision. A stale conversion revision returns `409`.

Search: `GET /api/v1/search?provider=modrinth&query=sodium`. Candidates: `GET /api/v1/candidates?provider=modrinth&projectId=PROJECT_ID&minecraftVersion=1.21.5&loader=fabric`.

## Build-time CurseForge key

`CURSEFORGE_API_KEY` is embedded in **both** artifacts during compilation. The build environment takes precedence over the workspace `.env`; default CF-enabled builds fail clearly if the key is missing. `.env` is ignored by Git. Credential values are treated literally, including the `$` characters in bcrypt-style keys. Single-quoted values are also supported. Never expose it through a `VITE_*` variable.

The generated native/WASM binary necessarily contains an extractable key. This project does not claim that embedding keeps it secret. API headers and keys are not included in migration reports. Respect the provider's usage and distribution restrictions; a key does not override an author's download permissions.

## Migration rules

- Read JAR entries in raw ZIP archives, including nested directories. Non-JAR entries, including configs, are not migrated. `.mrpack` and manifest imports are not supported.
- Identify original bytes using SHA-512/SHA-1 on Modrinth, then verified CurseForge fingerprints as fallback. A weak fingerprint or a similar filename is not enough to identify a project.
- Select only files explicitly compatible with the target Minecraft and loader according to provider APIs. Fabric, Quilt, Forge, and NeoForge are separate families.
- Propose the newest compatible publication across **release, beta, and alpha**, with visible release-channel labels. Older files can be selected when appropriate.
- Add required API-declared dependencies by default. Do not add optional or embedded dependencies as separate mods. Exact dependency versions remain constraints; unresolved dependencies/conflicts exclude affected files and their mandatory dependents.
- Manual project replacements are explicit. They are not automatically considered equivalent to the original project for dependency satisfaction.
- Stage and verify downloaded files before ZIP construction. Failed dependency downloads also exclude dependent files. Downloads are currently sequential, with bounded response sizes; no download-parallelism setting is exposed.
- Produce `mods/` and `migration-report.json`. Never mix old incompatible JARs into the migrated directory. Partial and empty results are explicitly distinguished from success.

This selects published builds; it does **not** rewrite mods, launch Minecraft, classify client/server mods, or guarantee that the entire pack runs. Deterministic decisions require the same provider responses; live provider catalogs can change.

Limits: 256 MiB input, 128 MiB per uncompressed entry, 512 MiB total uncompressed data, 10,000 entries, and 16 path components by default. Unsafe paths, symlinks, encryption, unsupported compression, duplicate names, ZIP64, and multidisk archives are rejected.

### Current limitations

Downloads are sequential. A failed download excludes that file and its mandatory dependents; automatic fallback to another provider after a download failure is not implemented. The browser `convertZip()` method requires an earlier analysis and resolution rather than accepting an archive in a one-step call. Reports contain provider file hashes, but do not yet copy the original input hashes or all resolve options into top-level provenance; the analysis response retains the original input hashes.

## Browser SDK

The typed worker facade is available in `web/src/migrator.ts`:

```ts
import { Migrator } from './migrator';
const migrator = new Migrator();
migrator.onprogress = event => console.log(event.stage, event.completed, event.total);
await migrator.analyzeZip(file);
const preview = await migrator.resolveMods({
  target: { minecraftVersion: '1.21.5', loader: 'fabric' },
  providers: ['modrinth', 'curseforge'],
  includeDependencies: true,
  allowedChannels: ['release', 'beta', 'alpha'],
  selections: [],
});
// Review preview before confirming.
const { archive, report } = await migrator.convertZip();
// archive is a Blob; save it using an object URL.
await migrator.dispose();
```

`searchProjects`, `listCandidates`, `cancel`, and `dispose` are also available. Cancellation terminates the worker; analyze again to continue. Generated WASM bindings live in `web/public/pkg/` after a build. The production build also creates `web/dist/sdk/migrator.js`, TypeScript declarations, and its worker asset. Keep the `sdk/` assets together and serve the accompanying `pkg/` directory at the origin root. A separately published npm SDK is not required to run this website.

## Checks

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo check -p modpacks-migrator-wasm --target wasm32-unknown-unknown
npm --prefix web run build
npm --prefix web run test:e2e
```

Default builds use the local/CI key; secret-free builds use `--no-default-features` and the no-default WASM build script. Automated provider tests use synthetic responses, not a live credential. Browser E2E covers real WASM/worker/OPFS with controlled provider responses. Live network checks are separate and must not be confused with mocked coverage.

For a local archive smoke test against a running site:

```sh
node scripts/browser-smoke.mjs /path/to/mods.zip 1.21.5
```

This requires Chromium at `/usr/sbin/chromium` (or set `CHROMIUM_PATH`) with browser sandbox support. Evidence and downloaded results go into ignored `.tmp/`. Real user archives are never committed or included in CI fixtures.
