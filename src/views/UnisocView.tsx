import { useTranslation } from "react-i18next";
import { ViewPlaceholder } from "@/components/common/ViewPlaceholder";

export function UnisocView() {
  const { t } = useTranslation();
  return (
    <ViewPlaceholder
      title={t("page_unisoc", { defaultValue: "Unisoc 平台" })}
      subtitle="xml 参数文件导入(待扩展)"
    />
  );
}
