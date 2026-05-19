
<p align="center">
  <img src="logo-circle.png" alt="JellyMusicUploader" width="160" height="160">
</p>

<h1 align="center">JellyMusicUploader</h1>

A Jellyfin plugin that adds an **Add Music** button to the web UI. Drag one
or more `Artist/Album/song` folders into the modal, optionally pick a cover
image per album, and the plugin writes the files into your music library
folder and triggers a library scan.

**Finally you can now add music to your music library from anywhere, without having to go through Jellyfin's back end!** 

Built for admin convenience on a home server — no SSH, no scp, no manual
import dance. 
Just drag a folder into the browser.
Keep in mind the upload format : Artist folder > Album name folder > Song tracks
You get to pick the thumbnail for the albums in the process as well (optional), this way you get a clean metadata experience!




##
<div align="center">
  
  <b>This took me some time for testing and debugging and ironing the quirks, but we made it! if you enjoyed the project, please feel free to buy me a coffee! </b>
  
  </div>

  
 <div align="center">
  <a href="https://buymeacoffee.com/drgit_stone" target="_blank">
    <img src=".github/BuyMeACoffee.png" alt="jellyfin-music-uploader" width="180"/>
  </a>
</div>

---

## Features

- Works with **Jellyfin Media Player** and **Jellyfin Web UI**
- Drag-and-drop folder upload from the Jellyfin web UI
- Multiple Artist folders in one drop
- Folder structure validated and previewed before any upload (artist /
  album / track count / total size)
- Per-album **cover-art picker** — set an image once and it becomes the
  album art for the album and every track inside it (via Jellyfin's
  standard `cover.<ext>` convention)
- **Auto-tagging from folder structure** — after each audio file lands,
  the plugin writes `Artist`, `AlbumArtist`, `Album`, and (if missing)
  `Title` tags derived from the folder path. Fixes the common case of
  uploading files with empty or wrong ID3 tags, which Jellyfin's
  tag-driven music scanner would otherwise show as "Unknown Artist"
- Per-file progress, atomic writes (`.part` sidecar → rename)
- Auto-triggers Jellyfin's library scan when the batch finishes
- Admin-only — the floating button is invisible to non-admins and the
  upload endpoint rejects non-admin tokens
- Path-traversal hardened, extension allowlist, per-file size cap
- One small DLL — no extra runtime deps to ship with it

<img width="1412" height="1010" alt="Screenshot 2026-05-19 at 12 48 55 PM" src="https://github.com/user-attachments/assets/dfc5de2c-38b1-4e05-9ef5-52180cbb12f6" />

<img width="767" height="393" alt="Screenshot 2026-05-19 at 12 49 40 PM" src="https://github.com/user-attachments/assets/7bd67c4f-8fa9-486e-9593-7cafd4b12fa7" />


## Requirements

- **Jellyfin 10.11.x** (built and tested against 10.11.2)
- A music library configured in Jellyfin pointing at a directory that
  is writable by the Jellyfin process
- If building from source: **.NET 9 SDK**

## Installation

### The installations can often not go as smoothly as planned, if you want a fail-proof way of installing it, just point Claude-Code or Codex to this page and ask it to install the plugin in your Jellyfin instance (letting them know where this is, if this is in a rapsberry pi, or locally etc, and granting them access to the location and specifics (for instance with a raspberry pi you can provide it with the ssh credentials if needed for installation and as an example let it know that it is installed within Docker or within Portainer and it will install the plugin successfully) -- i have found my experience to be much smoother this way, but to each their own! You can also follow the manual steps below. Cheers!

### 1. Get the plugin DLL

**Option A — download a release** (once one exists)

If this repo has tagged releases, download `JellyMusicUploader.zip`
from the [Releases](../../releases) page and unzip it. Inside you'll
find `JellyMusicUploader.dll`, `TagLibSharp.dll`, and `meta.json`.

