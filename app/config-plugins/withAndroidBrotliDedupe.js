const { withAppBuildGradle } = require('expo/config-plugins');

// Expo SDK 56 core's android/build.gradle adds `implementation 'org.brotli:dec:0.1.2'`
// (used by expo.modules.fetch.TransparentCompressionInterceptor for `br` responses).
// @hot-updater/react-native vendors a newer local jar `libs/org.brotli.dec-1.2.0.jar`
// (used to decompress `.tar.br` hot-update bundles). Both ship the same
// `org.brotli.dec.*` classes, so when they both land in the app's merged runtime
// classpath, `:app:checkDebugDuplicateClasses` fails the build.
//
// Fix: exclude the Maven coordinate `org.brotli:dec` from the :app module ONLY.
// This drops expo's transitive 0.1.2 from the app dex; hot-updater's vendored 1.2.0
// jar is a `files()` dependency (not a Maven module) so the exclude leaves it on the
// classpath, and it provides `BrotliInputStream(InputStream)` — the only API expo
// uses — so both expo's and hot-updater's code resolve it at runtime.
//
// IMPORTANT: the exclude must be :app-scoped, NOT applied to the :expo subproject.
// :expo's own Kotlin (TransparentCompressionInterceptor.kt) imports
// `org.brotli.dec.BrotliInputStream`, so excluding brotli from :expo's compile
// classpath breaks `:expo:compileDebugKotlin` ("Unresolved reference 'brotli'").
//
// android/ is CNG-regenerated, so this lives in a config plugin, not a hand edit.
const MARKER = 'BROTLI_DEDUPE';
const SNIPPET = `
// ${MARKER}: drop expo core's transitive org.brotli:dec:0.1.2 from the app dex so it
// no longer collides with @hot-updater/react-native's vendored org.brotli.dec-1.2.0.jar.
// Scoped to :app only — :expo compiles against its own brotli, the app runs on 1.2.0.
configurations.all {
    exclude group: 'org.brotli', module: 'dec'
}
`;

module.exports = function withAndroidBrotliDedupe(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withAndroidBrotliDedupe: cannot patch a non-groovy app build.gradle'
      );
    }
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }
    // Append at the end of the file — top-level `configurations.all` applies to the
    // :app module's own configurations (debugRuntimeClasspath etc.).
    cfg.modResults.contents = `${cfg.modResults.contents.trimEnd()}\n${SNIPPET}`;
    return cfg;
  });
};
