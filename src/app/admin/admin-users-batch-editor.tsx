"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  batchUpdateUserAccounts,
  resetUserPassword,
  undoLastAdminAction,
  type AdminBatchActionState
} from "@/server/admin-actions";

type RoleOption = {
  id: string;
  name: string;
  active: boolean;
};

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  chineseName: string | null;
  roleId: string;
  roleName: string;
  status: "ACTIVE" | "INACTIVE";
  forcePasswordChange: boolean;
};

type Props = {
  labels: {
    activeUsers: string;
    archive: string;
    archivedUsers: string;
    chineseName: string;
    discardChanges: string;
    displayName: string;
    forcePasswordChange: string;
    noActiveUsers: string;
    noArchivedUsers: string;
    passwordSet: string;
    passwordState: string;
    resetPassword: string;
    restore: string;
    role: string;
    saveChanges: string;
    undo: string;
    unassigned: string;
    unsavedChanges: string;
    username: string;
  };
  roles: RoleOption[];
  users: UserRow[];
  redirectTo: string;
};

const initialActionState: AdminBatchActionState = {
  ok: false,
  message: null,
  rowErrors: {},
  version: 0
};

function comparable(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    chineseName: row.chineseName ?? null,
    roleId: row.roleId,
    status: row.status
  };
}

function sameRow(left: UserRow, right: UserRow): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function AdminUsersBatchEditor({ labels, roles, users, redirectTo }: Props) {
  const router = useRouter();
  const [baselineRows, setBaselineRows] = useState(users);
  const [rows, setRows] = useState(users);
  const [state, formAction] = useActionState(batchUpdateUserAccounts, initialActionState);
  const handledSuccessVersion = useRef(0);
  const baselineById = useMemo(() => new Map(baselineRows.map((row) => [row.id, row])), [baselineRows]);
  const changedRows = rows.filter((row) => {
    const baseline = baselineById.get(row.id);
    return baseline == null || !sameRow(row, baseline);
  });
  const changedCount = changedRows.length;
  const activeRows = rows.filter((row) => row.status === "ACTIVE");
  const archivedRows = rows.filter((row) => row.status === "INACTIVE");

  useEffect(() => {
    setBaselineRows(users);
    setRows(users);
  }, [users]);

  useEffect(() => {
    if (!state.ok || state.version === handledSuccessVersion.current) {
      return;
    }

    handledSuccessVersion.current = state.version;
    setBaselineRows(rows);
    router.refresh();
  }, [router, rows, state.ok, state.version]);

  useEffect(() => {
    if (changedCount === 0) {
      return;
    }

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [changedCount]);

  function updateRow(id: string, patch: Partial<UserRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function isEdited(row: UserRow): boolean {
    const baseline = baselineById.get(row.id);
    return baseline == null || !sameRow(row, baseline);
  }

  function discardChanges() {
    setRows(baselineRows);
  }

  function renderEditableRow(row: UserRow) {
    const rowError = state.rowErrors[row.id];

    return (
      <div
        key={row.id}
        className={`adminRow userAdminRow stagedAdminRow${isEdited(row) ? " editedAdminRow" : ""}${rowError ? " rowError" : ""}`}
        data-admin-user-row={row.username}
      >
        <label>
          {labels.username}
          <input
            name="username"
            value={row.username}
            onChange={(event) => updateRow(row.id, { username: event.target.value })}
            required
          />
        </label>
        <label>
          {labels.displayName}
          <input
            name="displayName"
            value={row.displayName}
            onChange={(event) => updateRow(row.id, { displayName: event.target.value })}
            required
          />
        </label>
        <label>
          {labels.chineseName}
          <input
            name="chineseName"
            value={row.chineseName ?? ""}
            onChange={(event) => updateRow(row.id, { chineseName: event.target.value })}
          />
        </label>
        <label>
          {labels.role}
          <select name="roleId" value={row.roleId} onChange={(event) => updateRow(row.id, { roleId: event.target.value })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
                {role.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.passwordState}
          <input value={row.forcePasswordChange ? labels.forcePasswordChange : labels.passwordSet} readOnly />
        </label>
        <div className="roleActions">
          <form action={resetUserPassword}>
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="userId" value={row.id} />
            <button type="submit">{labels.resetPassword}</button>
          </form>
          <button type="button" onClick={() => updateRow(row.id, { status: "INACTIVE" })}>
            {labels.archive}
          </button>
        </div>
        {rowError ? <p className="rowErrorText">{rowError}</p> : null}
      </div>
    );
  }

  function renderArchivedRow(row: UserRow) {
    const rowError = state.rowErrors[row.id];

    return (
      <div
        key={row.id}
        className={`adminRow userAdminRow stagedAdminRow${isEdited(row) ? " editedAdminRow" : ""}${rowError ? " rowError" : ""}`}
        data-admin-user-row={row.username}
      >
        <label>
          {labels.username}
          <input value={row.username} readOnly />
        </label>
        <label>
          {labels.displayName}
          <input value={row.displayName} readOnly />
        </label>
        <label>
          {labels.chineseName}
          <input value={row.chineseName ?? ""} readOnly />
        </label>
        <label>
          {labels.role}
          <input value={row.roleName} readOnly />
        </label>
        <label>
          {labels.passwordState}
          <input value={row.forcePasswordChange ? labels.forcePasswordChange : labels.passwordSet} readOnly />
        </label>
        <div className="roleActions">
          <button type="button" onClick={() => updateRow(row.id, { status: "ACTIVE" })}>
            {labels.restore}
          </button>
        </div>
        {rowError ? <p className="rowErrorText">{rowError}</p> : null}
      </div>
    );
  }

  return (
    <>
      <section className="workSurface" aria-labelledby="users-heading">
        <div className="surfaceHeader">
          <h2 id="users-heading">{labels.activeUsers}</h2>
          <form action={undoLastAdminAction}>
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="undoScope" value="users" />
            <button type="submit" className="secondaryButton">
              {labels.undo}
            </button>
          </form>
        </div>
        <div className="adminList">
          {activeRows.length === 0 ? <p className="emptyState">{labels.noActiveUsers}</p> : null}
          {activeRows.map(renderEditableRow)}
        </div>
      </section>

      <section className="workSurface" aria-labelledby="archived-users-heading">
        <div className="surfaceHeader">
          <h2 id="archived-users-heading">{labels.archivedUsers}</h2>
        </div>
        <div className="adminList">
          {archivedRows.length === 0 ? <p className="emptyState">{labels.noArchivedUsers}</p> : null}
          {archivedRows.map(renderArchivedRow)}
        </div>
      </section>

      <form action={formAction} className="stickyBatchBar">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <input type="hidden" name="changesJson" value={JSON.stringify(changedRows.map(comparable))} />
        <span>{labels.unsavedChanges.replace("{count}", String(changedCount))}</span>
        {state.message == null ? null : (
          <span className={state.ok ? "batchMessage batchMessageSuccess" : "batchMessage batchMessageError"}>
            {state.message}
          </span>
        )}
        <button type="submit" disabled={changedCount === 0}>
          {labels.saveChanges}
        </button>
        <button type="button" onClick={discardChanges} disabled={changedCount === 0}>
          {labels.discardChanges}
        </button>
      </form>
    </>
  );
}