> If the Releases page is empty, the maintainer hasn't pushed a `v*`
> tag yet — use Option B instead.

**Option B — build from source**

```sh
git clone https://github.com/<you>/jellyfin-music-uploader.git
cd jellyfin-music-uploader
dotnet build -c Release
```

Outputs in `bin/Release/net9.0/`:
- `JellyMusicUploader.dll` — the plugin
- `TagLibSharp.dll` — required runtime dep for tag normalization

Package both files plus `meta.json` into a single zip if you want to
hand it to someone:

```sh
( cd bin/Release/net9.0 && \
  zip -j ../../../JellyMusicUploader.zip \
    JellyMusicUploader.dll TagLibSharp.dll ../../../meta.json )
```

### 2. Drop the plugin into Jellyfin's plugins folder

The folder layout Jellyfin expects is `<PluginName>_<Version>/`. Create
the directory and place `JellyMusicUploader.dll` + `meta.json` inside.

**Native install** (Debian/Ubuntu)

```sh
sudo mkdir -p /var/lib/jellyfin/plugins/JellyMusicUploader_0.1.0.0
sudo cp JellyMusicUploader.dll TagLibSharp.dll meta.json \
  /var/lib/jellyfin/plugins/JellyMusicUploader_0.1.0.0/
sudo chown -R jellyfin:jellyfin /var/lib/jellyfin/plugins/JellyMusicUploader_0.1.0.0
sudo systemctl restart jellyfin
```

**Docker (`linuxserver/jellyfin` and similar)**

The plugins folder lives at `<config-volume>/data/plugins/`. Find your
host-side mount with `docker inspect <jellyfin-container>` and look at
the `/config` bind source. Then:

```sh
HOST_CONFIG=/path/to/jellyfin/config        # the bind source for /config
mkdir -p "$HOST_CONFIG/data/plugins/JellyMusicUploader_0.1.0.0"
cp JellyMusicUploader.dll TagLibSharp.dll meta.json \
  "$HOST_CONFIG/data/plugins/JellyMusicUploader_0.1.0.0/"
docker restart jellyfin
```

### 3. Configure the plugin

Open **Dashboard → Plugins → Music Uploader** and set:

| Field | What to put |
| --- | --- |
| **Library Path** | The absolute server-side path of your music library. For Docker this is the path **inside the container** (e.g. `/data/music`), not the host path. Must already exist and be writable by Jellyfin. |
| **Max File Size (MB)** | Per-file cap. `0` disables. Default `200`. |
| **Allowed Extensions** | Comma-separated, lowercase, no leading dot. Default covers most lossy + lossless audio and cover-art image formats. |
| **Trigger library scan after each batch** | Keep on unless something else watches the folder. |
| **Allow overwriting** | If off, re-uploading the same path returns HTTP 409. |

Click **Save**.

### 4. Wire the JS into the Jellyfin web client

This is the only fiddly step. The plugin ships a JS file served at
`/musicup/frontend/js/uploader.js`, but Jellyfin needs to load it.
There are two paths depending on what your install allows:

#### 4a. The clean way: Custom CSS field (works on some installs)

Open **Dashboard → General → Branding → Custom CSS** and paste:

```html
<script src="/musicup/frontend/js/uploader.js" defer></script>
```

Save. Hard-refresh the browser (Cmd-Shift-R / Ctrl-Shift-R).

> ⚠️ Some recent Jellyfin builds (including `linuxserver/jellyfin:latest`
> at 10.11.2) **do not actually inject `<script>` tags from the Custom
> CSS field**. The field is preserved in the API response but the
> rendered `index.html` ignores it. If the button doesn't appear after
> a hard refresh, use method 4b instead.

#### 4b. The reliable way: edit `index.html` directly

The plugin's JS just needs a single `<script>` tag in the served
`index.html`. Patch the file in place:

**Native install**

```sh
sudo sed -i.bak-musicup 's#</body>#<script src="/musicup/frontend/js/uploader.js" defer></script></body>#' /usr/share/jellyfin/web/index.html
```

