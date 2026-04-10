/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import MainLayoutShell from "./main-layout/MainLayoutShell";
import { useMainLayoutController } from "./main-layout/useMainLayoutController";

/**
 * Stable page facade for the main workspace route.
 * All stateful orchestration lives in the main-layout module so this file
 * remains a thin composition root that is easy to reason about.
 */
export default function MainLayout() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { config } = useRuntime();
  const e2ee = useE2EE();
  const navigate = useNavigate();
  const controller = useMainLayoutController({
    auth,
    runtimeConfig: config,
    e2ee,
    navigate,
    t,
  });

  return <MainLayoutShell {...controller} />;
}
