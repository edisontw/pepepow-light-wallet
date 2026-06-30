import "./theme.css";
import "./styles/ui.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import WalletHome from "./pages/WalletHome";
import History from "./pages/History";
import Mini from "./pages/Mini";
import Pay from "./pages/Pay";
import Claim from "./pages/Claim";

export default function App() {
  return (
    <BrowserRouter basename="/wallet">
      <Routes>
        <Route path="/" element={<WalletHome />} />
        <Route path="/send" element={<Navigate to="/" replace />} />
        <Route path="/history" element={<History />} />
        <Route path="/mini" element={<Mini />} />
        <Route path="/pay/:token" element={<Pay />} />
        <Route path="/claim" element={<Claim />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