**Docker**

```sh
docker exec jellyfin sh -c \
  'cp /usr/share/jellyfin/web/index.html /usr/share/jellyfin/web/index.html.bak-musicup && \
   sed -i "s#</body>#<script src=\"/musicup/frontend/js/uploader.js\" defer></script></body>#" \
   /usr/share/jellyfin/web/index.html'
```

No restart needed — the file is read on each page request. Just
**hard-refresh** the browser.

> 🔄 **Caveat:** `/usr/share/jellyfin/web/index.html` is part of the
> Jellyfin binary install (native) or the container image (Docker).
> Upgrading Jellyfin (or recreating the container with a fresh image)
> wipes this edit. Re-run the `sed` command after upgrades. There's a
> backup at `index.html.bak-musicup` if you ever need to revert.

## Usage

1. Sign in to Jellyfin as an admin user.
2. The **+ Add Music** button appears in the bottom-right corner.
3. Click it. The modal opens.
4. From your file manager, drag one or more **Artist folders** into the
   drop zone. The expected folder shape is `Artist/Album/song.flac`.
   You can drop several Artist folders at once.
5. The modal previews what it found — one row per Artist/Album combo
   with the track count and total size.
6. *(Optional)* Click **Upload Thumbnail** on the right of any row to
   set a cover image for that album. A 26×26 px thumbnail preview
   appears next to a small × to clear it.
7. Click **Upload**. Files stream up one at a time with a progress bar.
8. When the batch finishes, the plugin auto-triggers Jellyfin's library
   scan. New tracks (and any covers you set) appear in the library
   within ~1 minute.

### Folder structure rules

| You drop                              | Where it lands                                |
| ------------------------------------- | --------------------------------------------- |
| `Artist/Album/song.flac`              | `<LibraryPath>/Artist/Album/song.flac`        |
| `Artist/song.flac` (no album folder)  | `<LibraryPath>/Artist/Unknown Album/song.flac` |
| `Artist/Album/Disc 1/song.flac`       | `<LibraryPath>/Artist/Album/Disc 1/song.flac` (preserved verbatim) |
| Cover image picked for an album       | `<LibraryPath>/Artist/Album/cover.<ext>`      |

Cover files use Jellyfin's standard `cover.*` convention — the album
art is also auto-applied to every track in that folder, no per-file
tag embedding required.

## How tagging works

### The problem

Jellyfin's music library is **tag-driven**, not folder-driven. When it
scans a music folder, it reads the ID3 (MP3) / Vorbis (FLAC, OGG) /
MP4 atom (M4A) tags out of each file and uses those for Artist,
AlbumArtist, Album, and Title. It does **not** infer artist or album
from the folder structure the way it infers from filenames for movies
and TV.

This matters because dropped files frequently come from sources that
don't ship with clean tags:

- ZIP downloads from sites that strip metadata
- Files ripped from CDs without a database lookup
- Soulseek / torrent grabs that were tagged by the uploader's setup
  (or never tagged at all)
- Hand-mixed tracks from a DAW exported without metadata

In all those cases, the file's `artist` / `album_artist` / `album`
frames are empty or wrong. The folder structure on disk says
"TheBand / Ideas and Creations", but Jellyfin reads the
file, sees no tags, and shows **Unknown Artist / Unknown Album** in
the library UI.

You can verify this on any file with `ffprobe`:

```sh
ffprobe -v error -show_entries format_tags=artist,album_artist,album,title \
  -of default=noprint_wrappers=1 "/path/to/file.mp3"
```

If that prints nothing, the file has no tags — Jellyfin will see
nothing too.

### What the plugin does

When **`NormalizeTagsFromFolder`** is on (the default), the plugin
opens every audio file it just wrote with TagLibSharp and sets:

