import type { ValidationIssue, ValidationResult } from "./types.ts";

export type CustomerSearchOption = {
  id: string;
  code: string;
  displayName: string;
  shortName: string;
  aliases?: string | null;
  active: boolean;
  ownerUser?: {
    displayName: string;
    chineseName?: string | null;
  } | null;
};

export type CustomerMasterInput = {
  code?: string | null;
  displayName?: string | null;
  shortName?: string | null;
  forbiddenFields?: readonly string[];
};

const forbiddenCrmFieldLabels: Record<string, string> = {
  customerContactName: "customer contact person",
  customerEmail: "customer email",
  customerPhone: "customer phone",
  quoteValue: "quote value",
  salesPipelineStage: "sales pipeline stage",
  customer_contact_name: "customer contact person",
  customer_email: "customer email",
  customer_phone: "customer phone",
  quote_value: "quote value",
  sales_pipeline_stage: "sales pipeline stage",
  portalAccess: "customer portal access",
  communicationHistory: "communication history",
  communication_history: "communication history"
};

export const forbiddenCustomerMasterFields = Object.keys(forbiddenCrmFieldLabels);

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function normalizedSearchText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function validationResult(issues: ValidationIssue[]): ValidationResult {
  return {
    ok: issues.length === 0,
    issues
  };
}

export function normalizeCustomerCode(value: string): string {
  return value.trim().toUpperCase();
}

export function validateCustomerMasterInput(input: CustomerMasterInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (isBlank(input.code)) {
    issues.push({
      field: "code",
      message: "Client code is required."
    });
  } else if (!/^[A-Z0-9][A-Z0-9_-]*$/i.test(input.code?.trim() ?? "")) {
    issues.push({
      field: "code",
      message: "Client code must use letters, numbers, hyphen, or underscore."
    });
  }

  if (isBlank(input.displayName) && isBlank(input.shortName)) {
    issues.push({
      field: "displayName",
      message: "Client display name is required."
    });
  }

  if (isBlank(input.shortName)) {
    issues.push({
      field: "shortName",
      message: "Client short name is required."
    });
  }

  for (const field of input.forbiddenFields ?? []) {
    issues.push({
      field,
      message: `Customer Master must not include ${forbiddenCrmFieldLabels[field] ?? "CRM/contact"} fields.`
    });
  }

  return validationResult(issues);
}

export function validateSelectedCustomerForProject(
  customer: Pick<CustomerSearchOption, "active"> | null | undefined
): ValidationResult {
  if (customer == null) {
    return validationResult([
      {
        field: "customerId",
        message: "Select an active client."
      }
    ]);
  }

  if (!customer.active) {
    return validationResult([
      {
        field: "customerId",
        message: "Archived clients cannot be selected for new projects."
      }
    ]);
  }

  return validationResult([]);
}

export function customerMatchesSearch(customer: CustomerSearchOption, query: string): boolean {
  const normalizedQuery = normalizedSearchText(query);

  if (normalizedQuery.length === 0) {
    return true;
  }

  return [
    customer.code,
    customer.displayName,
    customer.shortName,
    customer.aliases,
    customer.ownerUser?.displayName,
    customer.ownerUser?.chineseName
  ]
    .map(normalizedSearchText)
    .some((value) => value.includes(normalizedQuery));
}

export function searchCustomers(
  customers: readonly CustomerSearchOption[],
  query: string,
  options: { activeOnly?: boolean; limit?: number } = {}
): CustomerSearchOption[] {
  const limit = options.limit ?? 20;
  return customers
    .filter((customer) => (options.activeOnly ?? true ? customer.active : true))
    .filter((customer) => customerMatchesSearch(customer, query))
    .slice(0, limit);
}
