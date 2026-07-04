import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Header from "./Header";
import Footer from "./Footer";

interface AppLayoutProps {
  children: ReactNode;
  compact?: boolean;
}

export default function AppLayout({ children, compact }: AppLayoutProps) {
  const { t } = useTranslation();
  const telegramWebApp = typeof window !== "undefined"
    ? (window as any)?.Telegram?.WebApp
    : undefined;
  const isTelegram = Boolean(telegramWebApp?.initData);
  const isCompact = Boolean(compact || isTelegram);

  useEffect(() => {
    if (!telegramWebApp?.initData) return;
    // Reserved for future Mini App UX integrations.
    // telegramWebApp.expand();
    // telegramWebApp.setHeaderColor("#0b0f14");
  }, []);

  return (
    <div className={`app-shell${isCompact ? " compact" : ""}`}>
      <Header compact={isCompact} />
      <main className="app-main">
        <div className={`container app-content${isCompact ? " compact" : ""}`}>
          <div className="wallet-home-link-bar">
            <a className="btn secondary" href="https://light.pepepow.net/">
              ← {t("nav.backToLight", { defaultValue: "Back to PEPEW Light" })}
            </a>
          </div>
          {children}
        </div>
      </main>
      <Footer compact={isCompact} />
    </div>
  );
}
