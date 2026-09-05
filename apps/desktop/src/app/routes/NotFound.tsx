import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/cards/EmptyState";

export function NotFound() {
  const { t } = useTranslation(["pages", "common"]);
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <EmptyState title={t("notFound.title")} hint={t("notFound.hint")} />
      <Link to="/" className="text-sm text-link underline underline-offset-2">
        {t("notFound.backLink")}
      </Link>
    </div>
  );
}
