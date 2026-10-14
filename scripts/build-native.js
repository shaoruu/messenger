const { execFileSync } = require('child_process');
const { mkdirSync } = require('fs');
const path = require('path');

// Compiles the Objective-C addon the main process loads to give the window an empty
// toolbar (see src/native/window-chrome.m). It only uses Node-API, so the headers of
// whichever Node runs this script work for Electron too.
if (process.platform === 'darwin') {
  mkdirSync('dist-native', { recursive: true });
  execFileSync(
    'clang',
    [
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-fobjc-arc',
      '-O2',
      '-arch',
      'arm64',
      '-arch',
      'x86_64',
      '-mmacosx-version-min=12.0',
      '-DNODE_GYP_MODULE_NAME=window_chrome',
      '-I',
      path.join(path.dirname(process.execPath), '../include/node'),
      '-framework',
      'AppKit',
      'src/native/window-chrome.m',
      '-o',
      'dist-native/window-chrome.node',
    ],
    { stdio: 'inherit' }
  );
}