| Tag         | Source                                                     | Behavior          |
| ----------- | ---------------------------------------------------------- | ----------------- |
| Artist      | The top-level folder you dropped (`parts[0]`)              | **Overwritten**   |
| AlbumArtist | Same as Artist                                             | **Overwritten**   |
| Album       | The second-level folder, or `"Unknown Album"` if missing   | **Overwritten**   |
| Title       | The filename with leading track numbers stripped           | Filled if empty   |

So a file dropped at `TheBand/Ideas and Creations/01 You Keep Me Loving You mix # 1.mp3`
ends up with:

```
Artist       = TheBand
AlbumArtist  = TheBand
Album        = Ideas and Creations
Title        = You Keep Me Loving You mix # 1     (only if previously blank)
```

The leading `01 ` gets stripped. Other patterns it handles:
`01-`, `01.`, `01_`, `1-02 ` (track + disc), and any combination
(e.g. `001 - `, `1-01. `). Trailing extension is removed.

### Why "overwrite Artist/Album but only fill Title"

The folder structure is **definitive** for the artist and album —
you typed those folder names yourself when you organized the drop,
so whatever was previously in the file's tag is almost certainly
wrong or stale.

The filename, on the other hand, is sometimes a useful track title
(`In your hands.mp3`) and sometimes garbage (`track01.mp3`). If the
file already has a `Title` tag, we trust it — the album-specific
title from the source is more reliable than guessing from a
filename. If it's empty, we use the derived filename rather than
leave it blank.

### When to turn it off

Disable `NormalizeTagsFromFolder` on the plugin config page if:

- You're uploading files that came from a properly-tagged source
  (Bandcamp release, Discogs-tagged rip, Beatport download) and
  don't want anything overwritten.
- You curate tags by hand in MP3Tag / Picard / Mp3tag and the file
  on disk is already correct.

With it off, the plugin behaves like a pure file-mover and Jellyfin
reads whatever tags were embedded by the source.

## Configuration reference

| Key | Default | Meaning |
| --- | --- | --- |
| `LibraryPath` | *empty* | Absolute server-side path. **Required.** |
| `MaxFileSizeMb` | `200` | Per-file cap in megabytes. `0` disables. |
| `AllowedExtensions` | `mp3,flac,m4a,aac,ogg,opus,wav,wma,alac,aiff,jpg,jpeg,png,webp` | Comma-separated, lowercase, no dot. |
| `RefreshLibraryOnComplete` | `true` | Trigger Jellyfin's `RefreshLibrary` scheduled task after each batch. |
| `AllowOverwrite` | `false` | If false, a second upload of the same relative path returns HTTP 409. |
| `NormalizeTagsFromFolder` | `true` | After writing each audio file, overwrite Artist / AlbumArtist / Album tags from the folder structure (`Artist/Album/song.ext`) and Title from the filename (leading track numbers stripped). Title is only set if currently empty. Disable if your files are correctly tagged and you don't want them touched. |

## HTTP API

The plugin exposes these endpoints, all under `/musicup`.

| Method | Path                          | Auth                | Description                                              |
| ------ | ----------------------------- | ------------------- | -------------------------------------------------------- |
| GET    | `/musicup/frontend/{**path}`  | anonymous           | Serves the embedded JS used by the web client.           |
| GET    | `/musicup/config`             | authenticated user  | Read-only config snapshot — what the UI needs to validate. |
| POST   | `/musicup/upload`             | admin (`RequiresElevation`) | Multipart form: `file` + `relativePath`.                 |
| POST   | `/musicup/refresh`            | admin (`RequiresElevation`) | Kicks Jellyfin's `RefreshLibrary` scheduled task.        |

Example direct upload via `curl`:

```sh
curl -X POST \
  -H "X-Emby-Token: <admin-api-key>" \
  -F "file=@/tmp/song.flac" \
  -F "relativePath=Radiohead/OK Computer/01 Airbag.flac" \
  https://your-jellyfin.example.com/musicup/upload
```

## Security model

- Upload and refresh require the `RequiresElevation` policy (admin user
  or API key with admin scope).
