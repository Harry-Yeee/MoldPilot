"use client";

import { useMemo, useState } from "react";
import { searchCustomers, type CustomerSearchOption } from "@/domain/mold-trial/customers";
import { useI18n } from "@/i18n/language-provider";

type CustomerSelectorProps = {
  customers: readonly CustomerSearchOption[];
};

function customerLabel(customer: CustomerSearchOption): string {
  const owner = customer.ownerUser?.displayName == null ? "" : ` / ${customer.ownerUser.displayName}`;

  return `${customer.code} - ${customer.shortName}${owner}`;
}

export function CustomerSelector({ customers }: CustomerSelectorProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === selectedId) ?? null;
  const matches = useMemo(() => searchCustomers(customers, query, { activeOnly: true, limit: 12 }), [customers, query]);

  return (
    <div className="customerSelector fullSpan">
      <label>
        {t("common.client")}
        <input
          aria-describedby="customer-selector-hint"
          placeholder={t("customer.searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (selectedCustomer != null && !customerLabel(selectedCustomer).toLowerCase().includes(event.target.value.toLowerCase())) {
              setSelectedId("");
            }
          }}
        />
      </label>
      <input name="customerId" type="hidden" value={selectedId} />
      <p id="customer-selector-hint" className="fieldHint">
        {selectedCustomer == null
          ? t("customer.searchHint")
          : t("customer.selected", { client: customerLabel(selectedCustomer) })}
      </p>
      <div className="customerSelectorResults" role="listbox" aria-label={t("customer.searchResults")}>
        {matches.length === 0 && selectedCustomer == null ? (
          <span className="emptyState">{t("customer.noMatches")}</span>
        ) : (
          matches.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className={selectedId === customer.id ? "customerResult customerResultSelected" : "customerResult"}
              onClick={() => {
                setSelectedId(customer.id);
                setQuery(customerLabel(customer));
              }}
            >
              <strong>{customer.code}</strong>
              <span>{customer.shortName}</span>
              <small>{customer.ownerUser?.displayName ?? t("common.unassigned")}</small>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
