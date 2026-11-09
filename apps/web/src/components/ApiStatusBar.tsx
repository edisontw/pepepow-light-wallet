import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type ApiStatus = "checking" | "ok" | "fail";

export default function ApiStatusBar() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    // Check the same-origin PEPEW Light gateway; never call the retired Wallet API.
    void fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (active) setStatus(response.ok ? "ok" : "fail");
      })
      .catch(() => {
        if (active) setStatus("fail");
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const statusLabel =
    status === "ok" ? t("api.ok") : status === "fail" ? t("api.fail") : t("api.checking");

  return (
    <div className="status-bar">
      <span>
        {t("api.base")}: <code>/api</code>
      </span>
      <span>
        {t("api.status")}: <strong>{statusLabel}</strong>
      </span>
    </div>
  );
}
