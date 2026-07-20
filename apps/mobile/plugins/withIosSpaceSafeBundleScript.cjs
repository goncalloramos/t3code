"use strict";

const { withXcodeProject } = require("expo/config-plugins");

const BUILD_PHASE_NAME = '"Bundle React Native code and images"';
const UNSAFE_INVOCATION =
  "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"`";
const SAFE_INVOCATION = `REACT_NATIVE_XCODE_SCRIPT=$("$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'")
"$REACT_NATIVE_XCODE_SCRIPT"`;

module.exports = function withIosSpaceSafeBundleScript(config) {
  return withXcodeProject(config, (nextConfig) => {
    const phases = nextConfig.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const bundlePhases = Object.entries(phases).filter(
      ([key, phase]) => !key.endsWith("_comment") && phase?.name === BUILD_PHASE_NAME,
    );

    if (bundlePhases.length !== 1) {
      throw new Error(
        `Expected one ${BUILD_PHASE_NAME} Xcode build phase, found ${bundlePhases.length}.`,
      );
    }

    const phase = bundlePhases[0][1];
    const shellScript = JSON.parse(phase.shellScript);
    if (!shellScript.includes(UNSAFE_INVOCATION)) {
      if (shellScript.includes("REACT_NATIVE_XCODE_SCRIPT")) {
        return nextConfig;
      }
      throw new Error(`Could not find React Native's bundle-script invocation to make space-safe.`);
    }

    phase.shellScript = JSON.stringify(shellScript.replace(UNSAFE_INVOCATION, SAFE_INVOCATION));
    return nextConfig;
  });
};
