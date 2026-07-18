import { useTranslation } from "react-i18next";
import { Check, Loader2, AlertCircle } from "lucide-react";

interface SaveStatusProps {
  status: "idle" | "saving" | "saved" | "error";
}

export function SaveStatus({ status }: SaveStatusProps) {
  const { t } = useTranslation();

  if (status === "idle") return null;

  const config = {
    saving: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      text: t("save.saving"),
      className: "text-base-content/50",
    },
    saved: {
      icon: <Check className="h-3 w-3" />,
      text: t("save.saved"),
      className: "text-success",
    },
    error: {
      icon: <AlertCircle className="h-3 w-3" />,
      text: t("save.error"),
      className: "text-error",
    },
  };

  const current = config[status];

  return (
    <div
      className={`flex items-center gap-1 text-xs ${current.className}`}
      role="status"
      aria-live="polite"
    >
      {current.icon}
      <span>{current.text}</span>
    </div>
  );
}
