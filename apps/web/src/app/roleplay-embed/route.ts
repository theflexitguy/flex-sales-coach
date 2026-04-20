// ElevenLabs Conversational AI widget host — served as raw HTML so we
// get full control of <html>/<head>/<body> (Next.js page layout would
// wrap us in the site chrome). The mobile app loads this URL inside a
// WebView; WKWebView has real WebRTC support, which is what lets us
// sidestep the native-SDK integration issues and actually ship voice
// roleplay.
//
// Query params:
//   agentId         — ElevenLabs agent ID (required unless signedUrl)
//   signedUrl       — short-lived signed URL for private agents
//   overridePrompt  — scenario-specific system prompt override
import { NextResponse } from "next/server";

function htmlEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function missingAgentPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Roleplay</title></head>
<body style="margin:0;padding:24px;background:#09090b;color:#ef4444;font:14px -apple-system,system-ui,sans-serif;">
<h1 style="font-size:18px;">Missing agent</h1>
<p>This page must be loaded with an <code>agentId</code> query parameter.</p>
</body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const signedUrl = url.searchParams.get("signedUrl") ?? "";
  const overridePrompt = url.searchParams.get("overridePrompt") ?? "";

  if (!agentId && !signedUrl) {
    return new NextResponse(missingAgentPage(), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const agentAttr = agentId ? ` agent-id="${htmlEscape(agentId)}"` : "";
  const signedUrlAttr = signedUrl ? ` signed-url="${htmlEscape(signedUrl)}"` : "";

  // Bridge script runs inside the widget page and emits events up to the
  // RN WebView host via window.ReactNativeWebView.postMessage. It also
  // (re)applies the override-prompt attribute once the widget mounts, so
  // scenario-specific context sticks even if the widget renders late.
  const bridge = `
(function () {
  var overridePrompt = ${JSON.stringify(overridePrompt)};
  function post(msg) {
    try {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function") {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) {}
  }
  function wireWidget(widget) {
    if (!widget || widget.__flexBridgeAttached) return;
    widget.__flexBridgeAttached = true;
    if (overridePrompt) {
      try { widget.setAttribute("override-prompt", overridePrompt); } catch (e) {}
    }
    ["elevenlabs-convai:call","elevenlabs-convai:call-ended","elevenlabs-convai:error"].forEach(function (evt) {
      widget.addEventListener(evt, function (e) {
        post({ type: evt, detail: e && e.detail ? e.detail : null });
      });
    });
  }
  var w = document.querySelector("elevenlabs-convai");
  if (w) {
    wireWidget(w);
  } else {
    var obs = new MutationObserver(function () {
      var w = document.querySelector("elevenlabs-convai");
      if (w) { wireWidget(w); obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  post({ type: "flex:embed-ready" });
})();`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <title>Roleplay</title>
  <style>
    html, body { margin: 0; padding: 0; background: #09090b; height: 100vh; min-height: 100vh; }
    body { display: flex; align-items: stretch; justify-content: stretch; color: #f4f4f5; font-family: -apple-system, system-ui, sans-serif; }
    elevenlabs-convai { flex: 1; width: 100%; }
  </style>
</head>
<body>
  <elevenlabs-convai${agentAttr}${signedUrlAttr}></elevenlabs-convai>
  <script async type="text/javascript" src="https://unpkg.com/@elevenlabs/convai-widget-embed"></script>
  <script>${bridge}</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Allow WebView to open the page with mic — no frame-ancestor restriction here.
      "cache-control": "no-store",
    },
  });
}
