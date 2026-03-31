import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { RuntimeProvider, useRuntime } from "@/contexts/RuntimeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ConnectPage from "@/pages/ConnectPage";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import SetupPage from "@/pages/SetupPage";
import OnboardingPage from "@/pages/OnboardingPage";
import MainLayout from "@/pages/MainLayout";
import "@/App.css";

function LoadingScreen({ label = "Connecting..." }) {
  return (
    <div className="flex items-center justify-center h-screen bg-[#0A0A0A]" data-testid="loading-screen">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#A1A1AA] text-sm font-medium" style={{ fontFamily: "Manrope, sans-serif" }}>
          {label}
        </p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { ready, config, setupStatus } = useRuntime();
  const { user, loading } = useAuth();

  if (!ready) {
    return <LoadingScreen label="Loading instance..." />;
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
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/connect" element={<Navigate to={user ? "/" : "/login"} replace />} />
      <Route path="/setup" element={<Navigate to={user ? "/onboarding" : "/login"} replace />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
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
      <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
      <Route path="/invite/:code" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
      <Route path="/*" element={<ProtectedRoute><MainLayout /></ProtectedRoute>} />
    </Routes>
  );
}

function AppShell() {
  return (
    <>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: { background: "#18181B", border: "1px solid #27272A", color: "#FFFFFF" },
        }}
      />
      <AppRoutes />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <RuntimeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </RuntimeProvider>
    </BrowserRouter>
  );
}

export default App;

