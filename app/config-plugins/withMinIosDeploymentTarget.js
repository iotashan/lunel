const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 27 / iOS 27 SDK rejects deployment targets < 15.0. The standard
// react_native_post_install bumps the main pod targets, but leaves resource
// bundles and vendored sub-targets (e.g. *_resources, RNSVGFilters,
// SWCompression, BitByteData) at their own podspec minimums (11.0–13.4). This
// plugin appends a post_install loop that forces EVERY pod target's
// IPHONEOS_DEPLOYMENT_TARGET to the SDK 56 minimum across all configs.
const MIN_IOS = '16.4';

module.exports = function withMinIosDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes('FORCE_MIN_IOS_DEPLOYMENT_TARGET')) {
        contents = contents.replace(
          'post_install do |installer|',
          `post_install do |installer|
    # FORCE_MIN_IOS_DEPLOYMENT_TARGET: Xcode 27 needs >= 15; bump every pod
    # target (incl. resource bundles RN's post_install skips) to ${MIN_IOS}.
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |bc|
        current = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || current.to_f < ${MIN_IOS}
          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'
        end
      end
    end`
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
