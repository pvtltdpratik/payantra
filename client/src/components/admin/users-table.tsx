"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authedApi } from "@/lib/client-api";
import type { AdminUser } from "@/types/admin";
import { describeError } from "./api-error-message";

const ROLE_LABEL: Record<AdminUser["role"], string> = {
  CUSTOMER: "Customer",
  DELIVERY_PARTNER: "Delivery partner",
  ADMIN: "Administrator",
};

export function UsersTable({ users, currentUserId }: { users: AdminUser[]; currentUserId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(user: AdminUser, patch: Partial<Pick<AdminUser, "role" | "status">>) {
    const what = patch.role
      ? `Change ${user.email} to ${ROLE_LABEL[patch.role]}?`
      : patch.status === "SUSPENDED"
        ? `Suspend ${user.email}? They will be signed out of every protected area.`
        : `Reactivate ${user.email}?`;
    if (!window.confirm(what)) {
      router.refresh(); // snap the <select> back to the stored value
      return;
    }
    setBusyId(user.id);
    setError(null);
    try {
      await authedApi(`/admin/users/${user.id}`, { method: "PATCH", body: patch });
      router.refresh();
    } catch (err) {
      setError(describeError(err));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const selectClass = "h-9 rounded-md border border-input bg-card px-2 text-sm disabled:opacity-60";

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.fullName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    {isSelf && <p className="text-xs text-primary">This is you</p>}
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Role for ${u.email}`}
                      className={selectClass}
                      value={u.role}
                      disabled={isSelf || busyId === u.id}
                      onChange={(e) => update(u, { role: e.target.value as AdminUser["role"] })}
                    >
                      {(Object.keys(ROLE_LABEL) as AdminUser["role"][]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Status for ${u.email}`}
                      className={selectClass}
                      value={u.status}
                      disabled={isSelf || busyId === u.id}
                      onChange={(e) => update(u, { status: e.target.value as AdminUser["status"] })}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
