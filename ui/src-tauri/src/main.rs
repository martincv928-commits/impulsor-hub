// Impulsor Hub desktop shell entry point.
//
// M1's desktop shell is intentionally a thin wrapper around the FastAPI
// backend + Vite/React frontend: it opens a webview pointed at the local
// dev server (or built assets) and does not implement any native logic of
// its own. See docs/M1_REPORT.md for a note on why the Tauri build itself
// was not fully verified inside this development sandbox.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Impulsor Hub");
}
