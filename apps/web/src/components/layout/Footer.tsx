import ApiStatusBar from "../ApiStatusBar";

type FooterProps = {
  compact?: boolean;
};

export default function Footer({ compact }: FooterProps) {
  return (
    <footer className={`app-footer${compact ? " compact" : ""}`}>
      <ApiStatusBar />
      <details className="details" style={{ marginTop: 12 }}>
        <summary>Non-custodial wallet / 非託管錢包</summary>
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
          Your mnemonic and private keys stay in this browser. PEPEW Light only receives addresses for lookup and signed raw transactions for broadcast. Never share or screenshot your mnemonic.
        </p>
        <p className="muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
          助記詞與私鑰只會保留在此瀏覽器中。PEPEW Light 只接收地址查詢與已簽署交易廣播。請勿分享或截圖助記詞。
        </p>
      </details>
    </footer>
  );
}
