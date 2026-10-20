"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdminAction } from "@/lib/validation/schemas";
import { runAdminAction } from "@/services/admin";
import { errorMessage } from "@/lib/utils";

export function useAdminAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, action: AdminAction, ok: string) {
    setBusy(key);
    try {
      await runAdminAction(action);
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}
