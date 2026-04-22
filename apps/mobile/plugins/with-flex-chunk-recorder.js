// Expo config plugin that installs the FlexChunkRecorder native module
// into the iOS target. Drops the .m source file into the app's iOS
// project and wires it into the Xcode build so it compiles into the
// binary on every `expo prebuild`.
const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");

const SOURCE_FILE_NAME = "FlexChunkRecorder.m";
const SOURCE_PATH = path.resolve(
  __dirname,
  "ios-chunk-recorder",
  SOURCE_FILE_NAME
);

function withSourceFile(config) {
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

function withXcodeEntry(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const relPath = `${appName}/${SOURCE_FILE_NAME}`;

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
        `with-flex-chunk-recorder: couldn't find PBXGroup named "${appName}"`
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

module.exports = function withFlexChunkRecorder(config) {
  config = withSourceFile(config);
  config = withXcodeEntry(config);
  return config;
};
