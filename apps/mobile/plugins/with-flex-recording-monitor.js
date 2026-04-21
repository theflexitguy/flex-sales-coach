// Expo config plugin that drops the FlexRecordingMonitor native source
// into the iOS target and adds it to the pbxproj so it compiles into
// the binary.
//
// This ships the AVAudioSession interruption observer that the JS
// watchdog can't replace because iOS throttles JS in background. See
// plugins/ios-recording-monitor/FlexRecordingMonitor.m for the full
// rationale. The plugin ensures the file survives
// `expo prebuild --clean`.
const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");

const SOURCE_FILE_NAME = "FlexRecordingMonitor.m";
const SOURCE_PATH = path.resolve(
  __dirname,
  "ios-recording-monitor",
  SOURCE_FILE_NAME
);

function withFlexRecordingMonitorFile(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const appName = cfg.modRequest.projectName;
      const targetDir = path.join(projectRoot, appName);
      fs.mkdirSync(targetDir, { recursive: true });
      const sourceContent = fs.readFileSync(SOURCE_PATH, "utf8");
      fs.writeFileSync(path.join(targetDir, SOURCE_FILE_NAME), sourceContent);
      return cfg;
    },
  ]);
}

function withFlexRecordingMonitorInXcode(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const relPath = `${appName}/${SOURCE_FILE_NAME}`;

    // Idempotent: bail if we've already added this file.
    const refs = project.pbxFileReferenceSection();
    for (const key of Object.keys(refs)) {
      const entry = refs[key];
      if (entry && typeof entry === "object" && entry.path === relPath) {
        return cfg;
      }
    }

    const groups = project.hash.project.objects["PBXGroup"];
    let appGroupKey = null;
    for (const key of Object.keys(groups)) {
      if (key.endsWith("_comment")) continue;
      const group = groups[key];
      if (group && group.name === appName) {
        appGroupKey = key;
        break;
      }
    }
    if (!appGroupKey) {
      throw new Error(
        `with-flex-recording-monitor: couldn't find PBXGroup named "${appName}"`
      );
    }

    project.addSourceFile(
      relPath,
      { target: project.getFirstTarget().uuid },
      appGroupKey
    );
    return cfg;
  });
}

module.exports = function withFlexRecordingMonitor(config) {
  config = withFlexRecordingMonitorFile(config);
  config = withFlexRecordingMonitorInXcode(config);
  return config;
};