- Relative paths are sanitized: no `..`, no absolute paths, no drive
  letters, no null bytes, no reserved filename characters, no empty
  segments. After resolution, the destination is verified to live
  under `LibraryPath` via `Path.GetFullPath` prefix comparison —
  attempts to escape the root are rejected with HTTP 400.
- Files write to a `<target>.part` sidecar and are renamed atomically
  on success. A dropped connection mid-upload leaves a `.part` file
  behind, never a half-written `.flac`.
- The static `frontend` route only resolves embedded resources under
  the `JellyMusicUploader.Frontend.` namespace — arbitrary assemblies
  can't be enumerated.

## Known limitations

- **Global library scan, not music-only.** The refresh hook executes
  Jellyfin's `RefreshLibrary` task, which scans every library. On a
  large library this can take a few minutes; new tracks usually show
  up well before the scan fully completes, but the "running task"
  indicator stays up for the whole sweep.
- **Custom CSS injection is unreliable.** See install step 4 — recent
  Jellyfin builds don't inject `<script>` tags from the Custom CSS
  field. The `index.html` patch in 4b is the workaround.
- **Per-track artwork is folder-based.** The cover-image picker writes
  `cover.<ext>` to the album folder, which Jellyfin picks up as the
  album cover and inherits to every track. The plugin does **not**
  embed artwork into the audio file's tags — if you re-export the file
  elsewhere, the art won't travel with it.
- **Tag normalization overwrites Artist / Album.** Disable the
  `NormalizeTagsFromFolder` flag if you don't want this — see the
  [How tagging works](#how-tagging-works) section for the full
  policy.
- **No resume on partial failure.** If a file fails mid-batch, the
  remaining files still upload, but the failed one isn't auto-retried.

## Building from source

```sh
git clone https://github.com/<you>/jellyfin-music-uploader.git
cd jellyfin-music-uploader
dotnet build -c Release
```

Output: `bin/Release/net9.0/JellyMusicUploader.dll`.

Package as a single zip for distribution:

```sh
cd bin/Release/net9.0
zip ../../../JellyMusicUploader.zip JellyMusicUploader.dll
cd ../../..
zip JellyMusicUploader.zip meta.json
```

Or push a `v*` tag to GitHub and the bundled
[release workflow](.github/workflows/build.yml) will build a zip and
attach it to a Release automatically.

## Project layout

```
.
├── Plugin.cs                          # plugin entry, GUID, page registration
├── Configuration/
│   ├── PluginConfiguration.cs         # config schema (library path, limits, toggles)
│   └── configPage.html                # dashboard settings page (embedded)
├── Controllers/
│   └── UploadController.cs            # /musicup/* HTTP endpoints
├── Frontend/
│   └── js/
│       └── uploader.js                # FAB + modal + drag-drop + cover picker
├── JellyMusicUploader.csproj          # net9.0, Jellyfin 10.11 refs, dep-strip target
├── meta.json                          # plugin manifest read by Jellyfin
├── build.yaml                         # optional jprm packaging metadata
└── .github/workflows/build.yml        # CI build + release-on-tag
```

## Uninstall

1. Stop Jellyfin.
2. Delete the `JellyMusicUploader_0.1.0.0` directory from your plugins
   folder.
3. Remove the `<script src="/musicup/frontend/js/uploader.js" defer></script>`
   line from `/usr/share/jellyfin/web/index.html`, or restore the
   `index.html.bak-musicup` backup left by the installer.
4. (Optional) remove `JellyMusicUploader.xml` under
   `<config>/data/plugins/configurations/` to clear stored settings.
5. Start Jellyfin.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

Issues and pull requests welcome. Easy ways to help:

- Better error messages in the modal when uploads fail
- Per-track artwork embedding (TagLibSharp is the usual choice)
- Scoped library scan (music library only, not the whole server)
- Resume / retry on transient failures
- A real screenshot for the README
