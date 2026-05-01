const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require("@expo/config-plugins");

const SOURCE_FILE_NAME = "FlexBackgroundLocation.m";
const SOURCE_PATH = path.resolve(
  __dirname,
  "ios-background-location",
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
      fs.writeFileSync(
        path.join(targetDir, SOURCE_FILE_NAME),
        fs.readFileSync(SOURCE_PATH, "utf8")
      );
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
      if (key.endsWith("_comment")) continue;
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
        `with-flex-background-location: couldn't find PBXGroup named "${appName}"`
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

function withLocationPlist(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = new Set(cfg.modResults.UIBackgroundModes ?? []);
    modes.add("audio");
    modes.add("location");
    cfg.modResults.UIBackgroundModes = [...modes];
    cfg.modResults.NSLocationWhenInUseUsageDescription =
      "Koachr uses your location while recording to separate door-to-door conversations and tag where they happened.";
    cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription =
      "Koachr uses background location only during active recordings to separate visits when you walk between homes.";
    cfg.modResults.NSLocationAlwaysUsageDescription =
      "Koachr uses background location only during active recordings to separate visits when you walk between homes.";
    return cfg;
  });
}

module.exports = function withFlexBackgroundLocation(config) {
  config = withSourceFile(config);
  config = withXcodeEntry(config);
  config = withLocationPlist(config);
  return config;
};
