const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");

const SOURCE_FILE_NAME = "FlexRoleplayRecorder.m";
const SOURCE_PATH = path.resolve(__dirname, "ios-roleplay-recorder", SOURCE_FILE_NAME);

function withNativeFile(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(SOURCE_PATH, path.join(targetDir, SOURCE_FILE_NAME));
      return cfg;
    },
  ]);
}

function withXcodeSource(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const relPath = `${appName}/${SOURCE_FILE_NAME}`;
    const refs = project.pbxFileReferenceSection();
    if (Object.values(refs).some((entry) => entry && typeof entry === "object" && entry.path === relPath)) {
      return cfg;
    }

    const groups = project.hash.project.objects.PBXGroup;
    const appGroupKey = Object.keys(groups).find((key) => {
      if (key.endsWith("_comment")) return false;
      return groups[key]?.name === appName;
    });
    if (!appGroupKey) throw new Error(`with-flex-roleplay-recorder: missing PBXGroup ${appName}`);

    project.addSourceFile(relPath, { target: project.getFirstTarget().uuid }, appGroupKey);
    return cfg;
  });
}

module.exports = function withFlexRoleplayRecorder(config) {
  return withXcodeSource(withNativeFile(config));
};
