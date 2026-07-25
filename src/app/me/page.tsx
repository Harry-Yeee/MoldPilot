import { EmptyState, MessageBanner } from "@/components/ui";
import Link from "next/link";
import { localeFromLanguage, myPlateLabels, navLabels, pickLabel } from "@/domain/mold-trial/labels";
import { createTranslator, dictionaries, translateWorkflowMessage } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { getCurrentLanguage } from "@/i18n/server";
import { getCurrentUser } from "@/server/current-user";
import { getMyPlateData, type MyPlateData } from "@/server/my-plate";
import { MyPlateSections } from "@/app/me/my-plate-sections";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function messageValue(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];
  return typeof value === "string" ? value : null;
}

function emptyPlate(): MyPlateData {
  return {
    needsReason: [],
    confirmTrialDates: [],
    approveDateChanges: [],
    returnedDates: [],
    myOpenIssues: [],
    departmentInbox: [],
    designRevisions: [],
    assemblyAcknowledge: [],
    assemblySelfCheck: [],
    pmConfirmReady: [],
    comingUp: [],
    qcReportsToUpload: [],
    totalCount: 0,
    options: { missedTrialReasons: [], responsibleAreas: [], issueStatuses: [], activeMachines: [] }
  };
}

export default async function MyPlatePage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const currentUser = await getCurrentUser();
  const language = await getCurrentLanguage();
  const locale = localeFromLanguage(language);
  const t = createTranslator(dictionaries[language]);
  const now = new Date();
  const todayInput = now.toISOString().slice(0, 10);

  let data = emptyPlate();
  let databaseError = false;

  try {
    data = await getMyPlateData({ userId: currentUser.id, roleCode: currentUser.roleCode }, now);
  } catch {
    databaseError = true;
  }

  const error = translateWorkflowMessage(dictionaries[language], messageValue(params, "error"));
  const success = translateWorkflowMessage(dictionaries[language], messageValue(params, "success"));

  return (
    <main className="mx-auto grid w-full max-w-lg gap-4 px-4 py-5">
      <header className="myTasksPageHeader">
        <div className="grid min-w-0 gap-0.5">
          <h1 className="m-0 text-xl font-bold text-neutral-900">{pickLabel(myPlateLabels.pageTitle, locale)}</h1>
          <p className="m-0 text-sm text-neutral-600">{pickLabel(myPlateLabels.pageSubtitle, locale)}</p>
        </div>
        <div className="myTasksHeaderActions">
          <Link href="/" className="shrink-0 text-sm font-bold text-neutral-500 underline">
            {pickLabel(navLabels.dashboard, locale)}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {success == null ? null : (
        <MessageBanner variant="success" title={pickLabel(myPlateLabels.done, locale)}>
          {success}
        </MessageBanner>
      )}

      {error == null ? null : (
        <MessageBanner variant="error" title={pickLabel(myPlateLabels.cancel, locale)}>
          {error}
        </MessageBanner>
      )}

      {!databaseError ? null : (
        <MessageBanner variant="info" title={t("dashboard.databaseUnavailable")}>
          {t("myTasks.loadFailed")}
        </MessageBanner>
      )}

      {!databaseError && data.totalCount === 0 ? (
        <div className="pt-6">
          <EmptyState message={pickLabel(myPlateLabels.allCaughtUp, locale)} />
          <p className="pt-1 text-center text-sm text-neutral-500">{pickLabel(myPlateLabels.allCaughtUpHint, locale)}</p>
        </div>
      ) : (
        <MyPlateSections data={data} todayInput={todayInput} viewerUsername={currentUser.username} redirectTo="/me" />
      )}
    </main>
  );
}
