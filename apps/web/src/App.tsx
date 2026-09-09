import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LoginScreen from "./screens/LoginScreen";
import EventsScreen from "./screens/EventsScreen";
import EventWorkspace from "./screens/EventWorkspace";
import RfxBuilderScreen from "./screens/RfxBuilderScreen";
import DashboardScreen from "./screens/DashboardScreen";
import ApprovalsScreen from "./screens/ApprovalsScreen";
import VendorsDirectoryScreen from "./screens/VendorsDirectoryScreen";
import SettingsScreen from "./screens/SettingsScreen";
import GlobalLayout from "./components/GlobalLayout";
import { getSession, clearSession, type DemoProfile } from "./lib/auth";

export default function App() {
  const [session, setSession] = useState<DemoProfile | null>(() => getSession());

  const handleLogin = (profile: DemoProfile) => {
    setSession(profile);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <GlobalLayout session={session} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/events" element={<EventsScreen />} />
        <Route path="/events/new" element={<RfxBuilderScreen />} />
        <Route path="/events/:rfxId/*" element={<EventWorkspace />} />
        <Route path="/approvals" element={<ApprovalsScreen />} />
        <Route path="/vendors" element={<VendorsDirectoryScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        {/* Fallback to dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </GlobalLayout>
  );
}

