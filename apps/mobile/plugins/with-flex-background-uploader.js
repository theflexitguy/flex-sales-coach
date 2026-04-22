// Expo config plugin that installs the FlexBackgroundUploader native
// module:
//   1. Copies the .m + .h source files into the iOS target.
//   2. Adds them to the Xcode project so they compile into the binary.
//   3. Adds the .h to the bridging header so Swift AppDelegate can
//      reference FlexBackgroundUploader.
//   4. Injects application(_:handleEventsForBackgroundURLSession:completionHandler:)
//      into AppDelegate.swift so iOS-delivered background completion
//      handlers get stored on the uploader for later invocation.
//
// Stays idempotent across `expo prebuild --clean` — each step checks
// before mutating.
const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");

const SRC_DIR = path.resolve(__dirname, "ios-background-uploader");
const IMPL_NAME = "FlexBackgroundUploader.m";
const HEADER_NAME = "FlexBackgroundUploader.h";

const BRIDGING_IMPORT = `#import "${HEADER_NAME}"`;

const APP_DELEGATE_HANDLER = `
  // Injected by with-flex-background-uploader.js — forwards iOS's
  // background-URLSession completion handler to the native uploader
  // so URLSessionDidFinishEventsForBackgroundURLSession can invoke it.
  public override func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if identifier == FlexBackgroundUploader.sessionIdentifier() {
      FlexBackgroundUploader.storeCompletionHandler(completionHandler,
                                                    forIdentifier: identifier)
    } else {
      completionHandler()
    }
  }
`;

function copyFile(srcPath, destPath) {
  const content = fs.readFileSync(srcPath, "utf8");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content);
}

function withSourceFiles(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const appName = cfg.modRequest.projectName;
      const targetDir = path.join(projectRoot, appName);
      copyFile(path.join(SRC_DIR, IMPL_NAME), path.join(targetDir, IMPL_NAME));
      copyFile(path.join(SRC_DIR, HEADER_NAME), path.join(targetDir, HEADER_NAME));
      return cfg;
    },
  ]);
}

function withXcodeEntries(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;

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
        `with-flex-background-uploader: couldn't find PBXGroup named "${appName}"`
      );
    }

    const targetUuid = project.getFirstTarget().uuid;
    const refs = project.pbxFileReferenceSection();

    const addIfMissing = (relPath, isHeader) => {
      for (const refKey of Object.keys(refs)) {
        if (refKey.endsWith("_comment")) continue;
        const entry = refs[refKey];
        if (entry && typeof entry === "object" && entry.path === relPath) {
          return;
        }
      }
      if (isHeader) {
        project.addHeaderFile(relPath, {}, appGroupKey);
      } else {
        project.addSourceFile(relPath, { target: targetUuid }, appGroupKey);
      }
    };

    addIfMissing(`${appName}/${IMPL_NAME}`, false);
    addIfMissing(`${appName}/${HEADER_NAME}`, true);
    return cfg;
  });
}

function withBridgingHeader(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const appName = cfg.modRequest.projectName;
      const bridgingHeaderPath = path.join(
        projectRoot,
        appName,
        `${appName}-Bridging-Header.h`
      );
      if (!fs.existsSync(bridgingHeaderPath)) return cfg;
      const content = fs.readFileSync(bridgingHeaderPath, "utf8");
      if (content.includes(BRIDGING_IMPORT)) return cfg;
      fs.writeFileSync(bridgingHeaderPath, `${content.trimEnd()}\n${BRIDGING_IMPORT}\n`);
      return cfg;
    },
  ]);
}

function withAppDelegatePatch(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const appName = cfg.modRequest.projectName;
      const appDelegatePath = path.join(projectRoot, appName, "AppDelegate.swift");
      if (!fs.existsSync(appDelegatePath)) return cfg;
      let content = fs.readFileSync(appDelegatePath, "utf8");

      // Idempotent — bail if already injected.
      if (content.includes("handleEventsForBackgroundURLSession")) {
        return cfg;
      }

      // Find the closing brace of the AppDelegate class and inject
      // the handler just before it. We look for the specific pattern
      // that ends the main class body to avoid hitting the
      // ReactNativeDelegate class below it.
      const classMarker = "public class AppDelegate: ExpoAppDelegate {";
      const markerIdx = content.indexOf(classMarker);
      if (markerIdx < 0) {
        console.warn(
          "with-flex-background-uploader: AppDelegate class not found, skipping handler injection"
        );
        return cfg;
      }

      // Walk brace depth to find the matching closing `}`. Starts at
      // depth 1 (inside the class), increments on `{`, decrements on `}`.
      let depth = 1;
      let i = markerIdx + classMarker.length;
      while (i < content.length && depth > 0) {
        const ch = content[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        if (depth === 0) break;
        i += 1;
      }
      if (depth !== 0) {
        console.warn(
          "with-flex-background-uploader: couldn't find end of AppDelegate class"
        );
        return cfg;
      }
      const before = content.slice(0, i);
      const after = content.slice(i);
      content = before + APP_DELEGATE_HANDLER + after;
      fs.writeFileSync(appDelegatePath, content);
      return cfg;
    },
  ]);
}

module.exports = function withFlexBackgroundUploader(config) {
  config = withSourceFiles(config);
  config = withXcodeEntries(config);
  config = withBridgingHeader(config);
  config = withAppDelegatePatch(config);
  return config;
};
