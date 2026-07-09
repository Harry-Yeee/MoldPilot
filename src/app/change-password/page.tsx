import Link from "next/link";
import { AccountMenu } from "@/app/account-menu";
import { createTranslator } from "@/i18n";
import { getDictionary } from "@/i18n/server";
import { changeOwnCredentials } from "@/server/auth-actions";
import { getCurrentUser } from "@/server/current-user";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function messageValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string): string | null {
  const value = searchParams?.[key];
  return typeof value === "string" ? value : null;
}

export default async function ChangePasswordPage({ searchParams }: PageProps) {
  const [params, currentUser] = await Promise.all([
    searchParams,
    getCurrentUser({ allowPasswordChangeRequired: true })
  ]);
  const error = messageValue(params, "error");
  const success = messageValue(params, "success");
  const t = createTranslator(await getDictionary());

  return (
    <main className="shell">
      <section className="pageHeader">
        <div>
          <p className="eyebrow">MoldPilot Account</p>
          <h1>{t("auth.changePassword")}</h1>
          {currentUser.forcePasswordChange ? (
            <p className="backLink" aria-hidden={false}>
              {t("auth.setNewPasswordToContinue")}
            </p>
          ) : (
            <Link className="backLink" href="/">
              ← {t("common.backToDashboard")}
            </Link>
          )}
        </div>
        <AccountMenu currentUser={currentUser} />
      </section>
      {currentUser.forcePasswordChange ? (
        <section className="notice" role="status">
          <strong>{t("auth.temporaryPasswordNotice")}</strong>
          <span>{t("auth.temporaryPasswordHelp")}</span>
        </section>
      ) : null}
      {error == null ? null : (
        <section className="notice noticeError" role="alert">
          <strong>{t("common.actionFailed")}</strong>
          <span>{error}</span>
        </section>
      )}
      {success == null ? null : (
        <section className="notice noticeSuccess" role="status">
          <strong>{t("common.saved")}</strong>
          <span>{success}</span>
        </section>
      )}
      <section className="workSurface formSurface" aria-labelledby="change-password-heading">
        <div className="surfaceHeader">
          <h2 id="change-password-heading">{t("common.account")}</h2>
        </div>
        <form action={changeOwnCredentials} className="formGrid">
          <input type="hidden" name="redirectTo" value="/" />
          <label>
            {t("auth.username")}
            <input name="username" defaultValue={currentUser.username} required />
          </label>
          <label>
            {t("auth.currentPassword")}
            <input name="currentPassword" autoComplete="current-password" type="password" required />
          </label>
          <label>
            {t("auth.newPassword")}
            <input name="newPassword" autoComplete="new-password" type="password" required />
          </label>
          <label>
            {t("auth.confirmPassword")}
            <input name="confirmPassword" autoComplete="new-password" type="password" required />
          </label>
          <div className="formActions">
            <button type="submit">{t("auth.savePassword")}</button>
          </div>
        </form>
      </section>
    </main>
  );
}
