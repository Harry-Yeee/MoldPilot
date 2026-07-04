import { EmptyState, MessageBanner } from "@/components/ui";
import { myPlateLabels, navLabels, pickLabel, type Locale } from "@/domain/mold-trial/labels";
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
    myOpenIssues: [],
    departmentInbox: [],
    assemblyAcknowledge: [],
    assemblySelfCheck: [],
    pmConfirmReady: [],
    comingUp: [],
    totalCount: 0,
    options: { missedTrialReasons: [], responsibleAreas: [], issueStatuses: [] }
  };
}

export default async function MyPlatePage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const currentUser = await getCurrentUser();
  const locale: Locale = currentUser.locale === "ZH_CN" ? "ZH_CN" : "EN_US";
  const now = new Date();
  const todayInput = now.toISOString().slice(0, 10);

  let data = emptyPlate();
  let databaseError: string | null = null;

  try {
    data = await getMyPlateData({ userId: currentUser.id, roleCode: currentUser.roleCode }, now);
  } catch (error) {
    databaseError = error instanceof Error ? error.message : "Unable to load your tasks.";
  }

  const error = messageValue(params, "error");
  const success = messageValue(params, "success");

  return (
    <main className="mx-auto grid w-full max-w-lg gap-4 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h1 className="m-0 text-xl font-bold text-neutral-900">{pickLabel(myPlateLabels.pageTitle, locale)}</h1>
          <p className="m-0 text-sm text-neutral-600">{pickLabel(myPlateLabels.pageSubtitle, locale)}</p>
        </div>
        <a href="/" className="text-sm font-bold text-neutral-500 underline">
          {pickLabel(navLabels.dashboard, locale)}
        </a>
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

      {databaseError == null ? null : (
        <MessageBanner variant="info" title="Database">
          {databaseError}
        </MessageBanner>
      )}

      {databaseError == null && data.totalCount === 0 ? (
        <div className="pt-6">
          <EmptyState message={pickLabel(myPlateLabels.allCaughtUp, locale)} />
          <p className="pt-1 text-center text-sm text-neutral-500">{pickLabel(myPlateLabels.allCaughtUpHint, locale)}</p>
        </div>
      ) : (
        <MyPlateSections data={data} locale={locale} todayInput={todayInput} viewerUsername={currentUser.username} redirectTo="/me" />
      )}
    </main>
  );
}
