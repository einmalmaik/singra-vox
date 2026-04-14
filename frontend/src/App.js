/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { RuntimeProvider, useRuntime } from "@/contexts/RuntimeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { E2EEProvider } from "@/contexts/E2EEContext";
import ConnectPage from "@/pages/ConnectPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import SetupPage from "@/pages/SetupPage";
import OnboardingPage from "@/pages/OnboardingPage";
import InvitePage from "@/pages/InvitePage";
import MainLayout from "@/pages/MainLayout";
import SvidRegisterPage from "@/pages/SvidRegisterPage";
import SvidSetupPage from "@/pages/SvidSetupPage";
import DesktopInviteBridge from "@/components/invites/DesktopInviteBridge";
import {
  DesktopStartupUpdateGate,
  DesktopUpdateProvider,
  UpdateNotification,
} from "@/components/desktop/UpdateNotification";
import "@/App.css";

function LoadingScreen({ label }) {
  const { t } = useTranslation();
  const resolvedLabel = label || t("app.connecting");

  return (
    <div className="flex items-center justify-center h-screen bg-[#0A0A0A]" data-testid="loading-screen">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/favicon-192x192.png"
          alt="Singra Vox"
          className="w-16 h-16 animate-pulse"
          style={{ filter: "drop-shadow(0 0 20px rgba(34,211,238,0.3))" }}
        />
        <p className="text-zinc-500 text-sm font-medium tracking-wide" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
          {resolvedLabel}
        </p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen label={t("app.connecting")} />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { ready, config, setupStatus } = useRuntime();
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (!ready) {
    return <LoadingScreen label={t("app.loadingInstance")} />;
  }

  if (config?.needsConnection) {
    return (
      <Routes>
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="*" element={<Navigate to="/connect" replace />} />
      </Routes>
    );
  }

  if (!setupStatus?.initialized) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (loading) {
    return <LoadingScreen label={t("app.connecting")} />;
  }

  return (
    <Routes>
      <Route path="/connect" element={<Navigate to={user ? "/" : "/login"} replace />} />
      <Route path="/setup" element={<Navigate to={user ? "/onboarding" : "/login"} replace />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
      <Route path="/reset-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
      <Route path="/register-svid" element={user ? <Navigate to="/" replace /> : <SvidRegisterPage />} />
      <Route path="/setup-svid" element={<ProtectedRoute><SvidSetupPage /></ProtectedRoute>} />
      <Route
        path="/register"
        element={
          !setupStatus?.allow_open_signup
            ? <Navigate to="/login" replace />
            : user
              ? <Navigate to="/" replace />
              : <RegisterPage />
        }
      />
      <Route path="/verify-email" element={user ? <Navigate to="/" replace /> : <VerifyEmailPage />} />
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
      <Route path="/*" element={<ProtectedRoute><MainLayout /></ProtectedRoute>} />
    </Routes>
  );
}

function AppShell() {
  return (
    <DesktopUpdateProvider>
      <Toaster
        theme="dark"
        position="top-right"
        richColors
        toastOptions={{
          className: "singravox-toast",
          style: {
            background: "rgba(24, 24, 27, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(63, 63, 70, 0.5)",
            color: "#E4E4E7",
            borderRadius: "12px",
            fontSize: "13px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          },
        }}
      />
      <DesktopStartupUpdateGate />
      <DesktopInviteBridge />
      <UpdateNotification />
      <AppRoutes />
    </DesktopUpdateProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <RuntimeProvider>
        <AuthProvider>
          <E2EEProvider>
            <AppShell />
          </E2EEProvider>
        </AuthProvider>
      </RuntimeProvider>
    </BrowserRouter>
  );
}

export default App;
