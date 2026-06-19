const { withMainApplication } = require('expo/config-plugins');

// @hot-updater/react-native's config plugin injects
//   jsBundleFilePath = HotUpdater.getJSBundleFile(applicationContext),
// as a new argument into the generated MainApplication.kt `getDefaultReactHost(...)`
// call. Its transformer splices that line in just before the call's closing `)`,
// but it does NOT add a trailing comma to the argument that precedes it. The Expo
// SDK 56 MainApplication.kt template ends the `packageList = …apply { … }` argument
// WITHOUT a trailing comma (it was the last argument), so the result is two adjacent
// arguments with no separator:
//
//     packageList =
//       PackageList(this).packages.apply { … }      // <-- missing comma
//     jsBundleFilePath = HotUpdater.getJSBundleFile(applicationContext),
//
// which fails `:app:compileDebugKotlin` with "Syntax error: Expecting an element".
//
// This plugin runs AFTER hot-updater's (config-plugins apply in array order, and we
// register this one later in app.json) and repairs the generated Kotlin by inserting
// the missing comma on the `}` line that immediately precedes the injected
// `jsBundleFilePath` line. It is a no-op if the comma is already present (so it
// survives a future hot-updater fix), and it touches nothing when hot-updater did not
// inject (no `jsBundleFilePath` line). android/ is CNG-regenerated, so this must be a
// config plugin, not a hand edit.
module.exports = function withFixHotUpdaterMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      // Java template (legacy) — hot-updater uses a different path there; nothing to do.
      return cfg;
    }
    const lines = cfg.modResults.contents.split('\n');
    const jsBundleIdx = lines.findIndex((l) =>
      l.includes('jsBundleFilePath = HotUpdater.getJSBundleFile(applicationContext)')
    );
    if (jsBundleIdx <= 0) {
      // hot-updater did not inject (or layout changed) — leave untouched.
      return cfg;
    }
    // Walk back to the previous non-blank line; it should be the end of the prior
    // argument. If it does not already end with a comma (ignoring trailing
    // whitespace), add one.
    let prevIdx = jsBundleIdx - 1;
    while (prevIdx >= 0 && lines[prevIdx].trim().length === 0) prevIdx -= 1;
    if (prevIdx < 0) return cfg;
    const prev = lines[prevIdx];
    const trimmedEnd = prev.replace(/\s+$/, '');
    if (!trimmedEnd.endsWith(',') && !trimmedEnd.endsWith('(')) {
      lines[prevIdx] = `${trimmedEnd},`;
      cfg.modResults.contents = lines.join('\n');
    }
    return cfg;
  });
};
