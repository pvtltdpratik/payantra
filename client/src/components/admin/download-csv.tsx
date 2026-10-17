"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

/**
 * Downloads an admin CSV. A plain link cannot work: the API wants the Authorization header, which a browser
 * only sends for fetch(). The file is read as a blob and saved under the name the server chose.
 */
export function DownloadCsv({ path, query = {}, label = "Download CSV" }: { path: string; query?: Record<string, string>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const qs = new URLSearchParams({ ...query, format: "csv" });
      const res = await fetch(`${API_URL}${path}?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(res.status === 403 ? "You don't have permission to export this." : "The export failed. Please try again.");
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "payantra-export.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" className="h-10" onClick={download} disabled={busy}>
        <Download aria-hidden /> {busy ? "Preparing…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
