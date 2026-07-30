import { StatusBadge } from "@/components/ui";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { barHitPercent, isScoredRole, kpiLabels } from "@/domain/mold-trial/kpi-rules";
import { missBufferAtBar, onTimeNeededForBar } from "@/domain/mold-trial/kpi-scoring";
import { localeFromLanguage, type BilingualLabel, pickLabel, type Locale } from "@/domain/mold-trial/labels";
import { createTranslator, dictionaries, translateLabel } from "@/i18n";
import { translateSystemRole } from "@/i18n/display";
import { getCurrentLanguage } from "@/i18n/server";
import { prisma } from "@/lib/prisma";
import { computeMonthlyScores, type ScoredUser } from "@/server/kpi-scores";
import { isScoreboardEnabled } from "@/server/kpi-settings";
import { getCurrentUser } from "@/server/current-user";
import { getEffectivePermissionCodes } from "@/server/permissions";
import { buildNavVisibility } from "@/server/nav";
import { severityLabels } from "@/server/mold-trial-codecs";

export const dynamic = "force-dynamic";

function formatWhen(value: Date | null, locale: Locale): string {
  if (value == null) {
    return pickLabel(kpiLabels.pending, locale);
  }
  return value.toLocaleString(locale === "ZH_CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function currentMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function ScorePage() {
  const currentUser = await getCurrentUser();
  const language = await getCurrentLanguage();
  const locale: Locale = localeFromLanguage(language);
  const dictionary = dictionaries[language];
  const t = createTranslator(dictionary);
  const permissionCodes = new Set(await getEffectivePermissionCodes(currentUser.id));
  const isAdmin = permissionCodes.has("kpi.scores.view_all");
  const enabled = await isScoreboardEnabled();
  // Reuse the scoreboard flag we already resolved — the pure builder adds no query.
  const nav = buildNavVisibility({
    permissionCodes,
    roleCode: currentUser.roleCode,
    dbRoleCode: currentUser.role.code,
    scoreboardEnabled: enabled
  });

  // Visibility gate: staff only see the page when the flag is on; admins always
  // see it (with a preview badge) so they can validate before opening it.
  if (!enabled && !isAdmin) {
    return (
      <main className="mx-auto grid w-full max-w-lg gap-4 px-4 py-6">
        <AppHeader current="score" nav={nav} currentUser={currentUser} />
        <header className="grid gap-1">
          <Link className="text-sm text-blue-700 underline" href="/">
            ← {pickLabel(kpiLabels.scoreboardTitle, locale)}
          </Link>
          <h1 className="m-0 text-xl font-bold text-neutral-900">{pickLabel(kpiLabels.scoreboardTitle, locale)}</h1>
        </header>
        <div className="notice" role="note">
          <strong>{pickLabel(kpiLabels.notEnabled, locale)}</strong>
          <span>{pickLabel(kpiLabels.notEnabledHint, locale)}</span>
        </div>
      </main>
    );
  }

  // Non-scored roles (ADMIN / GM / VIEWER) never have a scorecard. Rather than
  // render an empty card, tell them plainly and point admins to the Scores tab.
  if (!isScoredRole(currentUser.role.code)) {
    return (
      <main className="mx-auto grid w-full max-w-lg gap-4 px-4 py-6">
        <AppHeader current="score" nav={nav} currentUser={currentUser} />
        <header className="grid gap-1">
          <Link className="text-sm text-blue-700 underline" href="/">
            ← {pickLabel(kpiLabels.scoreboardTitle, locale)}
          </Link>
          <h1 className="m-0 text-xl font-bold text-neutral-900">{pickLabel(kpiLabels.scoreboardTitle, locale)}</h1>
        </header>
        <div className="notice" role="note">
          <strong>{pickLabel(kpiLabels.notScoredRole, locale)}</strong>
          <span>{pickLabel(kpiLabels.notScoredRoleHint, locale)}</span>
        </div>
        {isAdmin ? (
          <Link className="buttonLink" href="/admin?tab=scores">
            {pickLabel(kpiLabels.backToScores, locale)} →
          </Link>
        ) : null}
      </main>
    );
  }

  const now = new Date();
  const month = currentMonth(now);
  let scored: ScoredUser | null = null;
  let departmentPercent: number | null = null;
  let error: string | null = null;
  try {
    const scores = await computeMonthlyScores(month, now);
    scored = scores.users.find((user) => user.userId === currentUser.id) ?? null;
    if (scored?.roleScope != null) {
      departmentPercent = scores.departments.find((d) => d.roleScope === scored?.roleScope)?.percent ?? null;
    }
  } catch {
    error = t("score.loadFailed");
  }

  const ruleLabels: Record<string, { en: string; zh: string }> = Object.fromEntries(
    (await prisma.kpiRule.findMany({ select: { code: true, labelEn: true, labelZh: true } })).map((rule) => [
      rule.code,
      { en: rule.labelEn, zh: rule.labelZh }
    ])
  );

  const card = scored?.scorecard ?? null;
  const name = locale === "ZH_CN" && currentUser.chineseName != null ? currentUser.chineseName : currentUser.displayName;
  const barHit = card?.barHit ?? true;

  // "Hope math": one encouraging path-forward line under the verdict banner, so a
  // leader sitting below the bar mid-month sees the exact climb back instead of a
  // dead end. Amber when recovering, quiet green when already over — never red.
  let hopeLine: string | null = null;
  let hopeTone = "";
  if (card != null && card.applicable >= 1) {
    const fill = (label: BilingualLabel, value: number): string =>
      pickLabel(label, locale).replace("{n}", String(value));
    if (card.barHitByFloor) {
      // <5-events floor zone: protected regardless. Only nudge when the raw rate
      // is under the bar, phrased as guidance for when the month fills up.
      if (card.percent < barHitPercent) {
        hopeLine = fill(kpiLabels.hopeFloorGuidance, onTimeNeededForBar(card.onTime, card.applicable, barHitPercent));
        hopeTone = "text-amber-700";
      }
    } else if (!card.barHit) {
      // Below the bar with a real rate (≥5 events): the exact climb back over.
      hopeLine = fill(kpiLabels.hopeRecovery, onTimeNeededForBar(card.onTime, card.applicable, barHitPercent));
      hopeTone = "text-amber-700";
    } else {
      // At/over the bar (≥5 events): how much slack remains before slipping under.
      const buffer = missBufferAtBar(card.onTime, card.applicable, barHitPercent);
      hopeLine = buffer === 0 ? pickLabel(kpiLabels.hopeNoRoom, locale) : fill(kpiLabels.hopeBuffer, buffer);
      hopeTone = "text-emerald-700";
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-4 px-4 py-6">
      <AppHeader current="score" nav={nav} currentUser={currentUser} />
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-blue-800 pb-3">
        <div className="grid gap-1">
          <Link className="text-sm text-blue-700 underline" href="/">
            ← {pickLabel(kpiLabels.scoreboardTitle, locale)}
          </Link>
          <h1 className="m-0 text-2xl font-bold text-blue-900">{pickLabel(kpiLabels.scoreboardTitle, locale)}</h1>
          <p className="m-0 text-sm text-neutral-600">{pickLabel(kpiLabels.scoreboardSubtitle, locale)}</p>
        </div>
        {!enabled && isAdmin ? (
          <span className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800">
            {pickLabel(kpiLabels.previewBadge, locale)}
          </span>
        ) : null}
      </header>

      {error != null ? (
        <div className="notice noticeError" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-neutral-300">
        <div className="flex items-center justify-between bg-blue-900 px-4 py-3 text-white">
          <div className="text-lg font-bold">
            {name}
            <span className="ml-3 text-sm font-normal opacity-90">
              {translateSystemRole(
                dictionary,
                scored?.roleCode ?? currentUser.role.code,
                scored?.roleName ?? currentUser.role.name
              )}
            </span>
          </div>
          <div
            className={`rounded-full px-4 py-1 text-sm font-extrabold ${barHit ? "bg-emerald-700" : "bg-amber-700"}`}
          >
            {card == null
              ? pickLabel(kpiLabels.notEnough, locale)
              : card.barHitByFloor
                ? `${pickLabel(kpiLabels.notEnough, locale)}`
                : `${card.percent}% ${barHit ? "✓" : ""}`}
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-2">
          {/* ① The bar, item by item */}
          <div className="p-4">
            <h3 className="mb-2 text-base font-bold text-blue-800">① {pickLabel(kpiLabels.barBreakdown, locale)}</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1">{pickLabel(kpiLabels.behavior, locale)}</th>
                  <th className="py-1 text-right">{pickLabel(kpiLabels.applicable, locale)}</th>
                  <th className="py-1 text-right">{pickLabel(kpiLabels.onTime, locale)}</th>
                  <th className="py-1 text-right">{pickLabel(kpiLabels.verdict, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {card == null || card.lines.length === 0 ? (
                  <tr>
                    <td className="py-2 text-neutral-500" colSpan={4}>
                      {pickLabel(kpiLabels.noData, locale)}
                    </td>
                  </tr>
                ) : (
                  card.lines.map((line) => {
                    const label = ruleLabels[line.ruleCode] ?? { en: line.ruleCode, zh: line.ruleCode };
                    const lineOk = line.onTime === line.applicable;
                    return (
                      <tr key={line.ruleCode} className="border-t border-neutral-100 align-top">
                        <td className="py-1.5">
                          {pickLabel(label, locale)}
                          <div className="mt-0.5 grid gap-0.5">
                            {line.items
                              .filter((item) => !item.onTime)
                              .map((item, index) => (
                                <div key={index} className="text-xs text-amber-700">
                                  {item.ref} · {pickLabel(kpiLabels.dueAt, locale)} {formatWhen(item.dueAt, locale)} ·{" "}
                                  {pickLabel(kpiLabels.doneAt, locale)} {formatWhen(item.doneAt, locale)}
                                </div>
                              ))}
                          </div>
                        </td>
                        <td className="py-1.5 text-right font-bold">{line.applicable}</td>
                        <td className="py-1.5 text-right font-bold">{line.onTime}</td>
                        <td className={`py-1.5 text-right font-bold ${lineOk ? "text-emerald-700" : "text-amber-700"}`}>
                          {line.onTime}/{line.applicable}
                        </td>
                      </tr>
                    );
                  })
                )}
                {card != null && card.lines.length > 0 ? (
                  <tr className="border-t-2 border-blue-800">
                    <td className="py-1.5 font-extrabold">{pickLabel(kpiLabels.total, locale)}</td>
                    <td className="py-1.5 text-right font-extrabold">{card.applicable}</td>
                    <td className="py-1.5 text-right font-extrabold">{card.onTime}</td>
                    <td
                      className={`py-1.5 text-right font-extrabold ${barHit ? "text-emerald-700" : "text-amber-700"}`}
                    >
                      {card.barHitByFloor
                        ? pickLabel(kpiLabels.notEnough, locale)
                        : `${card.percent}% ${barHit ? "≥ 85% ✓" : "< 85%"}`}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {departmentPercent != null ? (
              <p className="mt-2 text-xs text-neutral-500">
                {pickLabel(kpiLabels.department, locale)}: {departmentPercent}%
              </p>
            ) : null}
          </div>

          {/* ② Points, fix by fix */}
          <div className="border-t border-neutral-200 p-4 md:border-l md:border-t-0">
            <h3 className="mb-2 text-base font-bold text-blue-800">② {pickLabel(kpiLabels.pointsBreakdown, locale)}</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1">{pickLabel(kpiLabels.verifiedFix, locale)}</th>
                  <th className="py-1 text-right">{pickLabel(kpiLabels.severity, locale)}</th>
                  <th className="py-1 text-right">{pickLabel(kpiLabels.points, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {card == null || card.points.length === 0 ? (
                  <tr>
                    <td className="py-2 text-neutral-500" colSpan={3}>
                      {pickLabel(kpiLabels.noData, locale)}
                    </td>
                  </tr>
                ) : (
                  card.points.map((line, index) => (
                    <tr key={`${line.issueRef}-${index}`} className="border-t border-neutral-100">
                      <td className="py-1.5">
                        {line.issueRef}
                        {line.verified ? null : (
                          <span className="ml-1 text-xs text-amber-700">
                            — {pickLabel(kpiLabels.pendingVerification, locale)}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {translateLabel(dictionary, "severity", severityLabels[line.severity] ?? line.severity)} {line.weight}
                      </td>
                      <td className={`py-1.5 text-right ${line.verified ? "text-emerald-700" : "text-amber-700"}`}>
                        {line.verified ? line.counted : pickLabel(kpiLabels.provisionalZero, locale)}
                      </td>
                    </tr>
                  ))
                )}
                {card != null && card.points.length > 0 ? (
                  <tr className="border-t-2 border-blue-800">
                    <td className="py-1.5 font-extrabold">{pickLabel(kpiLabels.monthPoints, locale)}</td>
                    <td />
                    <td className="py-1.5 text-right font-extrabold text-emerald-700">{card.totalPoints}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div
          className={`border-t px-4 py-3 ${barHit ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
        >
          <div className="text-sm font-bold">
            {card == null || card.barHitByFloor
              ? pickLabel(kpiLabels.notEnough, locale)
              : barHit
                ? `${pickLabel(kpiLabels.hit, locale)} ${card.percent}%`
                : `${pickLabel(kpiLabels.miss, locale)} ${card.percent}%`}
          </div>
          {hopeLine != null ? <div className={`mt-1 text-xs font-medium ${hopeTone}`}>{hopeLine}</div> : null}
        </div>
      </section>

      {/* Two protections footer box */}
      <section className="rounded-lg border border-blue-800 bg-blue-50 p-4">
        <div className="mb-1 text-base font-extrabold text-blue-800">{pickLabel(kpiLabels.twoProtections, locale)}</div>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-neutral-700">
          <li>{pickLabel(kpiLabels.protectionFewEvents, locale)}</li>
          <li>{pickLabel(kpiLabels.protectionBaseline, locale)}</li>
        </ul>
      </section>

      <div className="flex items-center gap-2">
        <StatusBadge tone={barHit ? "completed" : "missed"}>
          {barHit ? pickLabel(kpiLabels.hit, locale) : pickLabel(kpiLabels.miss, locale)}
        </StatusBadge>
        <span className="text-xs text-neutral-500">{month}</span>
      </div>
    </main>
  );
}
