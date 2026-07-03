import { useTranslation } from "react-i18next";
import ApiStatusBar from "../ApiStatusBar";

type FooterProps = {
  compact?: boolean;
};

export default function Footer({ compact }: FooterProps) {
  const { t } = useTranslation();
  return (
    <footer className={`app-footer${compact ? " compact" : ""}`}>
      <ApiStatusBar />
      <details className="details" style={{ marginTop: 12 }}>
        <summary>{t("wallet.footer.summary")}</summary>
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
          {t("wallet.footer.description")}
        </p>
      </details>
    </footer>
  );
}
