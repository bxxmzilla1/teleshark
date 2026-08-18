# MultiGram Desktop (C++ / Qt)

A native C++ desktop app for Windows built with the Qt framework. It hosts
your deployed MultiGram web app in an embedded Chromium view (Qt WebEngine),
so every feature — accounts, vault, voice notes, drag-and-drop sending —
works exactly like in the browser, but as a real desktop program with its own
window, icon and taskbar entry. Login and the local vault persist between
launches.

## Prerequisites (one-time setup)

Qt WebEngine on Windows **requires the MSVC build of Qt** (MinGW is not
supported).

1. **Visual Studio 2022 Build Tools** (the C++ compiler):

   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

2. **Qt 6 (MSVC 64-bit) with WebEngine**, using the Qt Online Installer from
   <https://www.qt.io/download-qt-installer> (free account). In the installer
   select, under the latest Qt 6.x:
   - `MSVC 2022 64-bit`
   - `Qt WebEngine` (under *Additional Libraries*)
   - Under *Build Tools*: `CMake` and `Ninja`

   Default install location is `C:\Qt`.

## Build

Open **"x64 Native Tools Command Prompt for VS 2022"** (installed by step 1),
go to the repository folder and run (adjust `6.7.3` to the Qt version you
installed):

```bat
set PATH=C:\Qt\Tools\CMake_64\bin;C:\Qt\Tools\Ninja;%PATH%
cmake -S desktop -B desktop\build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=C:\Qt\6.7.3\msvc2022_64
cmake --build desktop\build
```

The executable is `desktop\build\MultiGram.exe`.

## Run

On first launch the app asks for your MultiGram URL — enter your Vercel
deployment address (e.g. `https://your-app.vercel.app`). It's remembered; you
can change it any time via **App → Set app URL…**.

The URL is also managed from Vercel: set the `APP_URL` environment variable
in your Vercel project (Settings → Environment Variables) to the canonical
address, and the desktop app will check it on every launch and follow it
automatically. If you ever move the deployment to a new domain, just update
`APP_URL` and redeploy — no need to retype anything in the desktop app.

To run the exe outside the build environment (or copy it to another PC),
bundle the Qt runtime next to it once:

```bat
C:\Qt\6.7.3\msvc2022_64\bin\windeployqt.exe desktop\build\MultiGram.exe
```

Then the whole `desktop\build` folder is self-contained — you can create a
shortcut to `MultiGram.exe`, pin it to the taskbar, or zip the folder and use
it on any Windows PC without installing Qt.

## Portable build (run on any PC, nothing to install)

To make a fully portable copy that runs on a clean Windows PC:

```bat
mkdir desktop\portable\MultiGram
copy desktop\build\MultiGram.exe desktop\portable\MultiGram\
C:\Qt\6.8.3\msvc2022_64\bin\windeployqt.exe --release --compiler-runtime desktop\portable\MultiGram\MultiGram.exe
```

Then copy the Visual C++ runtime DLLs (`msvcp140*.dll`, `vcruntime140*.dll`,
`concrt140.dll`, `vccorlib140.dll`) from
`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Redist\MSVC\<version>\x64\Microsoft.VC143.CRT\`
into `desktop\portable\MultiGram\`, delete `vc_redist.x64.exe`, and zip the
folder. On any 64-bit Windows 10/11 PC: unzip anywhere and run
`MultiGram.exe` — no Qt, no Visual C++ redistributable, no installation.
On first launch it asks for the app URL once; login and settings are stored
per Windows user.
