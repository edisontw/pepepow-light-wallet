import { useEffect } from "react";
import { useLocation } from "react-router-dom";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const ANALYTICS_PATHS: Record<string, string> = {
  "/": "/wallet/",
  "/history": "/wallet/history",
  "/send": "/wallet/send",
};

let lastTrackedPath: string | undefined;

export default function PrivacySafePageView() {
  const { pathname } = useLocation();

  useEffect(() => {
    const pagePath = ANALYTICS_PATHS[pathname];
    if (!pagePath || pagePath === lastTrackedPath || !window.gtag) return;

    lastTrackedPath = pagePath;
    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: `${window.location.origin}${pagePath}`,
      page_path: pagePath,
      page_referrer: "",
    });
  }, [pathname]);

  return null;
}
