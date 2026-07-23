import { login } from "@/server/auth-actions";
import { getOptionalCurrentUser } from "@/server/current-user";
import { FormField, MessageBanner, SubmitButton, TextInput } from "@/components/ui";
import { createTranslator } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/language-switcher";
import { getDictionary } from "@/i18n/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function messageValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string): string | null {
  const value = searchParams?.[key];
  return typeof value === "string" ? value : null;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const [params, currentUser] = await Promise.all([
    searchParams,
    getOptionalCurrentUser({ allowPasswordChangeRequired: true })
  ]);

  if (currentUser != null && currentUser.forcePasswordChange) {
    redirect("/change-password");
  }

  if (currentUser != null) {
    redirect("/");
  }

  const error = messageValue(params, "error");
  const success = messageValue(params, "success");
  const t = createTranslator(await getDictionary());

  return (
    <main className="authShell">
      <section className="authPanel" aria-labelledby="login-heading">
        <div className="authLanguage">
          <LanguageSwitcher />
        </div>
        <p className="eyebrow">MoldPilot v0.1</p>
        <h1 id="login-heading">{t("auth.login")}</h1>
        {error == null ? null : (
          <div className="mb-4">
            <MessageBanner variant="error" title={t("auth.loginFailed")}>
              {error}
            </MessageBanner>
          </div>
        )}
        {success == null ? null : (
          <div className="mb-4">
            <MessageBanner variant="success" title={t("common.saved")}>
              {success}
            </MessageBanner>
          </div>
        )}
        <form action={login} className="grid gap-3.5">
          <input type="hidden" name="redirectTo" value="/" />
          <FormField label={t("auth.username")} htmlFor="login-username">
            <TextInput id="login-username" name="username" autoComplete="username" required />
          </FormField>
          <FormField label={t("auth.password")} htmlFor="login-password">
            <TextInput
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </FormField>
          <SubmitButton size="lg" className="w-full">
            {t("auth.login")}
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
