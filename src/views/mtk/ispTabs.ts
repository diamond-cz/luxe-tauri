/**
 * Per-ISP tab table — mirrors `ISP_TABS` in
 * `D:/Image_process/hiz/src/ui/pages/page_mtk/begun_card.py:39-54`.
 *
 *   file_hint = null → render a "待开发" placeholder instead of an import card
 */
export type IspId = "ISP46" | "ISP6S" | "ISP7S";

export interface IspTab {
  /** Display label */
  label:      string;
  /** Expected file name hint; null = placeholder tab (not yet implemented) */
  fileHint:   string | null;
  subtitle:   string;
}

export const ISP_LIST: { id: IspId; label: string }[] = [
  { id: "ISP46", label: "ISP46" },
  { id: "ISP6S", label: "ISP6S" },
  { id: "ISP7S", label: "ISP7S" },
];

export const ISP_TABS: Record<IspId, IspTab[]> = {
  ISP46: [
    { label: "AE Cap",    fileHint: "camera_ae_tuning_para_cap_xxx.cpp", subtitle: "自动曝光捕获参数" },
    { label: "AE Custom", fileHint: "ae_tuning_custom_xxx_.cpp",         subtitle: "自动曝光自定义参数" },
    { label: "ToneMap",   fileHint: "camera_isp_tonemap_xx.h",           subtitle: "色调映射参数文件" },
  ],
  ISP6S: [
    { label: "AE Basic",  fileHint: "AE.cpp",   subtitle: "自动曝光参数文件" },
    { label: "ToneMap",   fileHint: "Tone.cpp", subtitle: "色调映射参数文件" },
  ],
  ISP7S: [
    { label: "通道 1", fileHint: null, subtitle: "后续添加支持" },
    { label: "通道 2", fileHint: null, subtitle: "后续添加支持" },
    { label: "通道 3", fileHint: null, subtitle: "后续添加支持" },
  ],
};
