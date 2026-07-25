"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { batchUpdateCustomers, undoLastAdminAction, type AdminBatchActionState } from "@/server/admin-actions";
import { formatBilingualUserOption } from "@/domain/mold-trial/users";

type UserOption = {
  id: string;
  username: string;
  displayName: string;
  chineseName: string | null;
};

type ClientRow = {
  id: string;
  code: string;
  shortName: string;
  ownerUserId: string | null;
  ownerLabel: string;
  notes: string | null;
  active: boolean;
};

type Props = {
  clients: ClientRow[];
  labels: {
    actions: string;
    activeClients: string;
    archive: string;
    archivedClients: string;
    clientCode: string;
    clientShortName: string;
    discardChanges: string;
    noActiveClients: string;
    noArchivedClients: string;
    notesDealYear: string;
    owner: string;
    restore: string;
    saveChanges: string;
    undo: string;
    unsavedChanges: string;
  };
  ownerOptions: UserOption[];
  redirectTo: string;
};

const initialActionState: AdminBatchActionState = {
  ok: false,
  message: null,
  rowErrors: {},
  version: 0
};

function comparable(row: ClientRow) {
  return {
    id: row.id,
    code: row.code,
    shortName: row.shortName,
    ownerUserId: row.ownerUserId ?? null,
    notes: row.notes ?? null,
    active: row.active
  };
}

function sameRow(left: ClientRow, right: ClientRow): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function AdminClientsBatchEditor({ clients, labels, ownerOptions, redirectTo }: Props) {
  const router = useRouter();
  const [baselineRows, setBaselineRows] = useState(clients);
  const [rows, setRows] = useState(clients);
  const [sourceClients, setSourceClients] = useState(clients);
  const [state, formAction] = useActionState(batchUpdateCustomers, initialActionState);
  const handledSuccessVersion = useRef(0);
  const baselineById = useMemo(() => new Map(baselineRows.map((row) => [row.id, row])), [baselineRows]);
  const changedRows = rows.filter((row) => {
    const baseline = baselineById.get(row.id);
    return baseline == null || !sameRow(row, baseline);
  });
  const changedCount = changedRows.length;
  const activeRows = rows.filter((row) => row.active);
  const archivedRows = rows.filter((row) => !row.active);

  if (sourceClients !== clients) {
    setSourceClients(clients);
    setBaselineRows(clients);
    setRows(clients);
  }

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

  function updateRow(id: string, patch: Partial<ClientRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function isEdited(row: ClientRow): boolean {
    const baseline = baselineById.get(row.id);
    return baseline == null || !sameRow(row, baseline);
  }

  function discardChanges() {
    setRows(baselineRows);
  }

  function renderHeader(archived = false) {
    return (
      <div className={`clientTableHeader${archived ? " clientTableHeaderArchived" : ""}`} role="row">
        <span>No.</span>
        <span>{labels.clientCode}</span>
        <span>{labels.clientShortName}</span>
        <span>{labels.owner}</span>
        <span>{labels.notesDealYear}</span>
        <span>{labels.actions}</span>
      </div>
    );
  }

  function renderEditableRow(row: ClientRow, index: number) {
    const rowError = state.rowErrors[row.id];

    return (
      <div
        key={row.id}
        className={`clientTableRow customerAdminRow stagedAdminRow${isEdited(row) ? " editedAdminRow" : ""}${rowError ? " rowError" : ""}`}
        data-admin-client-row={row.code}
      >
        <span>{index + 1}</span>
        <input
          aria-label={labels.clientCode}
          name="code"
          value={row.code}
          onChange={(event) => updateRow(row.id, { code: event.target.value })}
          required
        />
        <input
          aria-label={labels.clientShortName}
          name="shortName"
          value={row.shortName}
          onChange={(event) => updateRow(row.id, { shortName: event.target.value })}
          required
        />
        <select
          aria-label={labels.owner}
          name="ownerUserId"
          value={row.ownerUserId ?? ""}
          onChange={(event) => updateRow(row.id, { ownerUserId: event.target.value || null })}
        >
          <option value="">-</option>
          {ownerOptions.map((user) => (
            <option key={user.id} value={user.id}>
              {formatBilingualUserOption(user)}
            </option>
          ))}
        </select>
        <input
          aria-label={labels.notesDealYear}
          name="notes"
          value={row.notes ?? ""}
          onChange={(event) => updateRow(row.id, { notes: event.target.value })}
        />
        <div className="roleActions">
          <button type="button" onClick={() => updateRow(row.id, { active: false })}>
            {labels.archive}
          </button>
        </div>
        {rowError ? <p className="rowErrorText">{rowError}</p> : null}
      </div>
    );
  }

  function renderArchivedRow(row: ClientRow, index: number) {
    const rowError = state.rowErrors[row.id];

    return (
      <div
        key={row.id}
        className={`clientTableRow customerAdminRow stagedAdminRow${isEdited(row) ? " editedAdminRow" : ""}${rowError ? " rowError" : ""}`}
        data-admin-client-row={row.code}
      >
        <span>{index + 1}</span>
        <input aria-label={labels.clientCode} value={row.code} readOnly />
        <input aria-label={labels.clientShortName} value={row.shortName} readOnly />
        <input aria-label={labels.owner} value={row.ownerLabel} readOnly />
        <input aria-label={labels.notesDealYear} value={row.notes ?? ""} readOnly />
        <div className="roleActions">
          <button type="button" onClick={() => updateRow(row.id, { active: true })}>
            {labels.restore}
          </button>
        </div>
        {rowError ? <p className="rowErrorText">{rowError}</p> : null}
      </div>
    );
  }

  return (
    <>
      <section className="workSurface" aria-labelledby="active-customers-heading">
        <div className="surfaceHeader">
          <h2 id="active-customers-heading">{labels.activeClients}</h2>
          <form action={undoLastAdminAction}>
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="undoScope" value="clients" />
            <button type="submit" className="secondaryButton">
              {labels.undo}
            </button>
          </form>
        </div>
        <div className="adminList">
          {activeRows.length === 0 ? <p className="emptyState">{labels.noActiveClients}</p> : renderHeader()}
          {activeRows.map(renderEditableRow)}
        </div>
      </section>

      <section className="workSurface" aria-labelledby="archived-customers-heading">
        <div className="surfaceHeader">
          <h2 id="archived-customers-heading">{labels.archivedClients}</h2>
        </div>
        <div className="adminList">
          {archivedRows.length === 0 ? <p className="emptyState">{labels.noArchivedClients}</p> : renderHeader(true)}
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
