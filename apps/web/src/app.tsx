import "./theme.css";
import "./styles/ui.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import WalletHome from "./pages/WalletHome";
import History from "./pages/History";
import Send from "./pages/Send";

export default function App() {
  return (
    <BrowserRouter basename="/wallet">
      <Routes>
        <Route path="/" element={<WalletHome />} />
        <Route path="/history" element={<History />} />
        <Route path="/send" element={<Send />} />
        <Route path="/mini" element={<Navigate to="/" replace />} />
        <Route path="/pay/:token" element={<Navigate to="/" replace />} />
        <Route path="/claim" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
