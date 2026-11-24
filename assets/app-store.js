/** Open Mark2 in the native store on Mac while preserving its web listing. */
function configureAppStoreLinks() {
  const platform = navigator.userAgentData?.platform;
  // iPadOS Safari can report MacIntel when requesting the desktop site.
  const isMac = platform
    ? platform === "macOS"
    : navigator.platform.startsWith("Mac") && navigator.maxTouchPoints < 2;
  if (!isMac) return;

  // The regionless link lets the App Store use the signed-in storefront.
  const nativeUrl = "macappstore://itunes.apple.com/app/id6751408900?mt=12";
  for (const button of document.querySelectorAll("[data-app-store]")) {
    const fallback = button.closest(".cta").querySelector("[data-app-store-web]");
    fallback.querySelector("a").href = button.href;
    fallback.hidden = false;
    button.href = nativeUrl;
  }
}

configureAppStoreLinks();
