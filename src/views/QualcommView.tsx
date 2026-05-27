import { useTranslation } from "react-i18next";
import { CppImportCard } from "@/components/common/CppImportCard";

export function QualcommView() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex shrink-0 items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("page_qualcomm", { defaultValue: "Qualcomm 平台" })}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--colorNeutralForeground3)" }}>
            {t("qualcomm_card_desc", { defaultValue: "Qualcomm 平台 AE 算法可视化。\nxxx.xml" })
              .split("\n")[0]}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-2">
        <CppImportCard
          title={t("cpp_import_title",   { defaultValue: "导入 C++ 文件" })}
          subtitle={t("cpp_import_desc", { defaultValue: "选择本地 .cpp 文件并解析嵌套结构初始化列表" })}
          fileHint="qualcomm_ae_*.cpp"
        />
      </div>
    </div>
  );
}
